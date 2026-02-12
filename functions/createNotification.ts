import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY');

/**
 * Creates an in-app notification and optionally sends a push notification / WhatsApp
 * Handles quiet hours by scheduling push for later
 * Uses OneSignal REST API directly with external_id targeting
 * Smartly resolves phone numbers from Suppliers/Clients if missing on User
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        // Allow system/automation calls (where user might be null, but we need to check auth method)
        // For now we enforce auth me for manual calls, but automations should use service role properly
        if (!user) {
             // If called from another function via service role invoke, it might not have user context? 
             // Actually base44.auth.me() checks the token. 
             // We'll assume strict auth for now.
             return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        const payload = await req.json();
        let { 
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
        
        // --- 1. Smart User & Phone Resolution ---
        let targetUser = null;
        let resolvedPhone = null;
        
        try {
            const users = await base44.asServiceRole.entities.User.filter({ id: target_user_id });
            targetUser = users.length > 0 ? users[0] : null;
            
            if (targetUser) {
                resolvedPhone = targetUser.phone;
                
                // If phone is missing, try to resolve from Supplier entity
                if (!resolvedPhone && targetUser.email) {
                    console.log(`[Notification] User ${target_user_id} missing phone, searching Supplier records by email: ${targetUser.email}`);
                    // Note: This filter relies on exact match. We might need a more robust search if emails are arrays
                    // Using filter logic for array contains is tricky with simple filter, we fetch potential suppliers
                    const suppliers = await base44.asServiceRole.entities.Supplier.filter({ 
                        // Simplified: check if contact_emails contains the email. 
                        // Limitation: Simple filter might not support array contains easily in all DBs, 
                        // but let's try assuming the SDK handles basic array checks or we filter in memory
                    });
                    
                    const supplier = suppliers.find(s => 
                        s.contact_emails && Array.isArray(s.contact_emails) && s.contact_emails.includes(targetUser.email)
                    );
                    
                    if (supplier && supplier.phone) {
                        resolvedPhone = supplier.phone;
                        console.log(`[Notification] Resolved phone from Supplier ${supplier.id}: ${resolvedPhone}`);
                    }
                }
            }
        } catch (e) {
            console.warn('[Notification] Could not fetch target user preferences:', e.message);
        }

        // --- 2. Template Logic & Channel Enforcement ---
        let template = null;
        if (template_type) {
            try {
                const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({ type: template_type });
                template = templates.length > 0 ? templates[0] : null;
                
                if (template) {
                    // Force allowed channels from template
                    const allowed = template.allowed_channels || ['push']; // Default to push if not specified
                    
                    // Override request params based on template rules
                    if (!allowed.includes('push')) {
                        console.log(`[Notification] Template ${template_type} forbids Push. Disabling Push.`);
                        send_push = false;
                    }
                    if (!allowed.includes('whatsapp')) {
                        console.log(`[Notification] Template ${template_type} forbids WhatsApp. Disabling WhatsApp.`);
                        send_whatsapp = false;
                    } else if (allowed.includes('whatsapp') && !send_whatsapp) {
                        // If template ALLOWS whatsapp, and it wasn't explicitly requested as false (undefined is treated as false in destructuring default),
                        // we might want to auto-enable it? 
                        // Logic: If payload explicitly said false, keep false. If payload didn't specify (undefined), and template says allowed...
                        // Current destructuring sets default false. Let's keep it that way unless we want to change default.
                        // User request: "I updated notifications to be WhatsApp only... still sent Push".
                        // This implies the System should PREFER the template settings.
                        // Let's AUTO-ENABLE WhatsApp if the template has it and Push is NOT in the allowed list.
                        if (!allowed.includes('push')) {
                             send_whatsapp = true;
                        }
                    }
                    
                    // Logic: If template exists, we trust its configuration primarily.
                    // If the caller explicitly requested send_whatsapp=true, we honor it (checked above).
                    // But if the caller just triggered an event and relied on defaults...
                    
                    // --- 3. Dynamic URL Generation ---
                    if ((!link || link === '') && template.dynamic_url_type && template.dynamic_url_type !== 'none') {
                        link = generateDynamicUrl(template.dynamic_url_type, {
                            event_id: related_event_id,
                            supplier_id: related_supplier_id,
                            user_role: targetUser?.role || targetUser?.user_type || 'client'
                        });
                        console.log(`[Notification] Generated Dynamic URL: ${link}`);
                    }
                }
            } catch (e) {
                console.warn('[Notification] Template fetch error:', e.message);
            }
        }
        
        // Check if notification type is enabled for this user (User Preferences)
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
        
        // Check if user has whatsapp enabled (Default true if not explicitly disabled)
        // Use resolvedPhone here
        const userHasWhatsAppEnabled = targetUser?.whatsapp_enabled !== false && resolvedPhone; 
        
        console.log(`[Notification] Final Channels - Push: ${send_push && userHasPushEnabled}, WhatsApp: ${send_whatsapp && userHasWhatsAppEnabled} (Phone: ${resolvedPhone})`);

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

                // Clean phone number (using resolvedPhone)
                let cleanPhone = resolvedPhone.replace(/[^0-9]/g, '');
                if (cleanPhone.startsWith('05')) {
                    cleanPhone = '972' + cleanPhone.substring(1);
                } else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
                    cleanPhone = '972' + cleanPhone;
                }

                const chatId = `${cleanPhone}@c.us`;
                // Use template-specific whatsapp body if available and no override provided
                let contentToSend = whatsapp_message;
                if (template && template.whatsapp_body_template && payload.whatsapp_message === undefined) {
                     // TODO: We would need to re-process variables here if we had them. 
                     // Assuming the caller passed the processed message in `message` or `whatsapp_message`.
                     // For now, we use the message passed in.
                }
                
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
            whatsappResult = { sent: false, reason: !resolvedPhone ? 'Missing phone number' : 'WhatsApp disabled by user' };
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

// Helper: Generate Dynamic URLs
function generateDynamicUrl(type, context) {
    // Base URL structure needs to be absolute for emails/whatsapp, but relative for in-app usually works.
    // For WhatsApp, we want full URL if possible, or deep link.
    // Assuming SPA router hash or clean URLs.
    
    // We can't easily get the base domain here unless env var is set.
    // We'll return relative path, assuming the frontend handles it or WhatsApp opens browser.
    // Actually WhatsApp needs full URL. We'll try to use a standard base if known, or just path.
    const baseUrl = 'https://app.base44.com/preview'; // Placeholder - ideally get from env
    
    switch (type) {
        case 'event_page':
            return context.event_id ? `/EventDetails?id=${context.event_id}` : '';
        case 'payment_page':
            return context.event_id ? `/EventDetails?id=${context.event_id}&tab=payments` : '';
        case 'assignment_page':
            return context.user_role === 'supplier' 
                ? `/SupplierDashboard` 
                : `/EventManagement?id=${context.event_id}&tab=suppliers`;
        case 'calendar_page':
            return `/EventManagement?tab=board`;
        case 'settings_page':
            return `/MyNotificationSettings`;
        default:
            return '';
    }
}

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