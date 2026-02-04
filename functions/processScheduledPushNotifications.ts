import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY');

/**
 * Processes pending push notifications that were delayed due to quiet hours
 * Should be run periodically (e.g., every 15 minutes) via scheduled automation
 * Uses OneSignal REST API directly
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        console.log('[ScheduledPush] Processing pending push notifications...');
        
        const now = new Date().toISOString();
        
        // Get all pending notifications that are due
        const pendingNotifications = await base44.asServiceRole.entities.PendingPushNotification.filter({
            is_sent: false
        });
        
        // Filter to only those that are due (scheduled_for <= now)
        const dueNotifications = pendingNotifications.filter(n => {
            if (!n.scheduled_for) return false;
            return new Date(n.scheduled_for) <= new Date(now);
        });
        
        console.log(`[ScheduledPush] Found ${dueNotifications.length} due notifications`);
        
        let successCount = 0;
        let errorCount = 0;
        
        for (const pending of dueNotifications) {
            try {
                // Check if user is still not in quiet hours
                let targetUser = null;
                try {
                    const users = await base44.asServiceRole.entities.User.filter({ id: pending.user_id });
                    targetUser = users.length > 0 ? users[0] : null;
                } catch (e) {
                    console.warn(`[ScheduledPush] Could not fetch user ${pending.user_id}:`, e.message);
                }
                
                // Check if user has push enabled
                if (!targetUser?.push_enabled || !targetUser?.onesignal_subscription_id) {
                    console.log(`[ScheduledPush] User ${pending.user_id} has no push subscription, marking as sent`);
                    await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, {
                        is_sent: true
                    });
                    continue;
                }
                
                // Verify user is no longer in quiet hours before sending
                if (targetUser?.quiet_start_hour !== undefined && targetUser?.quiet_end_hour !== undefined) {
                    if (isInQuietHours(targetUser.quiet_start_hour, targetUser.quiet_end_hour)) {
                        // Still in quiet hours - reschedule for next quiet end
                        const newScheduledFor = getQuietHoursEndTime(targetUser.quiet_end_hour);
                        await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, {
                            scheduled_for: newScheduledFor.toISOString()
                        });
                        console.log(`[ScheduledPush] User ${pending.user_id} still in quiet hours. Rescheduled for ${newScheduledFor.toISOString()}`);
                        continue;
                    }
                }
                
                // Send the push notification via OneSignal REST API
                const oneSignalPayload = {
                    app_id: ONESIGNAL_APP_ID,
                    include_subscription_ids: [targetUser.onesignal_subscription_id],
                    contents: { 
                        en: pending.message,
                        he: pending.message
                    },
                    headings: { 
                        en: pending.title,
                        he: pending.title
                    },
                    data: {
                        notification_id: pending.in_app_notification_id,
                        link: pending.link || '',
                        delayed: true
                    }
                };
                
                if (pending.link) {
                    oneSignalPayload.url = pending.link;
                }
                
                const pushResponse = await fetch('https://onesignal.com/api/v1/notifications', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${ONESIGNAL_API_KEY}`
                    },
                    body: JSON.stringify(oneSignalPayload)
                });
                
                const pushResult = await pushResponse.json();
                console.log(`[ScheduledPush] OneSignal response for user ${pending.user_id}:`, JSON.stringify(pushResult));
                
                // Mark as sent
                await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, {
                    is_sent: true
                });
                
                // Update the in-app notification
                if (pending.in_app_notification_id) {
                    try {
                        await base44.asServiceRole.entities.InAppNotification.update(pending.in_app_notification_id, {
                            push_sent: true
                        });
                    } catch (e) {
                        console.warn(`[ScheduledPush] Could not update in-app notification:`, e.message);
                    }
                }
                
                successCount++;
                console.log(`[ScheduledPush] Sent push to user ${pending.user_id}: ${pending.title}`);
                
            } catch (error) {
                errorCount++;
                console.error(`[ScheduledPush] Error processing notification ${pending.id}:`, error);
            }
        }
        
        // Clean up old sent notifications (older than 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const oldNotifications = pendingNotifications.filter(n => 
            n.is_sent && new Date(n.created_date) < sevenDaysAgo
        );
        
        for (const old of oldNotifications) {
            try {
                await base44.asServiceRole.entities.PendingPushNotification.delete(old.id);
            } catch (e) {
                console.warn(`[ScheduledPush] Could not delete old notification ${old.id}:`, e.message);
            }
        }
        
        return Response.json({
            success: true,
            processed: dueNotifications.length,
            sent: successCount,
            errors: errorCount,
            cleaned_up: oldNotifications.length
        });
        
    } catch (error) {
        console.error('[ScheduledPush] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// Helper functions (duplicated from createNotification.js for standalone execution)
function isInQuietHours(quietStart, quietEnd, timezone = 'Asia/Jerusalem') {
    if (quietStart === undefined || quietEnd === undefined) {
        return false;
    }
    
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone
    });
    const currentHour = parseInt(formatter.format(now), 10);
    
    if (quietStart > quietEnd) {
        return currentHour >= quietStart || currentHour < quietEnd;
    }
    
    return currentHour >= quietStart && currentHour < quietEnd;
}

function getQuietHoursEndTime(quietEnd, timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone
    });
    const currentHour = parseInt(formatter.format(now), 10);
    
    const endTime = new Date(now);
    endTime.setHours(quietEnd, 0, 0, 0);
    
    if (currentHour >= quietEnd) {
        endTime.setDate(endTime.getDate() + 1);
    }
    
    return endTime;
}