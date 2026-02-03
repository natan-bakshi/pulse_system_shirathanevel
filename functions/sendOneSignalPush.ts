import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Sends a push notification via OneSignal API
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
        
        const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY');
        const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
        
        if (!ONESIGNAL_API_KEY) {
            console.error('[OneSignal] Missing ONESIGNAL_API_KEY');
            return Response.json({ error: 'OneSignal not configured' }, { status: 500 });
        }
        
        // Build the OneSignal notification payload
        const onesignalPayload = {
            app_id: ONESIGNAL_APP_ID,
            include_external_user_ids: user_ids, // Target by Base44 user IDs
            contents: { "he": message, "en": message },
            headings: { "he": title, "en": title },
        };
        
        // Add URL if provided
        if (link) {
            onesignalPayload.url = link;
        }
        
        // Add additional data if provided
        if (data) {
            onesignalPayload.data = data;
        }
        
        console.log(`[OneSignal] Sending push to ${user_ids.length} users:`, { title });
        
        const response = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(onesignalPayload)
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            console.error('[OneSignal] API Error:', result);
            return Response.json({ 
                success: false, 
                error: result.errors || 'OneSignal API error',
                details: result
            }, { status: response.status });
        }
        
        console.log(`[OneSignal] Push sent successfully. Recipients: ${result.recipients || 0}`);
        
        return Response.json({
            success: true,
            notification_id: result.id,
            recipients: result.recipients || 0
        });
        
    } catch (error) {
        console.error('[OneSignal] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});