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

                // Verify user is no longer in quiet hours before sending
                // Use defaults if not set (22:00-08:00)
                const startHour = targetUser?.quiet_start_hour !== undefined ? targetUser.quiet_start_hour : 22;
                const endHour = targetUser?.quiet_end_hour !== undefined ? targetUser.quiet_end_hour : 8;

                if (isInQuietHours(startHour, endHour)) {
                    // Still in quiet hours - reschedule for next quiet end
                    const newScheduledFor = getQuietHoursEndTime(endHour);
                    await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, {
                        scheduled_for: newScheduledFor.toISOString()
                    });
                    console.log(`[ScheduledPush] User ${pending.user_id} still in quiet hours (${startHour}-${endHour}). Rescheduled for ${newScheduledFor.toISOString()}`);
                    continue;
                }
                
                // --- WhatsApp Sending Logic ---
                let whatsappData = null;
                try {
                    whatsappData = pending.data ? JSON.parse(pending.data) : {};
                } catch(e) {}

                if (whatsappData && whatsappData.send_whatsapp) {
                    // We need to resolve phone again if not stored, but usually createNotification resolves it.
                    // For now, rely on User phone. If User is missing phone, we might fail here for pending messages
                    // unless we stored resolved phone in 'data' too. 
                    // Enhancement: Use targetUser.phone.
                    
                    if (targetUser?.phone) {
                        try {
                            const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
                            const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");
                            
                            if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                                let cleanPhone = targetUser.phone.replace(/[^0-9]/g, '');
                                if (cleanPhone.startsWith('05')) cleanPhone = '972' + cleanPhone.substring(1);
                                else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) cleanPhone = '972' + cleanPhone;
                                
                                const chatId = `${cleanPhone}@c.us`;
                                const waMsg = whatsappData.whatsapp_message || pending.message;
                                const link = pending.link || '';
                                
                                // Construct Absolute Link (if not already) - Use stored base_url or default
                                const baseUrl = 'https://app.base44.com'; // Fallback
                                const fullLink = link ? (link.startsWith('http') ? link : `${baseUrl}${link.startsWith('/') ? link : '/' + link}`) : '';
                                const content = `*${pending.title}*\n\n${waMsg}${fullLink ? `\n\n${fullLink}` : ''}`;
                                
                                await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ chatId, message: content })
                                });
                                console.log(`[ScheduledPush] WhatsApp sent to ${chatId}`);
                                
                                // Update in-app status
                                if (pending.in_app_notification_id) {
                                    await base44.asServiceRole.entities.InAppNotification.update(pending.in_app_notification_id, {
                                        whatsapp_sent: true
                                    });
                                }
                            }
                        } catch (waErr) {
                            console.error(`[ScheduledPush] WhatsApp error:`, waErr);
                        }
                    }
                }

                // Check if user has push enabled
                if (!targetUser?.push_enabled || !targetUser?.onesignal_subscription_id) {
                    console.log(`[ScheduledPush] User ${pending.user_id} has no push subscription, marking as sent (WhatsApp processed if enabled)`);
                    await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, {
                        is_sent: true
                    });
                    continue;
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