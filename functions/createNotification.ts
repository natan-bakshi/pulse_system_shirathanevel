import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Creates an in-app notification and optionally sends a push notification
 * Handles quiet hours by scheduling push for later
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        const payload = await req.json();
        const { 
            target_user_id,
            target_user_email,
            title, 
            message, 
            link,
            template_type,
            related_event_id,
            related_event_service_id,
            related_supplier_id,
            send_push = true,
            check_quiet_hours = true
        } = payload;
        
        if (!target_user_id || !title || !message) {
            return Response.json({ error: 'target_user_id, title, and message are required' }, { status: 400 });
        }
        
        console.log(`[Notification] Creating notification for user ${target_user_id}: ${title}`);
        
        // Get target user's preferences
        let targetUser = null;
        try {
            const users = await base44.asServiceRole.entities.User.filter({ id: target_user_id });
            targetUser = users.length > 0 ? users[0] : null;
        } catch (e) {
            console.warn('[Notification] Could not fetch target user preferences:', e.message);
        }
        
        // Check if notification type is enabled for this user
        if (targetUser?.notification_preferences && template_type) {
            const pref = targetUser.notification_preferences[template_type];
            if (pref !== undefined) {
                const isEnabled = typeof pref === 'object' ? pref.enabled !== false : pref !== false;
                if (!isEnabled) {
                    console.log(`[Notification] User ${target_user_id} has disabled ${template_type} notifications`);
                    return Response.json({ 
                        success: true, 
                        skipped: true, 
                        reason: 'User has disabled this notification type' 
                    });
                }
            }
        }
        
        // Create the in-app notification
        const inAppNotification = await base44.asServiceRole.entities.InAppNotification.create({
            user_id: target_user_id,
            user_email: target_user_email || targetUser?.email,
            title,
            message,
            link: link || '',
            is_read: false,
            template_type: template_type || 'CUSTOM',
            related_event_id: related_event_id || '',
            related_event_service_id: related_event_service_id || '',
            related_supplier_id: related_supplier_id || '',
            push_sent: false,
            reminder_count: 0,
            is_resolved: false
        });
        
        console.log(`[Notification] In-app notification created: ${inAppNotification.id}`);
        
        // Handle push notification
        let pushResult = { sent: false };
        
        if (send_push) {
            // Check Shabbat first (system-wide, non-configurable)
            let shouldDelayPush = false;
            let scheduledFor = null;
            
            if (isShabbat()) {
                shouldDelayPush = true;
                scheduledFor = getShabbatEndTime();
                console.log(`[Notification] Shabbat mode active. Scheduling push for: ${scheduledFor.toISOString()}`);
            }
            // Then check user quiet hours
            else if (check_quiet_hours && targetUser?.quiet_start_hour !== undefined && targetUser?.quiet_end_hour !== undefined) {
                const isQuiet = isInQuietHours(targetUser.quiet_start_hour, targetUser.quiet_end_hour);
                
                if (isQuiet) {
                    shouldDelayPush = true;
                    scheduledFor = getQuietHoursEndTime(targetUser.quiet_end_hour);
                    console.log(`[Notification] User in quiet hours. Scheduling push for: ${scheduledFor.toISOString()}`);
                }
            }
            
            if (shouldDelayPush && scheduledFor) {
                // Create pending push notification for later
                await base44.asServiceRole.entities.PendingPushNotification.create({
                    user_id: target_user_id,
                    user_email: target_user_email || targetUser?.email,
                    title,
                    message,
                    link: link || '',
                    scheduled_for: scheduledFor.toISOString(),
                    template_type: template_type || 'CUSTOM',
                    in_app_notification_id: inAppNotification.id,
                    is_sent: false
                });
                
                // Update in-app notification with scheduled time
                await base44.asServiceRole.entities.InAppNotification.update(inAppNotification.id, {
                    push_scheduled_for: scheduledFor.toISOString()
                });
                
                pushResult = { sent: false, scheduled: true, scheduled_for: scheduledFor.toISOString() };
            } else {
                // Send push immediately using OneSignal API directly
                try {
                    const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY');
                    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
                    
                    if (!ONESIGNAL_API_KEY || !ONESIGNAL_APP_ID) {
                        console.warn('[Notification] OneSignal not configured');
                        pushResult = { sent: false, error: 'OneSignal not configured' };
                    } else {
                        // Use include_aliases with external_id (new API format)
                        const onesignalPayload = {
                            app_id: ONESIGNAL_APP_ID,
                            include_aliases: {
                                external_id: [target_user_id]
                            },
                            target_channel: "push",
                            contents: { "he": message, "en": message },
                            headings: { "he": title, "en": title },
                            data: { notification_id: inAppNotification.id }
                        };
                        
                        if (link) {
                            onesignalPayload.url = link;
                        }
                        
                        console.log(`[Notification] Sending push via OneSignal to user ${target_user_id}`);
                        console.log(`[Notification] OneSignal payload:`, JSON.stringify(onesignalPayload));
                        
                        // Use the correct API endpoint as per OneSignal AI recommendation
                        const response = await fetch('https://api.onesignal.com/notifications', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                            },
                            body: JSON.stringify(onesignalPayload)
                        });
                        
                        const result = await response.json();
                        
                        console.log(`[Notification] OneSignal response:`, JSON.stringify(result));
                        
                        // Log warnings if any (helps debug invalid_external_user_ids)
                        if (result.errors) {
                            console.warn(`[Notification] OneSignal errors:`, result.errors);
                        }
                        
                        if (response.ok && result.recipients > 0) {
                            await base44.asServiceRole.entities.InAppNotification.update(inAppNotification.id, {
                                push_sent: true
                            });
                            pushResult = { sent: true, recipients: result.recipients };
                            console.log(`[Notification] Push sent successfully. Recipients: ${result.recipients}`);
                        } else {
                            // Log more details about why it failed
                            const errorDetails = result.errors || result.warnings || 'No recipients';
                            pushResult = { 
                                sent: false, 
                                error: errorDetails, 
                                recipients: result.recipients || 0,
                                warnings: result.warnings
                            };
                            console.warn('[Notification] Push failed or no recipients:', JSON.stringify(result));
                        }
                    }
                } catch (pushError) {
                    console.error('[Notification] Push send error:', pushError);
                    pushResult = { sent: false, error: pushError.message };
                }
            }
        }
        
        return Response.json({
            success: true,
            notification_id: inAppNotification.id,
            push: pushResult
        });
        
    } catch (error) {
        console.error('[Notification] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// Helper function: Check if current time is during Shabbat (Friday 17:00 - Saturday 21:00)
function isShabbat(timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        hour: 'numeric',
        hour12: false,
        timeZone: timezone
    });
    const parts = formatter.formatToParts(now);
    const dayPart = parts.find(p => p.type === 'weekday');
    const hourPart = parts.find(p => p.type === 'hour');
    
    const day = dayPart?.value; // 'Fri', 'Sat', etc.
    const hour = parseInt(hourPart?.value || '0', 10);
    
    // Friday after 17:00
    if (day === 'Fri' && hour >= 17) return true;
    // All day Saturday until 21:00
    if (day === 'Sat' && hour < 21) return true;
    
    return false;
}

// Helper function: Get end of Shabbat time
function getShabbatEndTime(timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: timezone
    });
    const day = formatter.format(now);
    
    // Calculate next Saturday 21:00
    const endTime = new Date(now);
    
    if (day === 'Fri') {
        // Move to Saturday
        endTime.setDate(endTime.getDate() + 1);
    }
    // Set to 21:00
    endTime.setHours(21, 0, 0, 0);
    
    return endTime;
}

// Helper function: Check if current time is in quiet hours
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
    
    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (quietStart > quietEnd) {
        return currentHour >= quietStart || currentHour < quietEnd;
    }
    
    // Handle same-day quiet hours
    return currentHour >= quietStart && currentHour < quietEnd;
}

// Helper function: Calculate when quiet hours end
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