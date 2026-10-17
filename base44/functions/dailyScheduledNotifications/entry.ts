import { getClientContacts } from '../../shared/eventFields.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { formatEventContacts } from '../../shared/eventContacts.ts';
import { sendWhatsAppText } from '../../shared/whatsappSend.ts';
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from '../../shared/whatsappReceipt.ts';
import {eventReminderWhatsAppKey,taskDigestWhatsAppKey,automatedWhatsAppKey} from '../../shared/whatsappBusinessKeys.ts';
import {expectTaskRecipient,acknowledgeTaskRecipient,taskIdsReadyToMark} from '../../shared/taskNotificationAck.ts';
import {indexEventServicesByEvent,indexEventReminderReceipts} from '../../shared/notificationLookup.ts';

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY');
const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");

// ============================================================
// Helper functions (defined before Deno.serve for Deno compatibility)
// ============================================================

// Link only the newest queued matching WhatsApp to the in-app receipt.
// The queue worker marks whatsapp_sent=true only after the provider accepts it.
function linkWhatsAppNotification(queue,phone,message,notificationId){
    if(!notificationId||!phone||!message)return;
    for(let i=queue.length-1;i>=0;i--){
        const candidate=queue[i];
        if(candidate.phone===phone&&candidate.message===message&&!candidate.inAppNotificationId){
            candidate.inAppNotificationId=notificationId;
            return;
        }
    }
}

function getIsraelDayOfWeek(timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone });
    const day = formatter.format(now);
    const dayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    return dayMap[day] ?? -1;
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

function buildEventContext(event, supplier, userOrParent, eventService) {
    // אם יש EventService עם שעת התייצבות ייעודית - משתמשים בה (רק עבור ספקים)
    let effectiveTime = event.event_time || '';
    if (supplier && eventService) {
        const at = eventService.supplier_arrival_time;
        if (at && typeof at === 'string' && at.trim() !== '') {
            effectiveTime = at.trim();
        }
    }
    return {
        event_name: event.event_name || '',
        family_name: event.family_name || event.event_name || '',
        event_date: formatDate(event.event_date),
        event_time: effectiveTime,
        event_location: event.location || '',
        supplier_name: supplier ? (supplier.contact_person || supplier.supplier_name) : '',
        supplier_phone: supplier?.phone || '',
        service_name: '',
        event_id: event.id,
        event_contacts: formatEventContacts(event),
        admin_name: userOrParent?.full_name || userOrParent?.name || '',
        user_name: userOrParent?.full_name || userOrParent?.name || '',
        client_name: userOrParent?.name || userOrParent?.full_name || ''
    };
}

function applyTimingOffset(date, unit, value) {
    switch (unit) {
        case 'minutes': date.setMinutes(date.getMinutes() + value); break;
        case 'hours': date.setHours(date.getHours() + value); break;
        case 'days': date.setDate(date.getDate() + value); break;
        case 'weeks': date.setDate(date.getDate() + (value * 7)); break;
        case 'months': date.setMonth(date.getMonth() + value); break;
    }
}

function replacePlaceholders(template, data) {
    if (!template) return '';
    return template.replace(/\{\{?([\w_]+)\}?}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : match;
    });
}

function buildDeepLink(basePage, paramsMapJson, data) {
    if (!basePage) return '/';
    let url = `/${basePage}`;
    if (paramsMapJson) {
        try {
            const paramsMap = JSON.parse(paramsMapJson);
            const params = new URLSearchParams();
            for (const [key, valueTemplate] of Object.entries(paramsMap)) {
                const value = replacePlaceholders(valueTemplate, data);
                if (value && !value.includes('{{')) params.append(key, value);
            }
            const paramString = params.toString();
            if (paramString) url += `?${paramString}`;
        } catch (e) {}
    }
    return url;
}

/**
 * פורמט תאריך dd/mm/yyyy עם תווי LRM (\u200E) שמכריחים תצוגה משמאל לימין
 * גם כשההודעה נשלחת בהקשר RTL (כמו וואטסאפ בעברית).
 */
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `\u200E${dd}/${mm}/${yyyy}`;
}

/**
 * סינון רשימת מנהלים לפי admin_recipient_ids של התבנית.
 * אם השדה ריק או לא קיים - מחזיר את כל המנהלים (התנהגות ברירת מחדל).
 */
function filterTargetedAdmins(template, adminUsers) {
    const ids = template?.admin_recipient_ids || template?.adminrecipientids;
    if (!Array.isArray(ids) || ids.length === 0) return adminUsers;
    return adminUsers.filter(a => ids.includes(a.id));
}

function getIsraelEventDate(dateStr, timeStr) {
    let time = timeStr || '09:00';
    if (!time.match(/^\d{1,2}:\d{2}$/)) time = '09:00';
    const d = new Date(`${dateStr}T${time}:00Z`);
    const month = d.getMonth() + 1;
    const isSummer = month >= 4 && month <= 10;
    const offsetHours = isSummer ? 3 : 2;
    d.setHours(d.getHours() - offsetHours);
    return d;
}

/**
 * Daily Scheduled Notifications Processor
 * Runs once daily at 09:00 Israel time (07:00 UTC).
 * 
 * ALL scheduled notifications are handled HERE in a single run:
 * 
 * Steps:
 * 1. Process pending notifications (queued from quiet hours/shabbat)
 * 2. Process scheduled_check templates (timed notifications)
 * 3. Send event reminders to suppliers and admins (1 day before)
 * 4. Check pending supplier assignments (reminder for 4 days)
 * 5. Check missing assignments - admin alert (Sunday only, up to 7 days before)
 * 6. Check client payment reminders (events that passed with balance)
 * 7. Batch send all collected WhatsApp & Push notifications
 * 8. Clean up old PendingPushNotification records
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        console.log('[DailyNotifications] Starting daily notification processing...');
        
        // Check Shabbat - if active, skip entirely
        if (isShabbat()) {
            console.log('[DailyNotifications] Shabbat active - skipping all notifications');
            return Response.json({ success: true, skipped: true, reason: 'Shabbat' });
        }

        const results = {
            pending_processed: 0,
            pending_whatsapp_sent: 0,
            pending_push_sent: 0,
            scheduled_templates_processed: 0,
            event_reminders_sent: 0,
            pending_assignments_sent: 0,
            missing_assignments_sent: 0,
            client_payment_reminders_sent: 0,
            task_notifications_sent: 0,
            errors: 0,
            cleaned_up: 0
        };

        // ============================================================
        // PHASE 0: Load all shared data ONCE (minimize API calls)
        // ============================================================
        console.log('[DailyNotifications] Loading shared data...');
        
        const [
            allEvents,
            allEventServices,
            allSuppliers,
            allUsers,
            allTemplates,
            existingNotifications,
            allPayments,
            allServices,
            appSettings
        ] = await Promise.all([
            base44.asServiceRole.entities.Event.list(),
            base44.asServiceRole.entities.EventService.list(),
            base44.asServiceRole.entities.Supplier.list(),
            base44.asServiceRole.entities.User.list(),
            base44.asServiceRole.entities.NotificationTemplate.filter({ is_active: true }),
            base44.asServiceRole.entities.InAppNotification.filter({ is_resolved: false }),
            base44.asServiceRole.entities.Payment.list(),
            base44.asServiceRole.entities.Service.list(),
            base44.asServiceRole.entities.AppSettings.list()
        ]);

        const suppliersMap = new Map(allSuppliers.map(s => [s.id, s]));
        const servicesByEvent=indexEventServicesByEvent(allEventServices);
        const existingEventReminders=indexEventReminderReceipts(existingNotifications);
        const eventsMap = new Map(allEvents.map(e => [e.id, e]));
        const servicesMap = new Map(allServices.map(s => [s.id, s]));
        const adminUsers = allUsers.filter(u => u.role === 'admin');
        const now = new Date();

        // Collect all messages to send
        const whatsappQueue = []; // { phone, message, idempotencyKey, optional taskIds/recipientId }
        const pushQueue = []; // { subscriptionId, title, message, link, notificationRecordId }
        // A Task flag must NEVER be written before every intended recipient
        // has a durable Outbox enqueue (or durable InApp for push-only).
        const taskExpectedRecipients=new Map();
        const taskAcknowledgedRecipients=new Map();
        const taskDueDates=new Map();

        // ============================================================
        // PHASE 1: Delayed notifications have ONE owner.
        // The hourly processScheduledPushNotifications worker alone claims,
        // validates and enqueues PendingPushNotification rows. Previously the
        // daily worker marked is_sent=true BEFORE WhatsApp was enqueued, and
        // used a different idempotency key, risking lost/duplicate messages.
        // This daily scan intentionally does not touch those rows.
        // ============================================================
        console.log('[DailyNotifications] Scheduled pending delivery belongs to processScheduledPushNotifications');

        // ============================================================
        // PHASE 2: Process scheduled_check Templates
        // ============================================================
        console.log('[DailyNotifications] Phase 2: Processing scheduled templates...');
        
        const scheduledTemplates = allTemplates.filter(t => t.trigger_type === 'scheduled_check');
        
        for (const template of scheduledTemplates) {
            try {
                await processScheduledTemplate(base44, template, allEvents, servicesByEvent, allSuppliers, allUsers, suppliersMap, existingNotifications, whatsappQueue, pushQueue, results);
                results.scheduled_templates_processed++;
            } catch (e) {
                console.error(`[DailyNotifications] Error in scheduled template ${template.type}:`, e);
                results.errors++;
            }
        }

        // ============================================================
        // PHASE 3: Event Reminders (supplier + admin)
        // ============================================================
        console.log('[DailyNotifications] Phase 3: Processing event reminders...');
        
        const supplierReminderTemplate = allTemplates.find(t => t.type === 'SUPPLIER_EVENT_REMINDER');
        const adminReminderTemplate = allTemplates.find(t => t.type === 'ADMIN_EVENT_REMINDER');
        
        for (const event of allEvents) {
            if (event.status === 'cancelled') continue;
            const eventDate = new Date(event.event_date);
            if (eventDate < now) continue;
            
            // Supplier reminders
            if (supplierReminderTemplate) {
                const timingValue = supplierReminderTemplate.timing_value || 1;
                const timingUnit = supplierReminderTemplate.timing_unit || 'days';
                // תיקון: לוקחים את תחילת היום של האירוע (00:00) במקום שעת האירוע,
                // כך שתזכורת "יום לפני" תישלח בכל ריצה במהלך היום הקודם.
                // אחרת, אם הריצה ב-9:00 והאירוע מחר ב-19:00, ה-cutoff היה 19:00 היום והתזכורת לא נשלחה.
                const eventDayStart = getIsraelEventDate(event.event_date, '00:00');
                const reminderCutoff = new Date(eventDayStart);
                applyTimingOffset(reminderCutoff, timingUnit, -timingValue);
                
                if (now >= reminderCutoff) {
                    const eventServices = servicesByEvent.get(event.id)||[];
                    
                    for (const es of eventServices) {
                        if (!es.supplier_ids || !es.supplier_statuses) continue;
                        
                        let supplierIds = [], supplierStatuses = {};
                        try {
                            supplierIds = JSON.parse(es.supplier_ids);
                            supplierStatuses = JSON.parse(es.supplier_statuses);
                        } catch (e) { continue; }
                        
                        for (const supplierId of supplierIds) {
                            const status = supplierStatuses[supplierId];
                            if (status !== 'approved' && status !== 'confirmed') continue;
                            
                            const supplier = suppliersMap.get(supplierId);
                            if (!supplier) continue;
                            
                            // Check duplicate
                            const hasExisting=existingEventReminders.supplier.has(String(event.id)+':'+String(supplierId));
                            if (hasExisting) continue;
                            
                            const contextData = buildEventContext(event, supplier, null, es);
                            const title = replacePlaceholders(supplierReminderTemplate.title_template, contextData);
                            const message = replacePlaceholders(supplierReminderTemplate.body_template, contextData);
                            const waMessage = replacePlaceholders(supplierReminderTemplate.whatsapp_body_template || supplierReminderTemplate.body_template, contextData);
                            const link = buildDeepLink(supplierReminderTemplate.deep_link_base, supplierReminderTemplate.deep_link_params_map, contextData);
                            
                            // Both reminder producers use the same business key;
                            // only ONE Outbox job is created for this supplier/event.
                            if (supplier.phone && supplier.whatsapp_enabled !== false) {
                                whatsappQueue.push({ phone:supplier.phone,message:waMessage,
                                  sourceType:'event_reminder',sourceId:event.id,
                                  idempotencyKey:eventReminderWhatsAppKey(event,supplierReminderTemplate,'supplier',supplierId) });
                            }
                            
                            // Push + InApp - only for registered users
                            const supplierUser = allUsers.find(u => supplier.contact_emails?.includes(u.email));
                            
                            // Create InApp record
                            const targetUserId = supplierUser?.id || `virtual_supplier_${supplierId}`;
                            const targetEmail = supplierUser?.email || supplier.contact_emails?.[0] || '';
                            
                            // Only create DB record for real users
                            if (supplierUser) {
                                try {
                                    const notifRecord = await base44.asServiceRole.entities.InAppNotification.create({
                                        user_id: supplierUser.id,
                                        user_email: targetEmail,
                                        title, message, link: link || '',
                                        is_read: false,
                                        template_type: 'SUPPLIER_EVENT_REMINDER',
                                        related_event_id: event.id,
                                        related_event_service_id: es.id,
                                        related_supplier_id: supplierId,
                                        push_sent: false,
                                        whatsapp_sent: false,
                                        reminder_count: 0,
                                        is_resolved: false
                                    });
                                    linkWhatsAppNotification(whatsappQueue,supplier.phone,waMessage,notifRecord.id);
                                    
                                    // Queue push
                                    if (supplierUser.push_enabled && supplierUser.onesignal_subscription_id) {
                                        pushQueue.push({
                                            subscriptionId: supplierUser.onesignal_subscription_id,
                                            title, message, link: link || '',
                                            notificationRecordId: notifRecord.id
                                        });
                                    }
                                } catch (dbErr) {
                                    console.warn(`[DailyNotifications] DB error for supplier reminder:`, dbErr.message);
                                }
                            }
                            
                            results.event_reminders_sent++;
                        }
                    }
                }
            }
            
            // Admin reminders
            if (adminReminderTemplate) {
                const timingValue = adminReminderTemplate.timing_value || 1;
                const timingUnit = adminReminderTemplate.timing_unit || 'days';
                // תיקון: לוקחים את תחילת היום של האירוע (00:00) במקום שעת האירוע,
                // כך שתזכורת "יום לפני" תישלח בכל ריצה במהלך היום הקודם.
                const adminEventDayStart = getIsraelEventDate(event.event_date, '00:00');
                const reminderCutoff = new Date(adminEventDayStart);
                applyTimingOffset(reminderCutoff, timingUnit, -timingValue);
                
                if (now >= reminderCutoff) {
                    // סינון מנהלים ספציפיים לפי הגדרת התבנית
                    const targetedAdmins = filterTargetedAdmins(adminReminderTemplate, adminUsers);
                    for (const admin of targetedAdmins) {
                        const hasExisting=existingEventReminders.admin.has(String(event.id)+':'+String(admin.id));
                        if (hasExisting) continue;
                        
                        const contextData = buildEventContext(event, null, admin);
                        const title = replacePlaceholders(adminReminderTemplate.title_template, contextData);
                        const message = replacePlaceholders(adminReminderTemplate.body_template, contextData);
                        const waMessage = replacePlaceholders(adminReminderTemplate.whatsapp_body_template || adminReminderTemplate.body_template, contextData);
                        const link = buildDeepLink(adminReminderTemplate.deep_link_base, adminReminderTemplate.deep_link_params_map, contextData);
                        
                        // WhatsApp for admin, shared key with older scheduler.
                        if (admin.phone) {
                            whatsappQueue.push({phone:admin.phone,message:waMessage,
                              sourceType:'event_reminder',sourceId:event.id,
                              idempotencyKey:eventReminderWhatsAppKey(event,adminReminderTemplate,'admin',admin.id)});
                        }
                        
                        // InApp + Push
                        try {
                            const notifRecord = await base44.asServiceRole.entities.InAppNotification.create({
                                user_id: admin.id,
                                user_email: admin.email,
                                title, message, link: link || '',
                                is_read: false,
                                template_type: 'ADMIN_EVENT_REMINDER',
                                related_event_id: event.id,
                                push_sent: false,
                                whatsapp_sent: false,
                                reminder_count: 0,
                                is_resolved: false
                            });
                            linkWhatsAppNotification(whatsappQueue,admin.phone,waMessage,notifRecord.id);
                            
                            if (admin.push_enabled && admin.onesignal_subscription_id) {
                                pushQueue.push({
                                    subscriptionId: admin.onesignal_subscription_id,
                                    title, message, link: link || '',
                                    notificationRecordId: notifRecord.id
                                });
                            }
                        } catch (dbErr) {
                            console.warn(`[DailyNotifications] DB error for admin reminder:`, dbErr.message);
                        }
                        
                        results.event_reminders_sent++;
                    }
                }
            }
        }

        // ============================================================
        // PHASE 4: Pending Assignments Check
        // ============================================================
        console.log('[DailyNotifications] Phase 4: Checking pending assignments...');
        
        const pendingTemplate = allTemplates.find(t => t.type === 'SUPPLIER_PENDING_REMINDER');
        
        if (pendingTemplate) {
            const timingValue = pendingTemplate.timing_value || 24;
            const timingUnit = pendingTemplate.timing_unit || 'hours';
            const reminderIntervalValue = pendingTemplate.reminder_interval_value || 24;
            const reminderIntervalUnit = pendingTemplate.reminder_interval_unit || 'hours';
            const maxReminders = pendingTemplate.max_reminders || 3;
            
            const cutoffTime = new Date();
            applyTimingOffset(cutoffTime, timingUnit, -timingValue);
            
            for (const es of allEventServices) {
                if (!es.supplier_ids || !es.supplier_statuses) continue;
                
                const event = eventsMap.get(es.event_id);
                if (!event) continue;
                if (new Date(event.event_date) < now) continue;
                
                let supplierIds = [], supplierStatuses = {};
                try {
                    supplierIds = JSON.parse(es.supplier_ids);
                    supplierStatuses = JSON.parse(es.supplier_statuses);
                } catch (e) { continue; }
                
                for (const supplierId of supplierIds) {
                    if (supplierStatuses[supplierId] !== 'pending') continue;
                    
                    const supplier = suppliersMap.get(supplierId);
                    if (!supplier) continue;
                    
                    const supplierUser = allUsers.find(u => 
                        supplier.contact_emails?.includes(u.email) ||
                        (u.phone && supplier.phone === u.phone)
                    );
                    
                    // Check existing notification
                    const existingNotification = existingNotifications.find(n => 
                        n.template_type === 'SUPPLIER_PENDING_REMINDER' &&
                        n.related_event_service_id === es.id &&
                        n.related_supplier_id === supplierId
                    );
                    
                    if (existingNotification) {
                        const lastSentTime = new Date(existingNotification.created_date);
                        const reminderCutoff = new Date();
                        applyTimingOffset(reminderCutoff, reminderIntervalUnit, -reminderIntervalValue);
                        
                        if (lastSentTime > reminderCutoff) continue;
                        if (existingNotification.reminder_count >= maxReminders) continue;
                    }
                    
                    const contextData = buildEventContext(event, supplier, null, es);
                    const title = replacePlaceholders(pendingTemplate.title_template, contextData);
                    const message = replacePlaceholders(pendingTemplate.body_template, contextData);
                    const waMessage = replacePlaceholders(pendingTemplate.whatsapp_body_template || pendingTemplate.body_template, contextData);
                    const link = buildDeepLink(pendingTemplate.deep_link_base, pendingTemplate.deep_link_params_map, contextData);
                    
                    // WhatsApp - direct to phone (works for non-registered users)
                    if (supplier.phone && supplier.whatsapp_enabled !== false &&
                        pendingTemplate.allowed_channels?.includes('whatsapp')) {
                        whatsappQueue.push({phone:supplier.phone,message:waMessage,
                          sourceType:'supplier_pending_reminder',sourceId:es.id,
                          idempotencyKey:automatedWhatsAppKey('supplier_pending',{
                            eventId:event.id,recipientId:supplierId,eventDate:event.event_date,
                            serviceId:es.id,templateType:'SUPPLIER_PENDING_REMINDER',
                            version:existingNotification?(Number(existingNotification.reminder_count)||0)+1:0
                          })});
                    }
                    
                    // Push + InApp - only for registered users
                    if (supplierUser) {
                        try {
                            const notifRecord = await base44.asServiceRole.entities.InAppNotification.create({
                                user_id: supplierUser.id,
                                user_email: supplierUser.email,
                                title, message, link: link || '',
                                is_read: false,
                                template_type: 'SUPPLIER_PENDING_REMINDER',
                                related_event_id: event.id,
                                related_event_service_id: es.id,
                                related_supplier_id: supplierId,
                                push_sent: false,
                                whatsapp_sent: false,
                                reminder_count: existingNotification ? (existingNotification.reminder_count || 0) + 1 : 0,
                                is_resolved: false
                            });
                            linkWhatsAppNotification(whatsappQueue,supplier.phone,waMessage,notifRecord.id);
                            
                            if (supplierUser.push_enabled && supplierUser.onesignal_subscription_id) {
                                pushQueue.push({
                                    subscriptionId: supplierUser.onesignal_subscription_id,
                                    title, message, link: link || '',
                                    notificationRecordId: notifRecord.id
                                });
                            }
                        } catch (dbErr) {
                            console.warn(`[DailyNotifications] DB error for pending assignment:`, dbErr.message);
                        }
                    }
                    
                    results.pending_assignments_sent++;
                }
            }
        }

        // ============================================================
        // PHASE 5: Missing Assignments Check (Sunday only)
        // ============================================================
        const isSunday = getIsraelDayOfWeek() === 0; // 0 = Sunday
        
        if (isSunday) {
            console.log('[DailyNotifications] Phase 5: Checking missing assignments (Sunday)...');
            
            const missingTemplate = allTemplates.find(t => t.type === 'ADMIN_MISSING_ASSIGNMENT');
            
            if (missingTemplate) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const sevenDaysFromNow = new Date(today);
                sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
                
                // סינון: רק אירועים בסטטוס 'confirmed' (סגור) - לא הצעת מחיר ולא בוטל/הושלם
                const upcomingEvents = allEvents.filter(e => {
                    if (e.status !== 'confirmed') return false;
                    const eventDate = new Date(e.event_date);
                    return eventDate >= today && eventDate <= sevenDaysFromNow;
                });
                
                // סינון מנהלים ספציפיים לפי הגדרת התבנית (רק פעם אחת לכל הריצה)
                const targetedAdmins = filterTargetedAdmins(missingTemplate, adminUsers);
                const allowedChannels = missingTemplate.allowed_channels || ['push'];
                
                for (const event of upcomingEvents) {
                    // צבירת כל השירותים שחסרים בהם ספקים באירוע הזה
                    const missingServices = []; // [{ es, serviceName, minRequired, approvedCount }]
                    const eventServices = servicesByEvent.get(event.id)||[];
                    
                    for (const es of eventServices) {
                        const serviceDef = servicesMap.get(es.service_id);
                        const minRequired = es.min_suppliers ?? serviceDef?.default_min_suppliers ?? 0;
                        if (minRequired === 0) continue;
                        
                        // ספירת ספקים מאושרים
                        let approvedCount = 0;
                        if (es.supplier_ids && es.supplier_statuses) {
                            try {
                                const supplierIds = JSON.parse(es.supplier_ids);
                                const statuses = JSON.parse(es.supplier_statuses);
                                approvedCount = supplierIds.filter(id => 
                                    statuses[id] === 'approved' || statuses[id] === 'confirmed'
                                ).length;
                            } catch (e) {}
                        }
                        if (approvedCount >= minRequired) continue;
                        
                        missingServices.push({
                            es,
                            serviceName: serviceDef?.service_name || '',
                            minRequired,
                            approvedCount
                        });
                    }
                    
                    if (missingServices.length === 0) continue;
                    
                    // בדיקת כפילות: התראה אחת בלבד פר אירוע
                    const hasDuplicate = existingNotifications.some(n =>
                        n.template_type === 'ADMIN_MISSING_ASSIGNMENT' &&
                        n.related_event_id === event.id
                    );
                    if (hasDuplicate) continue;
                    
                    // בניית תוכן ההתראה - הודעה כללית או ספציפית לפי כמות השירותים החסרים
                    let contextData;
                    let customMessage = null;
                    let customWaMessage = null;
                    
                    if (missingServices.length === 1) {
                        // שיבוץ חסר אחד - הודעה ספציפית עם פירוט (התנהגות קיימת)
                        const ms = missingServices[0];
                        contextData = {
                            event_name: event.event_name || '',
                            family_name: event.family_name || event.event_name || '',
                            event_date: formatDate(event.event_date),
                            event_contacts: formatEventContacts(event),
                            service_name: ms.serviceName,
                            min_suppliers: ms.minRequired,
                            current_suppliers: ms.approvedCount,
                            missing_count: 1,
                            event_id: event.id
                        };
                    } else {
                        // כמה שיבוצים חסרים - הודעה מצרפת אחת
                        const servicesList = missingServices
                            .map(ms => `• ${ms.serviceName} (${ms.approvedCount}/${ms.minRequired})`)
                            .join('\n');
                        contextData = {
                            event_name: event.event_name || '',
                            family_name: event.family_name || event.event_name || '',
                            event_date: formatDate(event.event_date),
                            event_contacts: formatEventContacts(event),
                            service_name: '', // אין שירות יחיד
                            min_suppliers: '',
                            current_suppliers: '',
                            missing_count: missingServices.length,
                            event_id: event.id
                        };
                        // הודעה מותאמת מצרפת
                        customMessage = `חסרים שיבוצים באירוע "${event.family_name || event.event_name}" בתאריך ${formatDate(event.event_date)}.\n\nשירותים חסרי שיבוץ (${missingServices.length}):\n${servicesList}`;
                        customWaMessage = customMessage;
                    }
                    
                    const title = replacePlaceholders(missingTemplate.title_template, contextData);
                    const message = customMessage || replacePlaceholders(missingTemplate.body_template, contextData);
                    const waMessage = customWaMessage || replacePlaceholders(missingTemplate.whatsapp_body_template || missingTemplate.body_template, contextData);
                    const link = buildDeepLink(missingTemplate.deep_link_base, missingTemplate.deep_link_params_map, contextData);
                    
                    // שליחה למנהלים שעברו סינון - פעם אחת לכל מנהל לכל אירוע
                    for (const admin of targetedAdmins) {
                        // WhatsApp
                        if (allowedChannels.includes('whatsapp') && admin.phone) {
                            whatsappQueue.push({phone:admin.phone,message:waMessage,
                              sourceType:'admin_missing_assignment',sourceId:event.id,
                              idempotencyKey:automatedWhatsAppKey('admin_missing',{
                                eventId:event.id,recipientId:admin.id,eventDate:event.event_date,
                                templateType:'ADMIN_MISSING_ASSIGNMENT',
                                // The current business rule allows only one active
                                // missing-assignment alert per event. Reappearance
                                // after manual resolution needs a distinct version;
                                // this is tracked in E21, not guessed here.
                                version:String(event.updated_date||event.event_date||'')
                              })});
                        }
                        
                        // InApp + Push
                        try {
                            const notifRecord = await base44.asServiceRole.entities.InAppNotification.create({
                                user_id: admin.id,
                                user_email: admin.email,
                                title, message, link: link || '',
                                is_read: false,
                                template_type: 'ADMIN_MISSING_ASSIGNMENT',
                                related_event_id: event.id,
                                push_sent: false,
                                whatsapp_sent: false,
                                reminder_count: 0,
                                is_resolved: false
                            });
                            linkWhatsAppNotification(whatsappQueue,admin.phone,waMessage,notifRecord.id);
                            
                            if (admin.push_enabled && admin.onesignal_subscription_id) {
                                pushQueue.push({
                                    subscriptionId: admin.onesignal_subscription_id,
                                    title, message, link: link || '',
                                    notificationRecordId: notifRecord.id
                                });
                            }
                        } catch (dbErr) {
                            console.warn(`[DailyNotifications] DB error for missing assignment:`, dbErr.message);
                        }
                        
                        results.missing_assignments_sent++;
                    }
                }
            }
        } else {
            console.log('[DailyNotifications] Phase 5: Skipping missing assignments (not Sunday)');
        }

        // ============================================================
        // PHASE 6: Client Payment Reminders (events that passed with balance)
        // ============================================================
        console.log('[DailyNotifications] Phase 6: Checking client payment reminders...');
        
        const paymentTemplate = allTemplates.find(t => t.type === 'CLIENT_PAYMENT_REMINDER');
        
        if (paymentTemplate) {
            const vatSetting = appSettings.find(s => s.setting_key === 'vat_rate');
            const vatRate = vatSetting ? parseFloat(vatSetting.setting_value) / 100 : 0.17;
            
            const pastEvents = allEvents.filter(e => {
                if (e.status === 'cancelled') return false;
                const eventDate = new Date(e.event_date);
                return eventDate < now;
            });
            
            for (const event of pastEvents) {
                // Calculate total cost
                let totalCost = 0;
                
                if (event.all_inclusive && event.all_inclusive_price) {
                    totalCost = event.all_inclusive_price;
                    if (!event.all_inclusive_includes_vat) totalCost *= (1 + vatRate);
                } else if (event.total_override) {
                    totalCost = event.total_override;
                    if (!event.total_override_includes_vat) totalCost *= (1 + vatRate);
                } else {
                    const eventServices = servicesByEvent.get(event.id)||[];
                    for (const es of eventServices) {
                        const price = es.custom_price || es.total_price || 0;
                        const quantity = es.quantity || 1;
                        let serviceCost = price * quantity;
                        if (!es.includes_vat) serviceCost *= (1 + vatRate);
                        totalCost += serviceCost;
                    }
                }
                
                if (event.discount_amount) totalCost = Math.max(0, totalCost - event.discount_amount);
                
                // Calculate total paid
                const eventPayments = allPayments.filter(p => 
                    p.event_id === event.id && p.payment_status === 'completed'
                );
                const totalPaid = eventPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
                const balance = totalCost - totalPaid;
                
                if (balance <= 0) continue;
                
                // Find client users
                const clientUsers = [];
                if (getClientContacts(event) && Array.isArray(getClientContacts(event))) {
                    for (const parent of getClientContacts(event)) {
                        if (parent.email) {
                            const clientUser = allUsers.find(u => u.email?.toLowerCase() === parent.email.toLowerCase());
                            if (clientUser) clientUsers.push(clientUser);
                        }
                    }
                }
                
                if (clientUsers.length === 0) continue;
                
                const reminderIntervalValue = paymentTemplate.reminder_interval_value || 7;
                const reminderIntervalUnit = paymentTemplate.reminder_interval_unit || 'days';
                const maxReminders = paymentTemplate.max_reminders || 4;
                const allowedChannels = paymentTemplate.allowed_channels || ['push'];
                
                for (const clientUser of clientUsers) {
                    const existingNotification = existingNotifications.find(n =>
                        n.template_type === 'CLIENT_PAYMENT_REMINDER' &&
                        n.related_event_id === event.id &&
                        n.user_id === clientUser.id
                    );
                    
                    if (existingNotification) {
                        const lastSentTime = new Date(existingNotification.created_date);
                        const reminderCutoff = new Date();
                        applyTimingOffset(reminderCutoff, reminderIntervalUnit, -reminderIntervalValue);
                        if (lastSentTime > reminderCutoff) continue;
                        if (existingNotification.reminder_count >= maxReminders) continue;
                    }
                    
                    const formatCurrency = (amount) => new Intl.NumberFormat('he-IL', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
                    
                    const contextData = {
                        event_name: event.event_name || '',
                        family_name: event.family_name || event.event_name || '',
                        event_date: formatDate(event.event_date),
                        event_contacts: formatEventContacts(event),
                        balance: formatCurrency(balance),
                        event_id: event.id,
                        client_name: clientUser.full_name || ''
                    };
                    
                    const title = replacePlaceholders(paymentTemplate.title_template, contextData);
                    const message = replacePlaceholders(paymentTemplate.body_template, contextData);
                    const waMessage = replacePlaceholders(paymentTemplate.whatsapp_body_template || paymentTemplate.body_template, contextData);
                    const link = buildDeepLink(paymentTemplate.deep_link_base, paymentTemplate.deep_link_params_map, contextData);
                    
                    // WhatsApp - check parents for phone
                    if (allowedChannels.includes('whatsapp') && getClientContacts(event)) {
                        const parent = getClientContacts(event).find(p => p.email?.toLowerCase() === clientUser.email?.toLowerCase());
                        if (parent?.phone) {
                            whatsappQueue.push({phone:parent.phone,message:waMessage,
                              sourceType:'client_payment_reminder',sourceId:event.id,
                              idempotencyKey:automatedWhatsAppKey('client_payment',{
                                eventId:event.id,recipientId:clientUser.id,eventDate:event.event_date,
                                templateType:'CLIENT_PAYMENT_REMINDER',
                                version:existingNotification?(Number(existingNotification.reminder_count)||0)+1:0
                              })});
                        }
                    }
                    
                    // InApp + Push
                    try {
                        const notifRecord = await base44.asServiceRole.entities.InAppNotification.create({
                            user_id: clientUser.id,
                            user_email: clientUser.email,
                            title, message, link: link || '',
                            is_read: false,
                            template_type: 'CLIENT_PAYMENT_REMINDER',
                            related_event_id: event.id,
                            push_sent: false,
                            whatsapp_sent: false,
                            reminder_count: existingNotification ? (existingNotification.reminder_count || 0) + 1 : 0,
                            is_resolved: false
                        });
                        
                        if (clientUser.push_enabled && clientUser.onesignal_subscription_id) {
                            pushQueue.push({
                                subscriptionId: clientUser.onesignal_subscription_id,
                                title, message, link: link || '',
                                notificationRecordId: notifRecord.id
                            });
                        }
                    } catch (dbErr) {
                        console.warn(`[DailyNotifications] DB error for client payment:`, dbErr.message);
                    }
                    
                    results.client_payment_reminders_sent++;
                }
            }
        }

        // ============================================================
        // PHASE 6.5: Task Notifications (תבנית TASK_DUE_REMINDER מתוך NotificationTemplate)
        // נשלטות מלאות ע"י תבנית - is_active, allowed_channels, title_template, whatsapp_body_template
        // ============================================================
        console.log('[DailyNotifications] Phase 6.5: Checking task notifications...');
        try {
            // בדיקת מתג מערכת המשימות (ב-AppSettings)
            const tasksEnabledSetting = appSettings.find(s => s.setting_key === 'tasks_system_enabled');
            const tasksSystemEnabled = !tasksEnabledSetting || tasksEnabledSetting.setting_value !== 'false';
            
            const taskTemplate = allTemplates.find(t => t.type === 'TASK_DUE_REMINDER');
            
            if (!tasksSystemEnabled) {
                console.log('[DailyNotifications] Phase 6.5: Tasks system disabled - skipping');
            } else if (!taskTemplate) {
                console.log('[DailyNotifications] Phase 6.5: No TASK_DUE_REMINDER template (or inactive) - skipping');
            } else {
                const allTasks = await base44.asServiceRole.entities.Task.list();
                const tasksDueNow = allTasks.filter(t => {
                    if (t.is_completed) return false;
                    if (t.whatsapp_notification_sent) return false;
                    if (!t.due_date) return false;
                    
                    const due = new Date(t.due_date);
                    if (isNaN(due.getTime())) return false;
                    
                    const dueDay = due.toISOString().split('T')[0];
                    const todayDay = now.toISOString().split('T')[0];
                    
                    // אם הזמן עתידי באותו יום ועדיין לא הגיע - לא נשלח עדיין (אלא אם 00:00 = ללא שעה)
                    if (dueDay === todayDay && due.getTime() > now.getTime()) {
                        const hh = due.getHours();
                        const mm = due.getMinutes();
                        if (hh === 0 && mm === 0) return true;
                        return false;
                    }
                    
                    return due.getTime() <= now.getTime() || dueDay === todayDay;
                });
                
                console.log(`[DailyNotifications] Found ${tasksDueNow.length} tasks needing notifications`);
                
                const allowedChannels = taskTemplate.allowed_channels || ['whatsapp'];
                const sendWA = allowedChannels.includes('whatsapp');
                const sendPush = allowedChannels.includes('push');
                
                // ========================================================================
                // אגרגציה: צובר את כל המשימות פר מנהל יעד, לשליחת הודעה מאוחדת אחת לכל מנהל.
                // המבנה: Map<adminId, { admin, tasks: [...] }>
                // ========================================================================
                const templateFilteredAdmins = filterTargetedAdmins(taskTemplate, adminUsers);
                const tasksByAdmin = new Map();
                
                for (const task of tasksDueNow) {
                    // קביעת מנהלים יעד עבור משימה זו
                    let recipients = [];
                    if (task.assignee_ids && task.assignee_ids.length > 0) {
                        recipients = templateFilteredAdmins.filter(u => task.assignee_ids.includes(u.id));
                    } else {
                        recipients = templateFilteredAdmins;
                    }
                    if (recipients.length === 0) continue;
                    
                    for (const admin of recipients) {
                        if (!tasksByAdmin.has(admin.id)) {
                            tasksByAdmin.set(admin.id, { admin, tasks: [] });
                        }
                        tasksByAdmin.get(admin.id).tasks.push(task);
                    }
                }
                
                // עזר לפורמט שורת משימה בודדת בתוך רשימה מאוחדת
                const formatTaskLine = (task) => {
                    const ev = task.event_id ? eventsMap.get(task.event_id) : null;
                    const eventName = ev ? (ev.family_name || ev.event_name || '') : '';
                    const dueTime = (() => {
                        try {
                            const d = new Date(task.due_date);
                            const hh = String(d.getHours()).padStart(2, '0');
                            const mm = String(d.getMinutes()).padStart(2, '0');
                            const hasTime = !(hh === '00' && mm === '00');
                            return hasTime ? ` ${hh}:${mm}` : '';
                        } catch { return ''; }
                    })();
                    const priorityIcon = task.priority === 'high' ? '🔴 ' :
                                         task.priority === 'low' ? '🔵 ' : '';
                    const eventSuffix = eventName ? ` (${eventName})` : '';
                    const timeSuffix = dueTime ? ` -${dueTime}` : '';
                    return `${priorityIcon}${task.title || ''}${timeSuffix}${eventSuffix}`;
                };
                
                // משלוח הודעה מאוחדת לכל מנהל. Stage receipts, do not update Task yet.
                for (const { admin, tasks } of tasksByAdmin.values()) {
                    try {
                        const hasWA=sendWA && !!admin.phone;
                        if(!hasWA&&!sendPush)continue;
                        for(const task of tasks){
                            expectTaskRecipient(taskExpectedRecipients,task.id,admin.id);
                            taskDueDates.set(task.id,task.due_date);
                        }
                        let title, message, waMessage, link, contextDataForLink;
                        
                        if (tasks.length === 1) {
                            // משימה יחידה: שמירה על ההתנהגות הקודמת (תבנית מלאה).
                            const task = tasks[0];
                            const ev = task.event_id ? eventsMap.get(task.event_id) : null;
                            const eventName = ev ? (ev.family_name || ev.event_name || '') : '';
                            const eventLine = eventName ? `\n📅 אירוע: ${eventName}` : '';
                            const priorityLabel = task.priority === 'high' ? '🔴 דחיפות גבוהה' :
                                                  task.priority === 'low' ? '🔵 דחיפות נמוכה' : '';
                            const priorityLine = priorityLabel ? '\n' + priorityLabel : '';
                            const dueTime = (() => {
                                try {
                                    const d = new Date(task.due_date);
                                    const hh = String(d.getHours()).padStart(2, '0');
                                    const mm = String(d.getMinutes()).padStart(2, '0');
                                    const hasTime = !(hh === '00' && mm === '00');
                                    return hasTime ? ` ${hh}:${mm}` : '';
                                } catch { return ''; }
                            })();
                            const dueDateFormatted = formatDate(task.due_date) + dueTime;
                            const descriptionBlock = task.description ? '\n\n' + task.description : '';
                            
                            const contextData = {
                                task_title: task.title || '',
                                task_due_date: dueDateFormatted,
                                task_description: task.description || '',
                                task_priority: task.priority || 'normal',
                                task_event_name: eventName,
                                task_priority_line: priorityLine,
                                task_event_line: eventLine,
                                task_description_block: descriptionBlock,
                                event_id: task.event_id || ''
                            };
                            
                            title = replacePlaceholders(taskTemplate.title_template, contextData);
                            message = replacePlaceholders(taskTemplate.body_template, contextData);
                            waMessage = replacePlaceholders(taskTemplate.whatsapp_body_template || taskTemplate.body_template, contextData);
                            contextDataForLink = contextData;
                        } else {
                            // ריבוי משימות: רשימה מאוחדת בהודעה אחת.
                            const lines = tasks.map(t => `• ${formatTaskLine(t)}`).join('\n');
                            title = `📋 ${tasks.length} משימות לביצוע היום`;
                            const body = `יש לך ${tasks.length} משימות פתוחות לביצוע היום:\n\n${lines}`;
                            message = body;
                            waMessage = body;
                            // קישור עמוד "המשימות שלי" אם הוגדר בתבנית; אחרת ברירת מחדל
                            contextDataForLink = { event_id: '' };
                        }
                        
                        link = buildDeepLink(taskTemplate.deep_link_base, taskTemplate.deep_link_params_map, contextDataForLink);
                        
                        // WhatsApp is an Outbox intent, NOT a successful send.
                        // The key binds the exact task IDs/due versions for the
                        // aggregated admin digest, even across failed retries.
                        if (hasWA) {
                            whatsappQueue.push({phone:admin.phone,message:waMessage,
                              sourceType:'task_due_digest',sourceId:admin.id,
                              idempotencyKey:await taskDigestWhatsAppKey(admin.id,tasks),
                              taskIds:tasks.map(t=>t.id),taskRecipientId:admin.id});
                        }
                        
                        // Push + InApp
                        if (sendPush) {
                            try {
                                const notif = await base44.asServiceRole.entities.InAppNotification.create({
                                    user_id: admin.id,
                                    user_email: admin.email,
                                    title, message, link: link || '',
                                    is_read: false,
                                    template_type: 'TASK_DUE_REMINDER',
                                    related_event_id: tasks.length === 1 ? (tasks[0].event_id || null) : null,
                                    push_sent: false,
                                    whatsapp_sent: false,
                                    reminder_count: 0,
                                    is_resolved: false
                                });
                                linkWhatsAppNotification(whatsappQueue,admin.phone,waMessage,notif.id);
                                if (admin.push_enabled && admin.onesignal_subscription_id) {
                                    pushQueue.push({
                                        subscriptionId: admin.onesignal_subscription_id,
                                        title, message, link: link || '',
                                        notificationRecordId: notif.id
                                    });
                                }
                                if(!hasWA){
                                    // Preserve the legacy in-app-only fallback;
                                    // a requested WhatsApp channel must instead
                                    // wait for its durable Outbox receipt.
                                    for(const t of tasks)acknowledgeTaskRecipient(taskAcknowledgedRecipients,t.id,admin.id);
                                    results.task_notifications_sent++;
                                }
                            } catch(e) {
                                console.warn('[DailyNotifications] Task push DB error:', e.message);
                            }
                        }
                    } catch (terr) {
                        console.warn('[DailyNotifications] Task notification error:', terr.message);
                        results.errors++;
                    }
                }
                
                // Task completion is deliberately AFTER Phase 7a; the previous
                // implementation marked tasks before any Outbox write existed.
            }
        } catch (taskPhaseErr) {
            console.error('[DailyNotifications] Phase 6.5 (tasks) error:', taskPhaseErr);
            results.errors++;
        }

        // ============================================================
        // PHASE 7: Batch Send All Collected Messages
        // ============================================================
        console.log(`[DailyNotifications] Phase 5: Sending ${whatsappQueue.length} WhatsApp + ${pushQueue.length} Push messages...`);
        
        // 5a. Enqueue every WhatsApp message; the centralized worker controls transport rate.
        {
            for (const wa of whatsappQueue) {
                try {
                    const receipt=await sendWhatsAppText(wa.phone, wa.message, base44, {sourceType:wa.sourceType||'daily_notification',sourceId:wa.sourceId||'',inAppNotificationId:wa.inAppNotificationId||'',idempotencyKey:wa.idempotencyKey||''});
                    const state=whatsappEnqueueReceiptState(receipt);
                    // Deduplicated UNKNOWN/FAILED jobs are NOT freshly queued.
                    // Never inflate successful-enqueue counts or claim delivery.
                    if(!isWhatsAppEnqueueConfirmed(receipt)){
                        throw new Error('WhatsApp outbox requires manual review: '+state);
                    }
                    results.pending_whatsapp_sent++; // Only Outbox queued / API accepted.
                    if(wa.taskRecipientId && Array.isArray(wa.taskIds)){
                        for(const taskId of wa.taskIds){
                            acknowledgeTaskRecipient(taskAcknowledgedRecipients,taskId,wa.taskRecipientId);
                        }
                        results.task_notifications_sent++;
                    }
                } catch (e) {
                    console.error('[DailyNotifications] WhatsApp send failed:', e?.message || 'unknown');
                    results.errors++;
                }
            }
        }
        
        // 5b. Send Push notifications in batches via OneSignal (max 2000 per request)
        if (ONESIGNAL_APP_ID && ONESIGNAL_API_KEY && pushQueue.length > 0) {
            // Group by unique messages to batch efficiently
            const pushGroups = new Map();
            for (const push of pushQueue) {
                const key = `${push.title}|||${push.message}|||${push.link}`;
                if (!pushGroups.has(key)) {
                    pushGroups.set(key, { ...push, subscriptionIds: [], notificationRecordIds: [] });
                }
                const group = pushGroups.get(key);
                group.subscriptionIds.push(push.subscriptionId);
                if (push.notificationRecordId) group.notificationRecordIds.push(push.notificationRecordId);
            }
            
            const FORCED_BASE_URL = 'https://pulse-system.base44.app';
            
            for (const [, group] of pushGroups) {
                try {
                    let pushLink = '';
                    if (group.link) {
                        pushLink = group.link.startsWith('http') ? group.link : `${FORCED_BASE_URL}${group.link.startsWith('/') ? group.link : '/' + group.link}`;
                    }
                    
                    const oneSignalPayload = {
                        app_id: ONESIGNAL_APP_ID,
                        include_subscription_ids: group.subscriptionIds,
                        contents: { en: group.message, he: group.message },
                        headings: { en: group.title, he: group.title },
                        url: pushLink || undefined,
                        data: { link: pushLink, delayed: true }
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
                        results.pending_push_sent += result.recipients;
                        
                        // Update InApp records
                        for (const nId of group.notificationRecordIds) {
                            try {
                                await base44.asServiceRole.entities.InAppNotification.update(nId, { push_sent: true });
                            } catch(e) {}
                        }
                    }
                } catch (e) {
                    console.error('[DailyNotifications] Push batch error:', e);
                    results.errors++;
                }
            }
        }

        // Phase 7c: only now, after durable WhatsApp enqueue/receipt, may the
        // source Task be marked handled. A failed recipient leaves its Task
        // eligible for the next run; the digest key prevents duplicate sends
        // to recipients whose Outbox job already exists.
        for(const taskId of taskIdsReadyToMark(taskExpectedRecipients,taskAcknowledgedRecipients)){
            try{
                const changed=await base44.asServiceRole.entities.Task.updateMany({
                    id:taskId,due_date:taskDueDates.get(taskId),is_completed:false
                },{$set:{whatsapp_notification_sent:true}});
                if(changed?.updated!==1)console.warn('[DailyNotifications] Task changed during notification; flag not written');
            }catch(e){
                console.warn('[DailyNotifications] Task receipt persisted but flag update failed');
                results.errors++;
            }
        }

        // PendingPushNotification cleanup is also owned by the hourly
        // processScheduledPushNotifications worker. No duplicate daily sweep.

        console.log('[DailyNotifications] Completed:', JSON.stringify(results));
        
        return Response.json({ success: true, results });
        
    } catch (error) {
        console.error('[DailyNotifications] Critical Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});


// ============================================================
// PHASE 2 Helper: Process a scheduled_check template
// ============================================================
async function processScheduledTemplate(base44, template, allEvents, servicesByEvent, allSuppliers, allUsers, suppliersMap, existingNotifications, whatsappQueue, pushQueue, results) {
    if (!template.timing_value || !template.timing_unit || !template.timing_direction) return;
    
    const targetDateStart = new Date();
    const targetDateEnd = new Date();
    targetDateStart.setHours(0,0,0,0);
    targetDateEnd.setHours(23,59,59,999);
    
    const offset = template.timing_value * (template.timing_direction === 'after' ? -1 : 1);
    
    if (template.timing_direction !== 'during') {
        if (template.timing_unit === 'days') {
            targetDateStart.setDate(targetDateStart.getDate() + offset);
            targetDateEnd.setDate(targetDateEnd.getDate() + offset);
        } else if (template.timing_unit === 'weeks') {
            targetDateStart.setDate(targetDateStart.getDate() + (offset * 7));
            targetDateEnd.setDate(targetDateEnd.getDate() + (offset * 7));
        } else if (template.timing_unit === 'hours') {
            const now = new Date();
            now.setHours(now.getHours() + offset);
            targetDateStart.setTime(now.getTime() - 12 * 60 * 60000); // 12 hour window for daily run
            targetDateEnd.setTime(now.getTime() + 12 * 60 * 60000);
        } else if (template.timing_unit === 'minutes') {
            // For minute-precision, use a full-day window since we run daily
            const now = new Date();
            now.setMinutes(now.getMinutes() + offset);
            targetDateStart.setTime(now.getTime() - 12 * 60 * 60000);
            targetDateEnd.setTime(now.getTime() + 12 * 60 * 60000);
        }
    }
    
    const dateStr = targetDateStart.toISOString().split('T')[0];
    
    // Filter events matching date
    const matchingEvents = allEvents.filter(e => {
        if (!e.event_date) return false;
        const evDate = e.event_date.split('T')[0];
        return evDate === dateStr;
    });
    
    for (const event of matchingEvents) {
        // Check conditions
        const conditionsMet = checkScheduledConditions(template, event);
        if (!conditionsMet) continue;
        
        // Check duplication
        const hasDuplicate = existingNotifications.some(n => 
            n.related_event_id === event.id && n.template_type === template.type
        );
        if (hasDuplicate) continue;
        
        // Send to audiences
        await sendScheduledToAudiences(base44, template, event, servicesByEvent, allSuppliers, allUsers, suppliersMap, whatsappQueue, pushQueue, results);
    }
}

function checkScheduledConditions(template, event) {
    const logic = template.condition_logic || 'and';
    let allConditions = [];
    
    if (template.condition_field && template.condition_value) {
        allConditions.push({
            field: template.condition_field,
            operator: template.condition_operator || 'equals',
            value: template.condition_value
        });
    }
    
    if (template.event_filter_condition) {
        try {
            const parsed = JSON.parse(template.event_filter_condition);
            if (Array.isArray(parsed)) allConditions = [...allConditions, ...parsed];
        } catch (e) {}
    }
    
    if (allConditions.length === 0) return true;
    
    for (const cond of allConditions) {
        const met = checkSimpleCondition(event, cond);
        if (logic === 'and' && !met) return false;
        if (logic === 'or' && met) return true;
    }
    
    return logic === 'and';
}

function checkSimpleCondition(event, cond) {
    const val = event[cond.field];
    const reqVal = cond.value;
    const op = cond.operator || 'equals';
    
    switch (op) {
        case 'equals': return String(val) == String(reqVal);
        case 'not_equals': return String(val) != String(reqVal);
        case 'greater_than': return parseFloat(val) > parseFloat(reqVal);
        case 'less_than': return parseFloat(val) < parseFloat(reqVal);
        case 'contains': return String(val || '').includes(reqVal);
        case 'is_empty': return !val || val === '';
        case 'is_not_empty': return !!val && val !== '';
        default: return String(val) == String(reqVal);
    }
}

async function sendScheduledToAudiences(base44, template, event, servicesByEvent, allSuppliers, allUsers, suppliersMap, whatsappQueue, pushQueue, results) {
    const audiences = template.target_audiences || [];
    const allowedChannels = template.allowed_channels || ['push'];
    const sendWA = allowedChannels.includes('whatsapp');
    const sendPush = allowedChannels.includes('push');
    
    // Supplier audience
    if (audiences.includes('supplier')) {
        const eventServices = servicesByEvent.get(event.id)||[];
        for (const es of eventServices) {
            if (!es.supplier_ids) continue;
            let supplierIds = [];
            try { supplierIds = typeof es.supplier_ids === 'string' ? JSON.parse(es.supplier_ids) : es.supplier_ids; } catch(e) {}
            
            for (const supId of supplierIds) {
                const supplier = suppliersMap.get(supId);
                if (!supplier) continue;
                
                const contextData = buildEventContext(event, supplier, null, es);
                const title = replacePlaceholders(template.title_template, contextData);
                const message = replacePlaceholders(template.body_template, contextData);
                const waMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
                
                // WhatsApp - direct to phone number (no user dependency)
                if (sendWA && supplier.phone && supplier.whatsapp_enabled !== false) {
                    whatsappQueue.push({phone:supplier.phone,message:waMessage,
                      sourceType:'scheduled_template',sourceId:event.id,
                      idempotencyKey:automatedWhatsAppKey('scheduled_template',{
                        eventId:event.id,recipientId:supId,eventDate:event.event_date,
                        serviceId:es.id,templateType:template.type,target:'supplier'
                      })});
                }
                
                // Push - only for registered users
                if (sendPush && supplier.contact_emails) {
                    for (const email of supplier.contact_emails) {
                        const user = allUsers.find(u => u.email === email);
                        if (user) {
                            try {
                                const notif = await base44.asServiceRole.entities.InAppNotification.create({
                                    user_id: user.id, user_email: user.email,
                                    title, message, link: '',
                                    template_type: template.type,
                                    related_event_id: event.id,
                                    related_supplier_id: supId,
                                    related_event_service_id: es.id,
                                    whatsapp_sent: false,
                                    push_sent: false, is_read: false,
                                    reminder_count: 0, is_resolved: false
                                });
                                linkWhatsAppNotification(whatsappQueue,supplier.phone,waMessage,notif.id);
                                if (user.push_enabled && user.onesignal_subscription_id) {
                                    pushQueue.push({ subscriptionId: user.onesignal_subscription_id, title, message, link: '', notificationRecordId: notif.id });
                                }
                            } catch(e) {}
                        }
                    }
                }
                
                results.scheduled_templates_processed++;
            }
        }
    }
    
    // Client audience
    if (audiences.includes('client') && getClientContacts(event)) {
        const parents = typeof getClientContacts(event) === 'string' ? JSON.parse(getClientContacts(event)) : getClientContacts(event);
        if (Array.isArray(parents)) {
            for (const p of parents) {
                const contextData = buildEventContext(event, null, p);
                const waMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
                
                if (sendWA && p.phone) {
                    whatsappQueue.push({phone:p.phone,message:waMessage,
                      sourceType:'scheduled_template',sourceId:event.id,
                      idempotencyKey:automatedWhatsAppKey('scheduled_template',{
                        eventId:event.id,recipientId:p.email||p.phone,eventDate:event.event_date,
                        templateType:template.type,target:'client'
                      })});
                }
                if (sendPush && p.email) {
                    const user = allUsers.find(u => u.email === p.email);
                    if (user) {
                        const title = replacePlaceholders(template.title_template, contextData);
                        const message = replacePlaceholders(template.body_template, contextData);
                        try {
                            const notif = await base44.asServiceRole.entities.InAppNotification.create({
                                user_id: user.id, user_email: user.email,
                                title, message, link: '',
                                template_type: template.type, related_event_id: event.id,
                                whatsapp_sent: false,
                                push_sent: false, is_read: false,
                                reminder_count: 0, is_resolved: false
                            });
                            linkWhatsAppNotification(whatsappQueue,p.phone,waMessage,notif.id);
                            if (user.push_enabled && user.onesignal_subscription_id) {
                                pushQueue.push({ subscriptionId: user.onesignal_subscription_id, title, message, link: '', notificationRecordId: notif.id });
                            }
                        } catch(e) {}
                    }
                }
            }
        }
    }
    
    // Admin audience
    if (audiences.includes('admin')) {
        let admins = allUsers.filter(u => u.role === 'admin');
        // סינון מנהלים לפי admin_recipient_ids של התבנית
        const targetedAdminIds = template.admin_recipient_ids || template.adminrecipientids;
        if (Array.isArray(targetedAdminIds) && targetedAdminIds.length > 0) {
            admins = admins.filter(a => targetedAdminIds.includes(a.id));
        }
        for (const admin of admins) {
            const contextData = buildEventContext(event, null, admin);
            const title = replacePlaceholders(template.title_template, contextData);
            const message = replacePlaceholders(template.body_template, contextData);
            const waMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
            
            if (sendWA && admin.phone) {
                whatsappQueue.push({phone:admin.phone,message:waMessage,
                  sourceType:'scheduled_template',sourceId:event.id,
                  idempotencyKey:automatedWhatsAppKey('scheduled_template',{
                    eventId:event.id,recipientId:admin.id,eventDate:event.event_date,
                    templateType:template.type,target:'admin'
                  })});
            }
            
            try {
                const notif = await base44.asServiceRole.entities.InAppNotification.create({
                    user_id: admin.id, user_email: admin.email,
                    title, message, link: '',
                    template_type: template.type, related_event_id: event.id,
                    whatsapp_sent: false,
                    push_sent: false, is_read: false,
                    reminder_count: 0, is_resolved: false
                });
                linkWhatsAppNotification(whatsappQueue,admin.phone,waMessage,notif.id);
                if (admin.push_enabled && admin.onesignal_subscription_id) {
                    pushQueue.push({ subscriptionId: admin.onesignal_subscription_id, title, message, link: '', notificationRecordId: notif.id });
                }
            } catch(e) {}
        }
    }
}


// (All helper functions defined at the top of the file before Deno.serve)
