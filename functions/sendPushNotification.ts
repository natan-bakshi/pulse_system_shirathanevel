import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';
import { getApps, initializeApp, cert, getApp } from 'npm:firebase-admin@12.0.0/app';
import { getMessaging } from 'npm:firebase-admin@12.0.0/messaging';

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

    const { userIds, title, body, data = {} } = await req.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0 || !title || !body) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: userIds, title, body' }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    
    const usersWithTokens = (await base44.asServiceRole.entities.User.list())
        .filter(u => userIds.includes(u.id) && u.push_tokens && u.push_tokens.length > 0);

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

    return new Response(JSON.stringify({ success: true, successCount: response.successCount, failureCount: response.failureCount }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error('Push notification sending error:', error);
    return new Response(JSON.stringify({ error: 'Failed to send push notification', details: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});