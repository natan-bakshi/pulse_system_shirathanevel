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
            check_quiet_hours = true,
            target_phone = null // Allow overriding target phone for testing
        } = payload;
        
        // WhatsApp message override (optional) - defaults to standard message
        const whatsapp_message = payload.whatsapp_message || message;
        
        if (!target_user_id || !title || !message) {
            return Response.json({ error: 'target_user_id, title, and message are required' }, { status: 400 });
        }
        
        console.log(`[Notification] Creating notification for user ${target_user_id}: ${title}`);
        
        // --- 1. Smart User & Phone Resolution ---
        let targetUser = null;
        let resolvedPhone = target_phone; // Use override if provided
        let targetUser = null;

        try {
            // Try to resolve phone from related supplier FIRST if supplier_id is provided
            if (!resolvedPhone && related_supplier_id) {
                const supplier = await base44.asServiceRole.entities.Supplier.get(related_supplier_id);
                if (supplier?.phone) {
                    resolvedPhone = supplier.phone;
                    console.log(`[Notification] Resolved phone from related Supplier ${related_supplier_id}: ${resolvedPhone}`);
                }
            }

            // Then try to resolve from client/event parents if event_id is provided (for client notifications)
            if (!resolvedPhone && related_event_id) {
                const event = await base44.asServiceRole.entities.Event.get(related_event_id);
                if (event?.parents && Array.isArray(event.parents)) {
                    // Find parent matching target_user_email if available, or just take the first phone
                    const parent = event.parents.find(p => p.email && p.email.toLowerCase().trim() === target_user_email?.toLowerCase().trim());
                    if (parent?.phone) {
                        resolvedPhone = parent.phone;
                        console.log(`[Notification] Resolved phone from Event parent ${related_event_id}: ${resolvedPhone}`);
                    } else if (event.parents.length > 0 && event.parents[0].phone) {
                        resolvedPhone = event.parents[0].phone; // Fallback to first parent's phone
                        console.log(`[Notification] Resolved phone from first Event parent ${related_event_id} (fallback): ${resolvedPhone}`);
                    }
                }
            }

            // Finally, try to fetch targetUser and use their phone or search by email (existing logic, but now as a fallback)
            const users = await base44.asServiceRole.entities.User.filter({ id: target_user_id });
            targetUser = users.length > 0 ? users[0] : null;

            if (targetUser && !resolvedPhone) {
                resolvedPhone = targetUser.phone;
                
                // If phone is still missing AND targetUser.email exists, try more generic searches
                if (!resolvedPhone && targetUser.email) {
                    const emailToFind = targetUser.email.toLowerCase().trim();
                    console.log(`[Notification] User ${target_user_id} missing phone, searching entities by email: ${emailToFind} (fallback)`);
                    
                    // 1. Check Suppliers (generic email search if not already found by ID)
                    if (!related_supplier_id) { // Avoid redundant search if already checked by ID
                        const suppliers = await base44.asServiceRole.entities.Supplier.list();
                        const supplier = suppliers.find(s => 
                            s.contact_emails && 
                            Array.isArray(s.contact_emails) && 
                            s.contact_emails.some(e => e && e.toLowerCase().trim() === emailToFind)
                        );
                        if (supplier && supplier.phone) {
                            resolvedPhone = supplier.phone;
                            console.log(`[Notification] Resolved phone from Supplier (generic) ${supplier.id}: ${resolvedPhone}`);
                        }
                    }

                    // 2. Check Clients (Event Parents) if still missing (generic email search)
                    if (!resolvedPhone && !related_event_id) { // Avoid redundant search if already checked by ID
                        const events = await base44.asServiceRole.entities.Event.filter({ status: { $ne: 'cancelled' } });
                        for (const event of events) {
                            if (event.parents && Array.isArray(event.parents)) {
                                const parent = event.parents.find(p => 
                                    p.email && p.email.toLowerCase().trim() === emailToFind
                                );
                                if (parent && parent.phone) {
                                    resolvedPhone = parent.phone;
                                    console.log(`[Notification] Resolved phone from Event (Client generic) ${event.id}: ${resolvedPhone}`);
                                    break; 
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[Notification] Error during phone resolution:', e.message);
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
                        // Get base URL from payload or default to current origin (not available in Deno) or hardcoded app domain
                        // User requested full HTTPS path. 
                        const baseUrl = payload.base_url || 'https://app.base44.com'; 
                        
                        link = generateDynamicUrl(template.dynamic_url_type, {
                            event_id: related_event_id,
                            supplier_id: related_supplier_id,
                            user_role: targetUser?.role || targetUser?.user_type || 'client'
                        }, baseUrl);
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
        
        // Check if user has whatsapp enabled (Forced TRUE for everyone if phone exists)
        // We ignore targetUser.whatsapp_enabled preference as per requirement
        const userHasWhatsAppEnabled = !!resolvedPhone; 
        
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

        // --- Global Delay Check (Shabbat / Quiet Hours) ---
        let shouldDelay = false;
        let scheduledFor = null;
        let delayReason = '';

        // 1. Check Shabbat (Friday 16:00 - Saturday 20:00)
        if (isShabbat()) {
            shouldDelay = true;
            scheduledFor = getShabbatEndTime();
            delayReason = 'Shabbat';
            console.log(`[Notification] Shabbat mode active. Scheduling notification for: ${scheduledFor.toISOString()}`);
        }
        // 2. Check Quiet Hours (Default 22:00 - 08:00 if not set)
        else if (check_quiet_hours) {
            const startHour = targetUser?.quiet_start_hour !== undefined ? targetUser.quiet_start_hour : 22;
            const endHour = targetUser?.quiet_end_hour !== undefined ? targetUser.quiet_end_hour : 8;
            
            if (isInQuietHours(startHour, endHour)) {
                shouldDelay = true;
                scheduledFor = getQuietHoursEndTime(endHour);
                delayReason = 'Quiet Hours';
                console.log(`[Notification] Quiet hours active (${startHour}-${endHour}). Scheduling notification for: ${scheduledFor.toISOString()}`);
            }
        }

        if (shouldDelay && scheduledFor) {
            await base44.asServiceRole.entities.PendingPushNotification.create({
                user_id: target_user_id,
                user_email: target_user_email || targetUser?.email,
                title,
                message,
                link: link || '',
                scheduled_for: scheduledFor.toISOString(),
                template_type: template_type || 'CUSTOM',
                in_app_notification_id: inAppNotification.id,
                is_sent: false,
                data: JSON.stringify({
                    send_whatsapp: send_whatsapp && userHasWhatsAppEnabled,
                    whatsapp_message: whatsapp_message // Pass the specific whatsapp message
                })
            });
            
            await base44.asServiceRole.entities.InAppNotification.update(inAppNotification.id, {
                push_scheduled_for: scheduledFor.toISOString()
            });
            
            return Response.json({
                success: true,
                notification_id: inAppNotification.id,
                push: { sent: false, scheduled: true, scheduled_for: scheduledFor.toISOString() },
                whatsapp: { sent: false, scheduled: true, reason: `Delayed due to ${delayReason}` }
            });
        }
        
        // Handle WhatsApp notification (Immediate)
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
                let contentToSend = whatsapp_message;
                
                // Construct Absolute Link
                const currentBaseUrl = (payload.base_url || 'https://app.base44.com').replace(/\/$/, '');
                const fullLink = link ? (link.startsWith('http') ? link : `${currentBaseUrl}${link.startsWith('/') ? link : '/' + link}`) : '';
                
                const whatsappContent = `*${title}*\n\n${contentToSend}${fullLink ? `\n\n${fullLink}` : ''}`;

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
            // Then check user quiet hours (or default for unregistered/missing config)
            else if (check_quiet_hours) {
                // Default quiet hours: 22:00 to 08:00
                const startHour = targetUser?.quiet_start_hour !== undefined ? targetUser.quiet_start_hour : 22;
                const endHour = targetUser?.quiet_end_hour !== undefined ? targetUser.quiet_end_hour : 8;
                
                const isQuiet = isInQuietHours(startHour, endHour);
                
                if (isQuiet) {
                    shouldDelayPush = true;
                    scheduledFor = getQuietHoursEndTime(endHour);
                    console.log(`[Notification] Quiet hours active (${startHour}-${endHour}). Scheduling notification for: ${scheduledFor.toISOString()}`);
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
function generateDynamicUrl(type, context, baseUrl) {
    // Ensure baseUrl doesn't have trailing slash
    const base = baseUrl.replace(/\/$/, '');
    
    let path = '';
    switch (type) {
        case 'event_page':
            path = context.event_id ? `/EventDetails?id=${context.event_id}` : '';
            break;
        case 'payment_page':
            path = context.event_id ? `/EventDetails?id=${context.event_id}&tab=payments` : '';
            break;
        case 'assignment_page':
            path = context.user_role === 'supplier' 
                ? `/SupplierDashboard` 
                : `/EventManagement?id=${context.event_id}&tab=suppliers`;
            break;
        case 'calendar_page':
            path = `/EventManagement?tab=board`;
            break;
        case 'settings_page':
            path = `/MyNotificationSettings`;
            break;
        default:
            path = '';
    }
    
    return path ? `${base}${path}` : '';
}

// Helper function: Check if current time is during Shabbat (Friday 16:00 - Saturday 20:00)
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
    
    // Friday after 16:00
    if (day === 'Fri' && hour >= 16) return true;
    // All day Saturday until 20:00
    if (day === 'Sat' && hour < 20) return true;
    
    return false;
}

// Helper function: Get end of Shabbat time (Saturday 20:00)
function getShabbatEndTime(timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: timezone
    });
    const day = formatter.format(now);
    
    // Calculate next Saturday 20:00
    const endTime = new Date(now);
    
    if (day === 'Fri') {
        // Move to Saturday
        endTime.setDate(endTime.getDate() + 1);
    }
    // Set to 20:00
    endTime.setHours(20, 0, 0, 0);
    
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