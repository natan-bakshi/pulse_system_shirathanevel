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

        if (pendingNotifications.length === 0) {
            return Response.json({
                success: true,
                skipped: true,
                reason: 'No pending notifications',
                processed: 0,
                sent: 0,
                errors: 0,
                cleaned_up: 0
            });
        }
        
        // Filter to only those that are due (scheduled_for <= now)
        const dueNotifications = pendingNotifications.filter(n => {
            if (!n.scheduled_for) return false;
            return new Date(n.scheduled_for) <= new Date(now);
        });
        
        console.log(`[ScheduledPush] Found ${dueNotifications.length} due notifications`);

        if (dueNotifications.length === 0) {
            return Response.json({
                success: true,
                skipped: true,
                reason: 'No due notifications',
                processed: 0,
                sent: 0,
                errors: 0,
                cleaned_up: 0
            });
        }
        
        let successCount = 0;
        let errorCount = 0;
        
        for (const pending of dueNotifications) {
            try {
                // --- EVENT REMINDER FAN-OUT ---
                // תזכורת אירוע אחת לאירוע, שמתפצלת בעת השליחה לכל הספקים
                // המאושרים + המנהלים. מטופלת בנפרד מלוגיקת המשתמש-הבודד.
                if (pending.condition_type === 'event_reminder_fanout') {
                    // בדיקת שבת: אם שבת - דחה ליציאת השבת
                    if (isShabbat()) {
                        const shabbatEnd = getShabbatEndTime();
                        await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, {
                            scheduled_for: shabbatEnd.toISOString()
                        });
                        continue;
                    }
                    const fanoutResult = await processEventReminderFanout(base44, pending, ONESIGNAL_APP_ID, ONESIGNAL_API_KEY);
                    await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, { is_sent: true });
                    successCount += fanoutResult.sent;
                    console.log(`[ScheduledPush] Fan-out for event ${pending.related_event_id}: sent ${fanoutResult.sent}`);
                    continue;
                }

                // --- CONDITION RE-CHECK (lazy evaluation) ---
                // לפני שליחה בפועל: אם להתראה יש תנאי עסקי, בדוק שהוא עדיין מתקיים.
                // אם התנאי כבר לא רלוונטי (הספק הגיב / השיבוץ הושלם / החוב שולם) -
                // סמן כנשלח (ביטול שקט) ואל תשלח.
                if (pending.condition_type && pending.condition_type !== 'none') {
                    const stillRelevant = await isConditionStillMet(base44, pending);
                    if (!stillRelevant) {
                        await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, { is_sent: true });
                        console.log(`[ScheduledPush] Condition '${pending.condition_type}' no longer met for ${pending.id} - skipping (silent)`);
                        continue;
                    }
                }

                // Check if user is still not in quiet hours
                let targetUser = null;
                try {
                    const users = await base44.asServiceRole.entities.User.filter({ id: pending.user_id });
                    targetUser = users.length > 0 ? users[0] : null;
                } catch (e) {
                    console.warn(`[ScheduledPush] Could not fetch user ${pending.user_id}:`, e.message);
                }

                // Verify not in Shabbat (Friday 16:00 - Saturday 20:00)
                if (isShabbat()) {
                    const shabbatEnd = getShabbatEndTime();
                    await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, {
                        scheduled_for: shabbatEnd.toISOString()
                    });
                    console.log(`[ScheduledPush] Shabbat active. Rescheduled for ${shabbatEnd.toISOString()}`);
                    continue;
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
                    // Use stored phone from data (preferred) or fallback to targetUser.phone
                    const phoneToUse = whatsappData.phone || targetUser?.phone;
                    
                    if (phoneToUse) {
                        try {
                            const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
                            const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");
                            
                            if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                                let cleanPhone = phoneToUse.toString().replace(/[^0-9]/g, '');
                                if (cleanPhone.startsWith('05')) cleanPhone = '972' + cleanPhone.substring(1);
                                else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) cleanPhone = '972' + cleanPhone;
                                
                                const chatId = `${cleanPhone}@c.us`;
                                const waMsg = whatsappData.whatsapp_message || pending.message;
                                
                                await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ chatId, message: waMsg })
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
                    } else {
                        console.log(`[ScheduledPush] No phone found for pending WhatsApp ${pending.id}`);
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

// Helper function: Get end of Shabbat time
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

// ============================================================
// בדיקת תנאי עסקי לפני שליחה (Lazy Evaluation)
// מחזיר true אם ההתראה עדיין רלוונטית וצריך לשלוח, אחרת false.
// ============================================================
async function isConditionStillMet(base44, pending) {
    try {
        switch (pending.condition_type) {
            case 'supplier_still_pending': {
                // פאזה 4: שלח רק אם הספק עדיין במצב 'pending' באותו שירות.
                if (!pending.related_event_service_id || !pending.related_supplier_id) return false;
                const es = await base44.asServiceRole.entities.EventService.get(pending.related_event_service_id);
                if (!es) return false;
                let statuses = {};
                let supplierIds = [];
                try { statuses = JSON.parse(es.supplier_statuses || '{}'); } catch { statuses = {}; }
                try { supplierIds = JSON.parse(es.supplier_ids || '[]'); } catch { supplierIds = []; }
                if (!Array.isArray(supplierIds) || !supplierIds.includes(pending.related_supplier_id)) return false;
                return (statuses[pending.related_supplier_id] || 'pending') === 'pending';
            }
            case 'event_still_missing_assignments': {
                // פאזה 5: שלח רק אם עדיין חסרים שיבוצים (אירוע confirmed שעדיין חסר בו מינימום ספקים מאושרים).
                if (!pending.related_event_id) return false;
                const event = await base44.asServiceRole.entities.Event.get(pending.related_event_id);
                if (!event || event.status === 'cancelled') return false;
                const [eventServices, allServices] = await Promise.all([
                    base44.asServiceRole.entities.EventService.filter({ event_id: pending.related_event_id }),
                    base44.asServiceRole.entities.Service.list()
                ]);
                const servicesMap = new Map(allServices.map(s => [s.id, s]));
                for (const es of eventServices) {
                    const serviceDef = servicesMap.get(es.service_id);
                    const minRequired = (es.min_suppliers ?? serviceDef?.default_min_suppliers) ?? 0;
                    if (minRequired === 0) continue;
                    let approvedCount = 0;
                    if (es.supplier_ids && es.supplier_statuses) {
                        try {
                            const ids = JSON.parse(es.supplier_ids);
                            const sts = JSON.parse(es.supplier_statuses);
                            approvedCount = ids.filter(id => sts[id] === 'approved' || sts[id] === 'confirmed').length;
                        } catch {}
                    }
                    if (approvedCount < minRequired) return true; // עדיין חסר שיבוץ
                }
                return false; // הכל מאויש
            }
            case 'event_still_has_balance': {
                // פאזה 6: שלח רק אם עדיין יש יתרת תשלום לאירוע.
                if (!pending.related_event_id) return false;
                const event = await base44.asServiceRole.entities.Event.get(pending.related_event_id);
                if (!event || event.status === 'cancelled') return false;
                const [eventServices, allPayments, appSettings] = await Promise.all([
                    base44.asServiceRole.entities.EventService.filter({ event_id: pending.related_event_id }),
                    base44.asServiceRole.entities.Payment.filter({ event_id: pending.related_event_id }),
                    base44.asServiceRole.entities.AppSettings.list()
                ]);
                const vatSetting = appSettings.find(s => s.setting_key === 'vat_rate');
                const vatRate = vatSetting ? parseFloat(vatSetting.setting_value) / 100 : 0.17;
                let totalCost = 0;
                if (event.all_inclusive && event.all_inclusive_price) {
                    totalCost = event.all_inclusive_price;
                    if (!event.all_inclusive_includes_vat) totalCost *= (1 + vatRate);
                } else if (event.total_override) {
                    totalCost = event.total_override;
                    if (!event.total_override_includes_vat) totalCost *= (1 + vatRate);
                } else {
                    for (const es of eventServices) {
                        const price = es.custom_price || es.total_price || 0;
                        const quantity = es.quantity || 1;
                        let serviceCost = price * quantity;
                        if (!es.includes_vat) serviceCost *= (1 + vatRate);
                        totalCost += serviceCost;
                    }
                }
                if (event.discount_amount) totalCost = Math.max(0, totalCost - event.discount_amount);
                const totalPaid = allPayments
                    .filter(p => p.payment_status === 'completed')
                    .reduce((sum, p) => sum + (p.amount || 0), 0);
                return (totalCost - totalPaid) > 0;
            }
            case 'event_still_open_quote': {
                // הצעות מחיר: שלח רק אם האירוע עדיין בסטטוס 'quote'.
                if (!pending.related_event_id) return false;
                const event = await base44.asServiceRole.entities.Event.get(pending.related_event_id);
                if (!event) return false;
                return event.status === 'quote';
            }
            case 'task_still_pending': {
                // משימות: שלח רק אם המשימה עדיין קיימת ולא הושלמה.
                if (!pending.related_task_id) return false;
                let task = null;
                try { task = await base44.asServiceRole.entities.Task.get(pending.related_task_id); } catch { return false; }
                if (!task) return false;
                return !task.is_completed;
            }
            default:
                return true;
        }
    } catch (e) {
        console.warn(`[ScheduledPush] Condition check error for ${pending.id}:`, e.message);
        // במקרה ספק - לא שולחים, כדי לא להציף הודעות שגויות
        return false;
    }
}

// ============================================================
// Event Reminder Fan-out
// תזכורת אירוע אחת מתפצלת לכל הספקים המאושרים + מנהלים בעת השליחה.
// מחשב את קבוצת הנמענים הדינמית כרגע (מקור אמת חי), בונה את התוכן
// מתוך תבניות SUPPLIER_EVENT_REMINDER / ADMIN_EVENT_REMINDER, ושולח
// push (למשתמשים רשומים) + whatsapp (ישירות לטלפון).
// ============================================================
async function processEventReminderFanout(base44, pending, oneSignalAppId, oneSignalApiKey) {
    const result = { sent: 0 };
    const eventId = pending.related_event_id;
    if (!eventId) return result;

    const event = await base44.asServiceRole.entities.Event.get(eventId);
    if (!event || event.status === 'cancelled') return result;
    // לא שולחים אם האירוע כבר עבר
    if (new Date(event.event_date) < new Date()) return result;
    // שולחים רק לאירוע פעיל (confirmed / in_progress)
    if (!['confirmed', 'in_progress'].includes(event.status)) return result;

    const [eventServices, allSuppliers, allUsers, templates] = await Promise.all([
        base44.asServiceRole.entities.EventService.filter({ event_id: eventId }),
        base44.asServiceRole.entities.Supplier.list(),
        base44.asServiceRole.entities.User.list(),
        base44.asServiceRole.entities.NotificationTemplate.filter({ is_active: true })
    ]);

    const suppliersMap = new Map(allSuppliers.map(s => [s.id, s]));
    const adminUsers = allUsers.filter(u => u.role === 'admin');

    const supplierTemplate = templates.find(t => t.type === 'SUPPLIER_EVENT_REMINDER');
    const adminTemplate = templates.find(t => t.type === 'ADMIN_EVENT_REMINDER');

    // תורים לשליחה
    const whatsappQueue = []; // { phone, message }
    const pushQueue = []; // { subscriptionId, title, message, link, userId }

    // ---- ספקים מאושרים ----
    if (supplierTemplate) {
        const allowedChannels = supplierTemplate.allowed_channels || ['push'];
        const seenSuppliers = new Set();
        for (const es of eventServices) {
            if (!es.supplier_ids || !es.supplier_statuses) continue;
            let ids = [], sts = {};
            try { ids = JSON.parse(es.supplier_ids); sts = JSON.parse(es.supplier_statuses); } catch { continue; }
            for (const supplierId of ids) {
                const status = sts[supplierId];
                if (status !== 'approved' && status !== 'confirmed') continue;
                const dedupeKey = `${supplierId}_${es.id}`;
                if (seenSuppliers.has(dedupeKey)) continue;
                seenSuppliers.add(dedupeKey);

                const supplier = suppliersMap.get(supplierId);
                if (!supplier) continue;

                const ctx = buildEventCtx(event, supplier, null, es);
                const title = replacePH(supplierTemplate.title_template, ctx);
                const message = replacePH(supplierTemplate.body_template, ctx);
                const waMessage = replacePH(supplierTemplate.whatsapp_body_template || supplierTemplate.body_template, ctx);
                const link = buildDL(supplierTemplate.deep_link_base, supplierTemplate.deep_link_params_map, ctx);

                if (allowedChannels.includes('whatsapp') && supplier.phone && supplier.whatsapp_enabled !== false) {
                    whatsappQueue.push({ phone: supplier.phone, message: waMessage });
                }
                if (allowedChannels.includes('push')) {
                    const supplierUser = allUsers.find(u => supplier.contact_emails?.includes(u.email));
                    if (supplierUser?.push_enabled && supplierUser?.onesignal_subscription_id) {
                        pushQueue.push({ subscriptionId: supplierUser.onesignal_subscription_id, title, message, link, userId: supplierUser.id });
                    }
                }
            }
        }
    }

    // ---- מנהלים ----
    if (adminTemplate) {
        const allowedChannels = adminTemplate.allowed_channels || ['push'];
        const ids = adminTemplate.admin_recipient_ids;
        const targetedAdmins = (Array.isArray(ids) && ids.length > 0)
            ? adminUsers.filter(a => ids.includes(a.id))
            : adminUsers;
        for (const admin of targetedAdmins) {
            const ctx = buildEventCtx(event, null, admin, null);
            const title = replacePH(adminTemplate.title_template, ctx);
            const message = replacePH(adminTemplate.body_template, ctx);
            const waMessage = replacePH(adminTemplate.whatsapp_body_template || adminTemplate.body_template, ctx);
            const link = buildDL(adminTemplate.deep_link_base, adminTemplate.deep_link_params_map, ctx);

            if (allowedChannels.includes('whatsapp') && admin.phone) {
                whatsappQueue.push({ phone: admin.phone, message: waMessage });
            }
            if (allowedChannels.includes('push') && admin.push_enabled && admin.onesignal_subscription_id) {
                pushQueue.push({ subscriptionId: admin.onesignal_subscription_id, title, message, link, userId: admin.id });
            }
        }
    }

    // ---- שליחת WhatsApp ----
    const GREEN_API_INSTANCE_ID = Deno.env.get('GREEN_API_INSTANCE_ID');
    const GREEN_API_TOKEN = Deno.env.get('GREEN_API_TOKEN');
    if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
        for (const wa of whatsappQueue) {
            try {
                let cleanPhone = wa.phone.toString().replace(/[^0-9]/g, '');
                if (cleanPhone.startsWith('05')) cleanPhone = '972' + cleanPhone.substring(1);
                else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) cleanPhone = '972' + cleanPhone;
                const chatId = `${cleanPhone}@c.us`;
                const resp = await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatId, message: wa.message })
                });
                if (resp.ok) result.sent++;
            } catch (e) {
                console.warn('[ScheduledPush] Fan-out WA error:', e.message);
            }
        }
    }

    // ---- שליחת Push ----
    if (oneSignalAppId && oneSignalApiKey && pushQueue.length > 0) {
        const FORCED_BASE_URL = 'https://pulse-system.base44.app';
        // איגוד לפי הודעה זהה לשליחה יעילה
        const groups = new Map();
        for (const p of pushQueue) {
            const key = `${p.title}|||${p.message}|||${p.link}`;
            if (!groups.has(key)) groups.set(key, { ...p, subscriptionIds: [] });
            groups.get(key).subscriptionIds.push(p.subscriptionId);
        }
        for (const [, group] of groups) {
            try {
                let pushLink = '';
                if (group.link) pushLink = group.link.startsWith('http') ? group.link : `${FORCED_BASE_URL}${group.link.startsWith('/') ? group.link : '/' + group.link}`;
                const resp = await fetch('https://onesignal.com/api/v1/notifications', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${oneSignalApiKey}` },
                    body: JSON.stringify({
                        app_id: oneSignalAppId,
                        include_subscription_ids: group.subscriptionIds,
                        contents: { en: group.message, he: group.message },
                        headings: { en: group.title, he: group.title },
                        url: pushLink || undefined,
                        data: { link: pushLink, delayed: true }
                    })
                });
                const r = await resp.json();
                if (r.id && r.recipients > 0) result.sent += r.recipients;
            } catch (e) {
                console.warn('[ScheduledPush] Fan-out push error:', e.message);
            }
        }
    }

    return result;
}

// בונה הקשר משתנים לתזכורת אירוע (זהה ל-buildEventContext ב-dailyScheduledNotifications)
function buildEventCtx(event, supplier, userOrAdmin, eventService) {
    let effectiveTime = event.event_time || '';
    if (supplier && eventService) {
        const at = eventService.supplier_arrival_time;
        if (at && typeof at === 'string' && at.trim() !== '') effectiveTime = at.trim();
    }
    return {
        event_name: event.event_name || '',
        family_name: event.family_name || '',
        event_date: fmtDate(event.event_date),
        event_time: effectiveTime,
        event_location: event.location || '',
        supplier_name: supplier ? (supplier.contact_person || supplier.supplier_name) : '',
        supplier_phone: supplier?.phone || '',
        service_name: '',
        event_id: event.id,
        admin_name: userOrAdmin?.full_name || '',
        user_name: userOrAdmin?.full_name || '',
        client_name: userOrAdmin?.full_name || ''
    };
}

function replacePH(template, data) {
    if (!template) return '';
    return template.replace(/\{\{?([\w_]+)\}?}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : match;
    });
}

function buildDL(basePage, paramsMapJson, data) {
    if (!basePage) return '/';
    let url = `/${basePage}`;
    if (paramsMapJson) {
        try {
            const paramsMap = JSON.parse(paramsMapJson);
            const params = new URLSearchParams();
            for (const [key, valueTemplate] of Object.entries(paramsMap)) {
                const value = replacePH(valueTemplate, data);
                if (value && !value.includes('{{')) params.append(key, value);
            }
            const paramString = params.toString();
            if (paramString) url += `?${paramString}`;
        } catch (e) {}
    }
    return url;
}

function fmtDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `\u200E${dd}/${mm}/${yyyy}`;
}