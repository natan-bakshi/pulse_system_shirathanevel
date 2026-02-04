import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY');

/**
 * Sends a push notification via OneSignal REST API
 * Supports targeting by Base44 user IDs (looks up subscription IDs from user profiles)
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
        
        console.log(`[OneSignal] Sending push to ${user_ids.length} users:`, { title, user_ids });
        
        // Get subscription IDs for all target users
        const subscriptionIds = [];
        const skippedUsers = [];
        
        for (const userId of user_ids) {
            try {
                const users = await base44.asServiceRole.entities.User.filter({ id: userId });
                const targetUser = users.length > 0 ? users[0] : null;
                
                if (targetUser?.push_enabled && targetUser?.onesignal_subscription_id) {
                    subscriptionIds.push(targetUser.onesignal_subscription_id);
                    console.log(`[OneSignal] User ${userId} has subscription: ${targetUser.onesignal_subscription_id.substring(0, 10)}...`);
                } else {
                    skippedUsers.push({ userId, reason: 'No push subscription' });
                    console.log(`[OneSignal] User ${userId} skipped - no push subscription`);
                }
            } catch (e) {
                skippedUsers.push({ userId, reason: e.message });
                console.warn(`[OneSignal] Could not fetch user ${userId}:`, e.message);
            }
        }
        
        if (subscriptionIds.length === 0) {
            return Response.json({
                success: false,
                error: 'No valid push subscriptions found',
                skipped: skippedUsers
            });
        }
        
        // Send push via OneSignal REST API
        const oneSignalPayload = {
            app_id: ONESIGNAL_APP_ID,
            include_subscription_ids: subscriptionIds,
            contents: { 
                en: message,
                he: message
            },
            headings: { 
                en: title,
                he: title
            },
            data: {
                ...(data || {}),
                link: link || ''
            }
        };
        
        if (link) {
            oneSignalPayload.url = link;
        }
        
        console.log(`[OneSignal] Sending to ${subscriptionIds.length} subscriptions`);
        
        const response = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_API_KEY}`
            },
            body: JSON.stringify(oneSignalPayload)
        });
        
        const result = await response.json();
        
        console.log(`[OneSignal] Response:`, JSON.stringify(result));
        
        if (result.id) {
            console.log(`[OneSignal] Push completed. Recipients: ${result.recipients || 0}`);
            return Response.json({
                success: true,
                recipients: result.recipients || 0,
                onesignal_id: result.id,
                skipped: skippedUsers.length > 0 ? skippedUsers : undefined
            });
        } else {
            return Response.json({
                success: false,
                error: result.errors || 'Unknown error',
                skipped: skippedUsers
            });
        }
        
    } catch (error) {
        console.error('[OneSignal] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});