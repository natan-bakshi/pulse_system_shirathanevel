import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY');

/**
 * Creates an in-app notification and optionally sends a push notification
 * Handles quiet hours by scheduling push for later
 * Uses OneSignal REST API directly with external_id targeting
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
            send_whatsapp = false,
            check_quiet_hours = true
        } = payload;
        
        // WhatsApp message override (optional) - defaults to standard message
        const whatsapp_message = payload.whatsapp_message || message;
        
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
        
        // Check if user has push enabled
        const userHasPushEnabled = targetUser?.push_enabled === true && targetUser?.onesignal_subscription_id;
        console.log(`[Notification] User push status - push_enabled: ${targetUser?.push_enabled}, subscription_id: ${targetUser?.onesignal_subscription_id ? 'exists' : 'none'}`);

        // Check if user has whatsapp enabled
        const userHasWhatsAppEnabled = targetUser?.whatsapp_enabled !== false && targetUser?.phone; // Default to true if not set, but must have phone
        console.log(`[Notification] User whatsapp status - whatsapp_enabled: ${targetUser?.whatsapp_enabled}, phone: ${targetUser?.phone ? 'exists' : 'missing'}`);
        
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
            whatsapp_sent: false,
            whatsapp_message_id: '',
            reminder_count: 0,
            is_resolved: false
        });
        
        console.log(`[Notification] In-app notification created: ${inAppNotification.id}`);
        
        // Handle WhatsApp notification
        let whatsappResult = { sent: false };

        if (send_whatsapp && userHasWhatsAppEnabled) {
            try {
                const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
                const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");

                if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
                    throw new Error("Missing Green API Credentials");
                }

                // Clean phone number
                let cleanPhone = targetUser.phone.replace(/[^0-9]/g, '');
                if (cleanPhone.startsWith('05')) {
                    cleanPhone = '972' + cleanPhone.substring(1);
                } else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
                    cleanPhone = '972' + cleanPhone;
                }

                const chatId = `${cleanPhone}@c.us`;
                // Use whatsapp_message if specific one provided, otherwise use generic message
                const contentToSend = whatsapp_message || message;
                const whatsappContent = `*${title}*\n\n${contentToSend}${link ? `\n\n${link}` : ''}`;

                console.log(`[Notification] Sending WhatsApp to ${chatId}`);

                const waResponse = await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatId: chatId,
                        message: whatsappContent
                    })
                });

                const waData = await waResponse.json();
                
                if (waResponse.ok) {
                    whatsappResult = { sent: true, id: waData.idMessage };
                    console.log(`[Notification] WhatsApp sent successfully: ${waData.idMessage}`);
                    
                    // Update the notification record with WhatsApp status
                    try {
                        await base44.asServiceRole.entities.InAppNotification.update(inAppNotification.id, {
                            whatsapp_sent: true,
                            whatsapp_message_id: waData.idMessage || ''
                        });
                    } catch (updateError) {
                        console.warn('[Notification] Failed to update whatsapp status in DB:', updateError);
                    }
                } else {
                    whatsappResult = { sent: false, error: waData };
                    console.warn(`[Notification] WhatsApp failed:`, waData);
                }
            } catch (waError) {
                console.error('[Notification] WhatsApp error:', waError);
                whatsappResult = { sent: false, error: waError.message };
            }
        } else if (send_whatsapp && !userHasWhatsAppEnabled) {
            whatsappResult = { sent: false, reason: !targetUser?.phone ? 'Missing phone number' : 'WhatsApp disabled by user' };
            console.log(`[Notification] Skipping WhatsApp - ${whatsappResult.reason}`);
        }

        // Handle push notification
        let pushResult = { sent: false };
        
        if (send_push && userHasPushEnabled) {
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
                // Send push immediately via OneSignal REST API
                try {
                    // Use subscription_id if available, otherwise fall back to external_id
                    const subscriptionId = targetUser?.onesignal_subscription_id;
                    
                    console.log(`[Notification] Sending push via OneSignal to subscription ${subscriptionId}`);
                    
                    const oneSignalPayload = {
                        app_id: ONESIGNAL_APP_ID,
                        // Target by subscription ID for reliable delivery
                        include_subscription_ids: [subscriptionId],
                        contents: { 
                            en: message,
                            he: message
                        },
                        headings: { 
                            en: title,
                            he: title
                        },
                        data: {
                            notification_id: inAppNotification.id,
                            link: link || ''
                        }
                    };
                    
                    // Add URL if link is provided
                    if (link) {
                        oneSignalPayload.url = link;
                    }
                    
                    console.log(`[Notification] OneSignal payload:`, JSON.stringify(oneSignalPayload));
                    
                    const response = await fetch('https://onesignal.com/api/v1/notifications', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Basic ${ONESIGNAL_API_KEY}`
                        },
                        body: JSON.stringify(oneSignalPayload)
                    });
                    
                    const result = await response.json();
                    
                    console.log(`[Notification] OneSignal response:`, JSON.stringify(result));
                    
                    if (result.id && result.recipients > 0) {
                        await base44.asServiceRole.entities.InAppNotification.update(inAppNotification.id, {
                            push_sent: true
                        });
                        pushResult = { sent: true, recipients: result.recipients, onesignal_id: result.id };
                        console.log(`[Notification] Push sent successfully. Recipients: ${result.recipients}`);
                    } else if (result.errors) {
                        console.warn('[Notification] OneSignal errors:', result.errors);
                        pushResult = { 
                            sent: false, 
                            error: result.errors,
                            recipients: result.recipients || 0
                        };
                    } else {
                        pushResult = { 
                            sent: false, 
                            error: 'No recipients or unknown error',
                            recipients: result.recipients || 0
                        };
                        console.warn('[Notification] Push failed or no recipients:', JSON.stringify(result));
                    }
                } catch (pushError) {
                    console.error('[Notification] Push send error:', pushError);
                    pushResult = { sent: false, error: pushError.message };
                }
            }
        } else if (send_push && !userHasPushEnabled) {
            pushResult = { sent: false, reason: 'User has not enabled push notifications' };
            console.log(`[Notification] Skipping push - user has not enabled push notifications`);
        }
        
        return Response.json({
            success: true,
            notification_id: inAppNotification.id,
            push: pushResult,
            whatsapp: whatsappResult
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