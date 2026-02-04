import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const FIREBASE_FUNCTION_URL = 'https://us-central1-pulse-notifications-6886e.cloudfunctions.net/sendPush';

/**
 * Sends a push notification via Firebase Function proxy to OneSignal
 * Supports targeting by external user IDs (Base44 user IDs)
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        // Only admins can send push notifications directly
        if (user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        const payload = await req.json();
        const { 
            user_ids, // Array of Base44 user IDs to target
            title, 
            message, 
            link,
            data // Additional data to include in the push
        } = payload;
        
        if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
            return Response.json({ error: 'user_ids array is required' }, { status: 400 });
        }
        
        if (!title || !message) {
            return Response.json({ error: 'title and message are required' }, { status: 400 });
        }
        
        console.log(`[OneSignal] Sending push via Firebase proxy to ${user_ids.length} users:`, { title, user_ids });
        
        // Send push notifications via Firebase Function proxy
        let totalRecipients = 0;
        const errors = [];
        
        for (const userId of user_ids) {
            try {
                const firebasePayload = {
                    userId: userId,
                    title: title,
                    message: message,
                    data: {
                        ...(data || {}),
                        link: link || ''
                    }
                };
                
                const response = await fetch(FIREBASE_FUNCTION_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(firebasePayload)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    totalRecipients += result.recipients || 1;
                    console.log(`[OneSignal] Push sent to user ${userId}. Recipients: ${result.recipients || 1}`);
                } else {
                    console.warn(`[OneSignal] Failed for user ${userId}:`, result.error);
                    errors.push({ userId, error: result.error });
                }
            } catch (error) {
                console.error(`[OneSignal] Error sending to user ${userId}:`, error.message);
                errors.push({ userId, error: error.message });
            }
        }
        
        console.log(`[OneSignal] Push completed. Total recipients: ${totalRecipients}, Errors: ${errors.length}`);
        
        return Response.json({
            success: true,
            recipients: totalRecipients,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('[OneSignal] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});