import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { formatEventContacts } from '../../shared/eventContacts.ts';

/**
 * backfillEventLifecycleNotifications
 * ------------------------------------
 * סקריפט חד-פעמי שמפעיל את לוגיקת scheduleEventLifecycleNotifications
 * עבור כל האירועים הקיימים בסטטוס 'confirmed' שעדיין אין להם
 * PendingPushNotification מתוזמן מסוג lifecycle.
 *
 * מריצים פעם אחת בלבד, מדף הפונקציות בדשבורד.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // שליפת כל האירועים confirmed + in_progress
        const [confirmedEvents, inProgressEvents] = await Promise.all([
            base44.asServiceRole.entities.Event.filter({ status: 'confirmed' }),
            base44.asServiceRole.entities.Event.filter({ status: 'in_progress' })
        ]);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const allEvents = [...confirmedEvents, ...inProgressEvents]
            .filter(ev => ev.event_date && new Date(ev.event_date).getTime() >= today.getTime());

        // שליפת כל ה-PendingPushNotification שטרם נשלחו (lifecycle)
        const lifecycleTypes = ['ADMIN_MISSING_ASSIGNMENT', 'CLIENT_PAYMENT_REMINDER', 'EVENT_REMINDER_FANOUT'];
        const allPending = await base44.asServiceRole.entities.PendingPushNotification.filter({ is_sent: false });

        // בניית מפה: eventId -> Set של template_types שכבר קיימים
        const existingByEvent = {};
        for (const p of allPending) {
            if (!p.related_event_id || !lifecycleTypes.includes(p.template_type)) continue;
            if (!existingByEvent[p.related_event_id]) existingByEvent[p.related_event_id] = new Set();
            existingByEvent[p.related_event_id].add(p.template_type);
        }

        // סינון: רק אירועים שחסרים להם רשומות lifecycle
        const eventsToProcess = allEvents.filter(ev => {
            const existing = existingByEvent[ev.id];
            if (!existing) return true;
            return lifecycleTypes.some(t => !existing.has(t));
        });

        // טוענים נתונים משותפים פעם אחת
        const [templates, allServicesData, allUsers, appSettings] = await Promise.all([
            base44.asServiceRole.entities.NotificationTemplate.filter({ is_active: true }),
            base44.asServiceRole.entities.Service.list(),
            base44.asServiceRole.entities.User.list(),
            base44.asServiceRole.entities.AppSettings.list()
        ]);

        const servicesMap = new Map(allServicesData.map(s => [s.id, s]));
        const adminUsers = allUsers.filter(u => u.role === 'admin');
        const vatSetting = appSettings.find(s => s.setting_key === 'vat_rate');
        const vatRate = vatSetting ? parseFloat(vatSetting.setting_value) / 100 : 0.17;

        const missingTemplate = templates.find(t => t.type === 'ADMIN_MISSING_ASSIGNMENT');
        const paymentTemplate = templates.find(t => t.type === 'CLIENT_PAYMENT_REMINDER');
        const supplierReminderTemplate = templates.find(t => t.type === 'SUPPLIER_EVENT_REMINDER');
        const adminReminderTemplate = templates.find(t => t.type === 'ADMIN_EVENT_REMINDER');

        const results = {
            total_confirmed_events: allEvents.length,
            events_to_process: eventsToProcess.length,
            processed: 0,
            succeeded: 0,
            failed: 0,
            details: [],
            errors: []
        };

        for (const eventData of eventsToProcess) {
            results.processed++;
            try {
                const eventResults = { eventId: eventData.id, eventName: eventData.event_name, missing_assignment: 0, payment_reminder: 0, event_reminder: 0 };

                // טוענים נתוני אירוע ספציפיים
                const [eventServices, allPayments] = await Promise.all([
                    base44.asServiceRole.entities.EventService.filter({ event_id: eventData.id }),
                    base44.asServiceRole.entities.Payment.filter({ event_id: eventData.id })
                ]);

                const existingPending = allPending.filter(p => p.related_event_id === eventData.id && !p.is_sent);

                // === פאזה 5: שיבוצים חסרים (לא רלוונטי לאירועים in_progress - כבר משובצים ב-100%) ===
                if (missingTemplate && eventData.status !== 'in_progress') {
                    let hasMissing = false;
                    const missingServices = [];
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
                        if (approvedCount < minRequired) {
                            hasMissing = true;
                            missingServices.push({ serviceName: serviceDef?.service_name || '', minRequired, approvedCount });
                        }
                    }

                    if (hasMissing) {
                        const timingValue = missingTemplate.timing_value || 7;
                        const timingUnit = missingTemplate.timing_unit || 'days';
                        const scheduledFor = computeScheduledBeforeEvent(eventData.event_date, timingValue, timingUnit);
                        const allowedChannels = missingTemplate.allowed_channels || ['push'];
                        const targetedAdmins = filterTargetedAdmins(missingTemplate, adminUsers);

                        let contextData;
                        let customMessage = null;
                        if (missingServices.length === 1) {
                            const ms = missingServices[0];
                            contextData = { event_name: eventData.event_name || '', family_name: eventData.family_name || '', event_date: formatDate(eventData.event_date), event_contacts: formatEventContacts(eventData), service_name: ms.serviceName, min_suppliers: ms.minRequired, current_suppliers: ms.approvedCount, missing_count: 1, event_id: eventData.id };
                        } else {
                            const servicesList = missingServices.map(ms => `• ${ms.serviceName} (${ms.approvedCount}/${ms.minRequired})`).join('\n');
                            contextData = { event_name: eventData.event_name || '', family_name: eventData.family_name || '', event_date: formatDate(eventData.event_date), event_contacts: formatEventContacts(eventData), service_name: '', missing_count: missingServices.length, event_id: eventData.id };
                            customMessage = `חסרים שיבוצים באירוע "${eventData.event_name || eventData.family_name}" בתאריך ${formatDate(eventData.event_date)}.\n\nשירותים חסרי שיבוץ (${missingServices.length}):\n${servicesList}`;
                        }

                        const title = replacePlaceholders(missingTemplate.title_template, contextData);
                        const message = customMessage || replacePlaceholders(missingTemplate.body_template, contextData);
                        const waMessage = customMessage || replacePlaceholders(missingTemplate.whatsapp_body_template || missingTemplate.body_template, contextData);
                        const link = buildDeepLink(missingTemplate.deep_link_base, missingTemplate.deep_link_params_map, contextData);

                        for (const admin of targetedAdmins) {
                            const exists = existingPending.some(p => p.template_type === 'ADMIN_MISSING_ASSIGNMENT' && p.user_id === admin.id);
                            if (exists) continue;
                            const waData = (allowedChannels.includes('whatsapp') && admin.phone) ? JSON.stringify({ send_whatsapp: true, whatsapp_message: waMessage, phone: admin.phone }) : JSON.stringify({});
                            await base44.asServiceRole.entities.PendingPushNotification.create({
                                user_id: admin.id, user_email: admin.email, title, message, link: link || '',
                                scheduled_for: scheduledFor.toISOString(), template_type: 'ADMIN_MISSING_ASSIGNMENT',
                                is_sent: false, condition_type: 'event_still_missing_assignments', related_event_id: eventData.id, data: waData
                            });
                            eventResults.missing_assignment++;
                        }
                    }
                }

                // === פאזה 6: יתרת תשלום ===
                if (paymentTemplate) {
                    let totalCost = 0;
                    if (eventData.all_inclusive && eventData.all_inclusive_price) {
                        totalCost = eventData.all_inclusive_price;
                        if (!eventData.all_inclusive_includes_vat) totalCost *= (1 + vatRate);
                    } else if (eventData.total_override) {
                        totalCost = eventData.total_override;
                        if (!eventData.total_override_includes_vat) totalCost *= (1 + vatRate);
                    } else {
                        for (const es of eventServices) {
                            const price = es.custom_price || es.total_price || 0;
                            const quantity = es.quantity || 1;
                            let serviceCost = price * quantity;
                            if (!es.includes_vat) serviceCost *= (1 + vatRate);
                            totalCost += serviceCost;
                        }
                    }
                    if (eventData.discount_amount) totalCost = Math.max(0, totalCost - eventData.discount_amount);
                    const totalPaid = allPayments.filter(p => p.payment_status === 'completed').reduce((sum, p) => sum + (p.amount || 0), 0);
                    const balance = totalCost - totalPaid;

                    if (balance > 0) {
                        const timingValue = paymentTemplate.timing_value || 2;
                        const timingUnit = paymentTemplate.timing_unit || 'days';
                        const scheduledFor = computeScheduledAfterEvent(eventData.event_date, timingValue, timingUnit);
                        const allowedChannels = paymentTemplate.allowed_channels || ['push'];
                        const formatCurrency = (amount) => new Intl.NumberFormat('he-IL', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

                        const clientUsers = [];
                        if (eventData.parents && Array.isArray(eventData.parents)) {
                            for (const parent of eventData.parents) {
                                if (parent.email) {
                                    const clientUser = allUsers.find(u => u.email?.toLowerCase() === parent.email.toLowerCase());
                                    if (clientUser) clientUsers.push({ user: clientUser, phone: parent.phone });
                                }
                            }
                        }

                        for (const { user: clientUser, phone } of clientUsers) {
                            const exists = existingPending.some(p => p.template_type === 'CLIENT_PAYMENT_REMINDER' && p.user_id === clientUser.id);
                            if (exists) continue;
                            const contextData = { event_name: eventData.event_name || '', family_name: eventData.family_name || '', event_date: formatDate(eventData.event_date), event_contacts: formatEventContacts(eventData), balance: formatCurrency(balance), event_id: eventData.id, client_name: clientUser.full_name || '' };
                            const title = replacePlaceholders(paymentTemplate.title_template, contextData);
                            const message = replacePlaceholders(paymentTemplate.body_template, contextData);
                            const waMessage = replacePlaceholders(paymentTemplate.whatsapp_body_template || paymentTemplate.body_template, contextData);
                            const link = buildDeepLink(paymentTemplate.deep_link_base, paymentTemplate.deep_link_params_map, contextData);
                            const waData = (allowedChannels.includes('whatsapp') && phone) ? JSON.stringify({ send_whatsapp: true, whatsapp_message: waMessage, phone }) : JSON.stringify({});
                            await base44.asServiceRole.entities.PendingPushNotification.create({
                                user_id: clientUser.id, user_email: clientUser.email, title, message, link: link || '',
                                scheduled_for: scheduledFor.toISOString(), template_type: 'CLIENT_PAYMENT_REMINDER',
                                is_sent: false, condition_type: 'event_still_has_balance', related_event_id: eventData.id, data: waData
                            });
                            eventResults.payment_reminder++;
                        }
                    }
                }

                // === פאזה 7: תזכורת אירוע (fan-out) ===
                if (supplierReminderTemplate || adminReminderTemplate) {
                    const timingTemplate = supplierReminderTemplate || adminReminderTemplate;
                    const timingValue = timingTemplate.timing_value || 1;
                    const timingUnit = timingTemplate.timing_unit || 'days';
                    const scheduledFor = computeScheduledBeforeEvent(eventData.event_date, timingValue, timingUnit);
                    const exists = existingPending.some(p => p.template_type === 'EVENT_REMINDER_FANOUT');
                    if (!exists) {
                        await base44.asServiceRole.entities.PendingPushNotification.create({
                            user_id: `event_fanout_${eventData.id}`, user_email: '',
                            title: 'תזכורת אירוע', message: 'תזכורת אירוע', link: '',
                            scheduled_for: scheduledFor.toISOString(), template_type: 'EVENT_REMINDER_FANOUT',
                            is_sent: false, condition_type: 'event_reminder_fanout', related_event_id: eventData.id, data: JSON.stringify({})
                        });
                        eventResults.event_reminder++;
                    }
                }

                results.succeeded++;
                results.details.push(eventResults);
            } catch (err) {
                results.failed++;
                results.errors.push({ eventId: eventData.id, eventName: eventData.event_name, error: err.message });
            }
        }

        return Response.json({ success: true, results });

    } catch (error) {
        console.error('[backfillEventLifecycleNotifications] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// ============================================================
// Helpers (duplicated from scheduleEventLifecycleNotifications)
// ============================================================

function computeScheduledBeforeEvent(eventDateStr, timingValue, timingUnit) {
    const base = getIsraelEventDate(eventDateStr, '09:00');
    applyTimingOffset(base, timingUnit, -timingValue);
    return base;
}

function computeScheduledAfterEvent(eventDateStr, timingValue, timingUnit) {
    const base = getIsraelEventDate(eventDateStr, '09:00');
    applyTimingOffset(base, timingUnit, timingValue);
    return base;
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
        } catch {}
    }
    return url;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `\u200E${dd}/${mm}/${yyyy}`;
}

function filterTargetedAdmins(template, adminUsers) {
    const ids = template?.admin_recipient_ids;
    if (!Array.isArray(ids) || ids.length === 0) return adminUsers;
    return adminUsers.filter(a => ids.includes(a.id));
}