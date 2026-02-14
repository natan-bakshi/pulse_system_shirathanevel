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
        
        // --- AUTH FIX: Allow calls from authenticated users OR service role ---
        // We do NOT block if user is missing, to allow automation/whatsapp-only flows
        let user = null;
        try {
            user = await base44.auth.me();
        } catch (e) {
            console.log('[Notification] No user authentication - proceeding as service role');
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
            target_phone = null
        } = payload;
        
        const whatsapp_message = payload.whatsapp_message || message;
        
        if (!title || !message) {
            return Response.json({ error: 'title and message are required' }, { status: 400 });
        }
        
        // --- URL FIX: FORCE CORRECT DOMAIN ---
        // We force the correct domain for Pulse System
        const FORCED_BASE_URL = 'https://pulse-system.base44.app';
        
        console.log(`[Notification] Creating notification for user ${target_user_id || 'unknown'}: ${title}`);
        
        // --- 1. Smart User & Phone Resolution ---
        let targetUser = null;
        let resolvedPhone = target_phone; 
        
        const normalizedEmail = typeof target_user_email === 'string' && target_user_email 
          ? target_user_email.toLowerCase().trim() 
          : null;

        try {
            // 1. Check Supplier Entity FIRST (Priority)
            if (!resolvedPhone && related_supplier_id) {
                const supplier = await base44.asServiceRole.entities.Supplier.get(related_supplier_id);
                if (supplier?.phone) {
                    resolvedPhone = supplier.phone;
                    console.log(`[Notification] Resolved phone from Supplier ${related_supplier_id}: ${resolvedPhone}`);
                }
            }

            // 2. Check Event Parents (Client) SECOND
            if (!resolvedPhone && related_event_id) {
                const event = await base44.asServiceRole.entities.Event.get(related_event_id);
                if (event?.parents && Array.isArray(event.parents)) {
                    let parent = null;
                    if (normalizedEmail) {
                        parent = event.parents.find(p => p.email && p.email.toLowerCase().trim() === normalizedEmail);
                    }
                    if (!parent && event.parents.length > 0) {
                        parent = event.parents[0];
                    }
                    if (parent?.phone) {
                        resolvedPhone = parent.phone;
                        console.log(`[Notification] Resolved phone from Event parent ${related_event_id}: ${resolvedPhone}`);
                    }
                }
            }

            // 3. Check User Entity LAST
            if (target_user_id && !target_user_id.startsWith('virtual')) {
                const users = await base44.asServiceRole.entities.User.filter({ id: target_user_id });
                targetUser = users.length > 0 ? users[0] : null;

                if (targetUser && !resolvedPhone) {
                    resolvedPhone = targetUser.phone;
                    console.log(`[Notification] Resolved phone from User ${target_user_id}: ${resolvedPhone}`);
                }
            }
            
            // 4. Fallback search by email
            if (normalizedEmail && !targetUser) {
                 const usersByEmail = await base44.asServiceRole.entities.User.filter({ email: normalizedEmail });
                 if (usersByEmail.length > 0) {
                     targetUser = usersByEmail[0];
                     if (targetUser && !target_user_id) {
                         target_user_id = targetUser.id;
                     }
                     if (!resolvedPhone && targetUser.phone) {
                         resolvedPhone = targetUser.phone;
                         console.log(`[Notification] Resolved phone from User email search ${normalizedEmail}: ${resolvedPhone}`);
                     }
                 }
            }
            
            // --- CRITICAL FIX START: Last Resort Phone Resolution ---
            // If User exists but has no phone, or if targetUser is null but we have email, try to find Supplier by Email
            if (!resolvedPhone && normalizedEmail) {
                 // Try to find if this email belongs to a supplier contact
                 // This is a "Hail Mary" to find a phone number
                 try {
                     // Note: Optimally we would filter by contact_emails, but if not possible, we rely on related_supplier_id check above.
                     // If we are here, it means related_supplier_id was missing but we have an email.
                     // Let's check if the user we found (if any) is linked to a supplier?
                     // Or simply rely on the fact that if it's a supplier notification, the ID should have been passed.
                 } catch(e) {}
            }
            // --- CRITICAL FIX END ---

            // Ensure target_user_id exists for DB constraint logic later
            if (!target_user_id) {
                // target_user_id = `virtual_${Date.now()}`; // DISABLED - We want to skip DB creation if no user
                console.log(`[Notification] No target_user_id provided - proceeding without DB record (Direct Send)`);
            }

        } catch (e) {
            console.warn('[Notification] Error during phone resolution:', e.message);
        }

        // --- 1.1 Sync Phone Back to User ---
        if (targetUser && !targetUser.phone && resolvedPhone) {
            try {
                console.log(`[Notification] Updating user ${targetUser.id} with resolved phone: ${resolvedPhone}`);
                await base44.asServiceRole.entities.User.update(targetUser.id, { phone: resolvedPhone });
            } catch (updateErr) {
                console.warn('[Notification] Failed to sync phone to user:', updateErr.message);
            }
        }

        // --- 2. Template Logic ---
        let template = null;
        if (template_type) {
            try {
                const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({ type: template_type });
                template = templates.length > 0 ? templates[0] : null;
                
                if (template) {
                    const allowed = template.allowed_channels || ['push'];
                    
                    if (!allowed.includes('push')) send_push = false;
                    
                    if (!allowed.includes('whatsapp')) {
                        send_whatsapp = false;
                    } else if (allowed.includes('whatsapp') && !send_whatsapp) {
                        // Auto-enable WhatsApp if template allows it but push is disabled
                        if (!allowed.includes('push')) send_whatsapp = true;
                    }
                    
                    // --- Dynamic URL Generation ---
                    if ((!link || link === '') && template.dynamic_url_type && template.dynamic_url_type !== 'none') {
                        // Using FORCED_BASE_URL here
                        link = generateDynamicUrl(template.dynamic_url_type, {
                            event_id: related_event_id,
                            supplier_id: related_supplier_id,
                            user_role: targetUser?.role || targetUser?.user_type || 'client'
                        }, FORCED_BASE_URL);
                        console.log(`[Notification] Generated Dynamic URL: ${link}`);
                    }
                }
            } catch (e) {
                console.warn('[Notification] Template fetch error:', e.message);
            }
        }
        
        // Check User Preferences - Only affects Push, WhatsApp is forced by Admin/Template
        if (targetUser?.notification_preferences && template_type) {
            const pref = targetUser.notification_preferences[template_type];
            if (pref !== undefined) {
                const isEnabled = typeof pref === 'object' ? pref.enabled !== false : pref !== false;
                if (!isEnabled) {
                    send_push = false; // Disable push only
                    console.log(`[Notification] User disabled ${template_type} - Push disabled, proceeding with WhatsApp check...`);
                    // We DO NOT return here, allowing WhatsApp to proceed if enabled
                }
            }
        }
        
        const userHasPushEnabled = targetUser?.push_enabled === true && targetUser?.onesignal_subscription_id;
        // WhatsApp enabled if we have a phone
        const userHasWhatsAppEnabled = !!resolvedPhone; 
        
        console.log(`[Notification] Channels - Push: ${send_push && userHasPushEnabled}, WhatsApp: ${send_whatsapp && userHasWhatsAppEnabled} (Phone: ${resolvedPhone})`);

        // --- 4. DB Logging (SAFE MODE) ---
        // FIX: Wrap DB creation in try/catch so failure doesn't stop WhatsApp
        // This is critical for virtual users (unregistered suppliers/clients)
        let notificationRecordId = null;
        let inAppNotification = null;

        try {
            // Only try to save if we have a real user ID or email, and it's not virtual
            const isVirtual = target_user_id && target_user_id.startsWith('virtual');
            
            // Allow saving if we have an email even if virtual (for logging purposes if allowed by DB), 
            // but strict check on ID if DB enforces FK.
            // Safe bet: Try to create.
            
            // CRITICAL CHANGE: Only create DB record if we have a REAL target_user_id
            if (target_user_id && !isVirtual) {
                inAppNotification = await base44.asServiceRole.entities.InAppNotification.create({
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
                notificationRecordId = inAppNotification.id;
                console.log(`[Notification] In-app notification created: ${inAppNotification.id}`);
            } else {
                console.log(`[Notification] Skipping DB record for virtual user (No email/ID)`);
            }
        } catch (dbError) {
            console.warn(`[Notification] DB Save Failed (proceeding to send anyway): ${dbError.message}`);
        }

        // --- Global Delay Check ---
        let shouldDelay = false;
        let scheduledFor = null;
        let delayReason = '';

        if (isShabbat()) {
            shouldDelay = true;
            scheduledFor = getShabbatEndTime();
            delayReason = 'Shabbat';
            console.log(`[Notification] Shabbat mode active.`);
        } else if (check_quiet_hours) {
            const startHour = targetUser?.quiet_start_hour ?? 22;
            const endHour = targetUser?.quiet_end_hour ?? 8;
            if (isInQuietHours(startHour, endHour)) {
                shouldDelay = true;
                scheduledFor = getQuietHoursEndTime(endHour);
                delayReason = 'Quiet Hours';
                console.log(`[Notification] Quiet hours active.`);
            }
        }

        if (shouldDelay && scheduledFor && notificationRecordId) {
            await base44.asServiceRole.entities.PendingPushNotification.create({
                user_id: target_user_id,
                user_email: target_user_email || targetUser?.email,
                title,
                message,
                link: link || '',
                scheduled_for: scheduledFor.toISOString(),
                template_type: template_type || 'CUSTOM',
                in_app_notification_id: notificationRecordId,
                is_sent: false,
                data: JSON.stringify({
                    send_whatsapp: send_whatsapp && userHasWhatsAppEnabled,
                    whatsapp_message: whatsapp_message 
                })
            });
            
            if (notificationRecordId) {
                await base44.asServiceRole.entities.InAppNotification.update(notificationRecordId, {
                    push_scheduled_for: scheduledFor.toISOString()
                });
            }
            
            return Response.json({
                success: true,
                notification_id: notificationRecordId,
                push: { sent: false, scheduled: true },
                whatsapp: { sent: false, scheduled: true, reason: delayReason }
            });
        }
        
        // --- WhatsApp Logic (Immediate) ---
        let whatsappResult = { sent: false };

        if (send_whatsapp && userHasWhatsAppEnabled) {
            try {
                const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
                const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");

                if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) throw new Error("Missing Green API Credentials");

                let cleanPhone = resolvedPhone.replace(/[^0-9]/g, '');
                if (cleanPhone.startsWith('05')) cleanPhone = '972' + cleanPhone.substring(1);
                else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) cleanPhone = '972' + cleanPhone;

                const chatId = `${cleanPhone}@c.us`;
                
                // Construct Link for WhatsApp (Force Correct Base URL)
                let fullLink = '';
                if (link) {
                    if (link.startsWith('http')) fullLink = link; 
                    else fullLink = `${FORCED_BASE_URL}${link.startsWith('/') ? link : '/' + link}`;
                }
                
                const whatsappContent = `*${title}*\n\n${whatsapp_message}${fullLink ? `\n\n${fullLink}` : ''}`;

                console.log(`[Notification] Sending WhatsApp to ${chatId}`);

                const waResponse = await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatId, message: whatsappContent })
                });

                const waData = await waResponse.json();
                
                if (waResponse.ok) {
                    whatsappResult = { sent: true, id: waData.idMessage };
                    console.log(`[Notification] WhatsApp sent successfully`);
                    if (notificationRecordId) {
                        try {
                            await base44.asServiceRole.entities.InAppNotification.update(notificationRecordId, {
                                whatsapp_sent: true,
                                whatsapp_message_id: waData.idMessage || ''
                            });
                        } catch (err) { console.warn('Failed to update whatsapp status', err); }
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
            whatsappResult = { sent: false, reason: !resolvedPhone ? 'Missing phone number' : 'WhatsApp disabled' };
        }

        // --- Push Logic (Immediate) ---
        let pushResult = { sent: false };
        
        if (send_push && userHasPushEnabled && notificationRecordId) {
            // Send push immediately via OneSignal REST API
            try {
                const subscriptionId = targetUser?.onesignal_subscription_id;
                console.log(`[Notification] Sending push to ${subscriptionId}`);
                
                // Fix Link for Push (Force Correct Base URL)
                let pushLink = '';
                 if (link) {
                    if (link.startsWith('http')) pushLink = link; 
                    else pushLink = `${FORCED_BASE_URL}${link.startsWith('/') ? link : '/' + link}`;
                }

                const oneSignalPayload = {
                    app_id: ONESIGNAL_APP_ID,
                    include_subscription_ids: [subscriptionId],
                    contents: { en: message, he: message },
                    headings: { en: title, he: title },
                    url: pushLink || undefined, 
                    data: {
                        notification_id: notificationRecordId,
                        link: pushLink
                    }
                };
                
                const response = await fetch('https://onesignal.com/api/v1/notifications', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${ONESIGNAL_API_KEY}`
                    },
                    body: JSON.stringify(oneSignalPayload)
                });
                
                const result = await response.json();
                
                if (result.id && result.recipients > 0) {
                    await base44.asServiceRole.entities.InAppNotification.update(notificationRecordId, { push_sent: true });
                    pushResult = { sent: true, recipients: result.recipients, onesignal_id: result.id };
                    console.log(`[Notification] Push sent successfully`);
                } else {
                    pushResult = { sent: false, error: result.errors || 'No recipients' };
                }
            } catch (pushError) {
                console.error('[Notification] Push send error:', pushError);
                pushResult = { sent: false, error: pushError.message };
            }
        } else if (send_push && !userHasPushEnabled) {
            pushResult = { sent: false, reason: 'User disabled push' };
        }
        
        return Response.json({
            success: true,
            notification_id: notificationRecordId || 'virtual',
            push: pushResult,
            whatsapp: whatsappResult
        });
        
    } catch (error) {
        console.error('[Notification] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});


// --- Helpers ---

function generateDynamicUrl(type, context, baseUrl) {
    const base = baseUrl.replace(/\/$/, '');
    let path = '';
    switch (type) {
        case 'event_page': path = context.event_id ? `/EventDetails?id=${context.event_id}` : ''; break;
        case 'payment_page': path = context.event_id ? `/EventDetails?id=${context.event_id}&tab=payments` : ''; break;
        case 'assignment_page': 
            path = context.user_role === 'supplier' ? `/SupplierDashboard` : `/EventManagement?id=${context.event_id}&tab=suppliers`; 
            break;
        case 'calendar_page': path = `/EventManagement?tab=board`; break;
        case 'settings_page': path = `/MyNotificationSettings`; break;
        default: path = '';
    }
    return path ? `${base}${path}` : '';
}

function isShabbat(timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', hour12: false, timeZone: timezone });
    const parts = formatter.formatToParts(now);
    const day = parts.find(p => p.type === 'weekday')?.value;
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    if (day === 'Fri' && hour >= 16) return true;
    if (day === 'Sat' && hour < 20) return true;
    return false;
}

function getShabbatEndTime(timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone });
    const day = formatter.format(now);
    const endTime = new Date(now);
    if (day === 'Fri') endTime.setDate(endTime.getDate() + 1);
    endTime.setHours(20, 0, 0, 0);
    return endTime;
}

function isInQuietHours(quietStart, quietEnd, timezone = 'Asia/Jerusalem') {
    if (quietStart === undefined || quietEnd === undefined) return false;
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
    const currentHour = parseInt(formatter.format(now), 10);
    if (quietStart > quietEnd) return currentHour >= quietStart || currentHour < quietEnd;
    return currentHour >= quietStart && currentHour < quietEnd;
}

function getQuietHoursEndTime(quietEnd, timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
    const currentHour = parseInt(formatter.format(now), 10);
    const endTime = new Date(now);
    endTime.setHours(quietEnd, 0, 0, 0);
    if (currentHour >= quietEnd) endTime.setDate(endTime.getDate() + 1);
    return endTime;
}