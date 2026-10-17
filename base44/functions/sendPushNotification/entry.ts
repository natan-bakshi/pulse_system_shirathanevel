import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';
import { getApps, initializeApp, cert, getApp } from 'npm:firebase-admin@12.0.0/app';
import { getMessaging } from 'npm:firebase-admin@12.0.0/messaging';
import { sendWhatsAppText } from '../../shared/whatsappSend.ts';

// Helper to safely initialize Firebase Admin.
// It will only initialize if it hasn't been already.
function initializeFirebaseAdmin() {
  if (getApps().length > 0) {
    return getApp();
  }
  
  const serviceAccountString = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!serviceAccountString) {
    throw new Error("CRITICAL: FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set or empty.");
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountString);
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  } catch (e) {
    // This will help debug if the JSON secret is malformed.
    throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${e.message}`);
  }
}

Deno.serve(async (req) => {
  let app;
  try {
    // Moved initialization inside the request to prevent deployment crashes.
    // If this fails, it will be caught and a proper error response will be sent.
    app = initializeFirebaseAdmin();
  } catch (error) {
    console.error('Firebase Admin Initialization Failed:', error.message);
    return new Response(JSON.stringify({ error: 'Firebase Admin initialization failed.', details: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const { userIds, title, body, data = {}, sendWhatsApp = true } = await req.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0 || !title || !body) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: userIds, title, body' }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    
    // Fetch all targeted users to check for WhatsApp capability as well
    const allTargetUsers = await base44.asServiceRole.entities.User.list();
    const targetedUsers = allTargetUsers.filter(u => userIds.includes(u.id));

    // --- WhatsApp Logic Start ---
    // Supplier assignment WhatsApp is now owned by the durable assignment
    // outbox producer. Do not duplicate it via the Push mirror.
    const whatsappResults = [];
    if (sendWhatsApp !== false) {
        const whatsappUsers = targetedUsers.filter(u => u.phone && u.whatsapp_enabled !== false);
        
        for (const u of whatsappUsers) {
            try {
                const link = data.link || data.click_action || '';
                const whatsappMessage = `*${title}*\n\n${body}${link ? `\n\n${link}` : ''}`;
                const receipt=await sendWhatsAppText(u.phone, whatsappMessage, base44, {sourceType:'push_mirror'});
                const status=String(receipt?.status||'');
                const confirmed=receipt?.success!==false && !['unknown','failed','cancelled','expired','resolved'].includes(status) &&
                  (receipt?.queued===true || status==='accepted' || status==='sending' || status==='retry_wait' || receipt?.legacyDirect===true);
                whatsappResults.push({ userId:u.id,success:confirmed,queued:confirmed&&receipt?.queued===true,
                  state:confirmed?(status||'queued'):status||'unverified',messageId:confirmed?(receipt?.messageId||''):'' });
            } catch (waError) {
                console.error('[sendPushNotification] WhatsApp send error:', waError?.message || 'unknown');
                whatsappResults.push({ userId: u.id, success: false, error: waError.message });
            }
        }
    }
    // --- WhatsApp Logic End ---

    const usersWithTokens = targetedUsers.filter(u => u.push_tokens && u.push_tokens.length > 0);

    const allTokens = usersWithTokens.flatMap(u => u.push_tokens);

    if (allTokens.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No push tokens found for the target users.' }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const messaging = getMessaging(app);

    const response = await messaging.sendEachForMulticast({
      notification: { title, body },
      data: { ...data, click_action: data.click_action || '/' },
      tokens: allTokens,
      android: {
          priority: 'high',
      },
      apns: {
          headers: {
              'apns-priority': '10',
          },
      },
    });
    
    // Cleanup logic for invalid tokens
    const invalidTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const errorCode = resp.error?.code;
        if (errorCode === 'messaging/invalid-registration-token' || errorCode === 'messaging/registration-token-not-registered') {
          invalidTokens.push(allTokens[idx]);
        }
      }
    });

    if (invalidTokens.length > 0) {
      for (const u of usersWithTokens) {
        const cleanTokens = u.push_tokens.filter(token => !invalidTokens.includes(token));
        if (cleanTokens.length < u.push_tokens.length) {
          await base44.asServiceRole.entities.User.update(u.id, { push_tokens: cleanTokens });
        }
      }
    }

    return new Response(JSON.stringify({ 
        success: true, 
        push: { successCount: response.successCount, failureCount: response.failureCount },
        whatsapp: { count: whatsappResults.length, results: whatsappResults }
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error('Push notification sending error:', error);
    return new Response(JSON.stringify({ error: 'Failed to send push notification', details: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});