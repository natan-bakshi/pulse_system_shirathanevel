import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { formatEventContacts } from '../../shared/eventContacts.ts';

/**
 * scheduleEventLifecycleNotifications
 * ----------------------------------------------------------------------------
 * מחליף את פאזות 5+6 של dailyScheduledNotifications במודל מונחה-אירועים.
 * מופעל כטריגר על עדכון Event (entity automation על שינוי status).
 *
 * פאזה 5 (שיבוצים חסרים): כשאירוע עובר ל-'confirmed' ויש בו שיבוצים חסרים,
 *   יוצר PendingPushNotification מתוזמן לשבוע לפני האירוע (לפי timing בתבנית
 *   ADMIN_MISSING_ASSIGNMENT), עם condition_type='event_still_missing_assignments'.
 *
 * פאזה 6 (תזכורת תשלום): כשאירוע עובר ל-'confirmed' ויש לו יתרת תשלום,
 *   יוצר PendingPushNotification מתוזמן ליומיים אחרי האירוע (לפי timing בתבנית
 *   CLIENT_PAYMENT_REMINDER), עם condition_type='event_still_has_balance'.
 *
 * כל ההתנהגות נשלטת מהתבניות (NotificationTemplate): is_active, timing_value,
 * timing_unit, title_template, body_template, whatsapp_body_template,
 * allowed_channels, admin_recipient_ids, deep_link_base, deep_link_params_map.
 *
 * הבדיקה הסופית (האם עדיין חסר שיבוץ / האם עדיין יש יתרה) נעשית שוב בזמן
 * השליחה בפועל ב-processScheduledPushNotifications (Lazy Evaluation).
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();

        // תמיכה גם בקריאה ישירה (eventId) וגם בטריגר entity automation (event/data)
        const { event, data, old_data } = payload;
        const oldData = old_data || payload.olddata;

        let eventId = payload.eventId;
        let currentStatus = null;
        let previousStatus = null;

        if (!eventId && data) {
            eventId = data.id;
            currentStatus = data.status;
            previousStatus = oldData ? oldData.status : null;
        }

        if (event?.entity_name === 'Event' && event?.type === 'update' && data && oldData) {
            const lifecycleRelevantChanged = oldData.status !== data.status || oldData.event_date !== data.event_date;
            if (!lifecycleRelevantChanged) {
                return Response.json({ skipped: true, reason: 'No lifecycle-relevant Event change' });
            }
        }

        if (!eventId) {
            return Response.json({ skipped: true, reason: 'No eventId' });
        }

        // טוענים את האירוע (מקור אמת)
        let eventData = null;
        try {
            eventData = await base44.asServiceRole.entities.Event.get(eventId);
        } catch (e) {
            return Response.json({ skipped: true, reason: 'Event not found' });
        }
        if (!eventData) {
            return Response.json({ skipped: true, reason: 'Event not found' });
        }
        if (currentStatus === null) currentStatus = eventData.status;

        // פועלים רק כשהאירוע 'confirmed' או 'in_progress' (סגור/משובץ).
        const activeStatuses = ['confirmed', 'in_progress'];
        if (!activeStatuses.includes(currentStatus)) {
            return Response.json({ skipped: true, reason: 'Event not confirmed or in_progress' });
        }

        // זיהוי שינוי תאריך אירוע (כשהאירוע כבר היה confirmed):
        // אם השתנה event_date - מבטלים את כל התזמונים הקיימים של מחזור-החיים
        // ויוצרים אותם מחדש לפי התאריך החדש ("מחק וצור מחדש").
        const dateChanged = previousStatus !== null && oldData &&
            oldData.event_date && data?.event_date &&
            oldData.event_date !== data.event_date;

        // מניעת כפילות ביצירה: אם האירוע כבר היה באותו סטטוס פעיל והתאריך לא השתנה -
        // לא יוצרים שוב (התזמונים כבר נוצרו בעת האישור הראשוני).
        if (previousStatus !== null && activeStatuses.includes(previousStatus) && activeStatuses.includes(currentStatus) && !dateChanged) {
            return Response.json({ skipped: true, reason: 'Status unchanged (already active), no date change' });
        }

        // אם זה שינוי תאריך - מוחקים תחילה את כל התזמונים שטרם נשלחו של מחזור-החיים
        // (תזכורת אירוע, שיבוצים חסרים, יתרת תשלום) כדי ליצור אותם מחדש לפי התאריך החדש.
        if (dateChanged) {
            const lifecycleTypes = ['EVENT_REMINDER_FANOUT', 'ADMIN_MISSING_ASSIGNMENT', 'CLIENT_PAYMENT_REMINDER'];
            for (const templateType of lifecycleTypes) {
                await base44.asServiceRole.entities.PendingPushNotification.deleteMany({
                    related_event_id: eventId,
                    is_sent: false,
                    template_type: templateType
                });
            }
        }

        // טוענים תבניות פעילות + ישויות נדרשות
        const [templates, eventServices, allServices, allPayments, allUsers, appSettings, existingPending] = await Promise.all([
            base44.asServiceRole.entities.NotificationTemplate.filter({ is_active: true }),
            base44.asServiceRole.entities.EventService.filter({ event_id: eventId }),
            base44.asServiceRole.entities.Service.list(),
            base44.asServiceRole.entities.Payment.filter({ event_id: eventId }),
            base44.asServiceRole.entities.User.list(),
            base44.asServiceRole.entities.AppSettings.list(),
            base44.asServiceRole.entities.PendingPushNotification.filter({ related_event_id: eventId, is_sent: false })
        ]);

        const servicesMap = new Map(allServices.map(s => [s.id, s]));
        const adminUsers = allUsers.filter(u => u.role === 'admin');
        const results = { missing_assignment_scheduled: 0, payment_reminder_scheduled: 0, event_reminder_scheduled: 0 };

        // ============================================================
        // פאזה 5: שיבוצים חסרים -> תזכורת שבוע לפני האירוע
        // ============================================================
        // פאזה 5 לא רלוונטית לאירועים in_progress (כבר משובצים ב-100%)
        const missingTemplate = templates.find(t => t.type === 'ADMIN_MISSING_ASSIGNMENT');
        if (missingTemplate && currentStatus !== 'in_progress') {
            // בדיקה: האם יש כרגע שיבוצים חסרים?
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
                // מועד מתוזמן: timing לפני האירוע (ברירת מחדל 7 ימים)
                const timingValue = missingTemplate.timing_value || 7;
                const timingUnit = missingTemplate.timing_unit || 'days';
                const scheduledFor = computeScheduledBeforeEvent(eventData.event_date, timingValue, timingUnit);

                const allowedChannels = missingTemplate.allowed_channels || ['push'];
                const targetedAdmins = filterTargetedAdmins(missingTemplate, adminUsers);

                // תוכן ההודעה
                let contextData;
                let customMessage = null;
                if (missingServices.length === 1) {
                    const ms = missingServices[0];
                    contextData = {
                        event_name: eventData.event_name || '',
                        family_name: eventData.family_name || '',
                        event_date: formatDate(eventData.event_date),
                        event_contacts: formatEventContacts(eventData),
                        service_name: ms.serviceName,
                        min_suppliers: ms.minRequired,
                        current_suppliers: ms.approvedCount,
                        missing_count: 1,
                        event_id: eventData.id
                    };
                } else {
                    const servicesList = missingServices.map(ms => `• ${ms.serviceName} (${ms.approvedCount}/${ms.minRequired})`).join('\n');
                    contextData = {
                        event_name: eventData.event_name || '',
                        family_name: eventData.family_name || '',
                        event_date: formatDate(eventData.event_date),
                        event_contacts: formatEventContacts(eventData),
                        service_name: '',
                        missing_count: missingServices.length,
                        event_id: eventData.id
                    };
                    customMessage = `חסרים שיבוצים באירוע "${eventData.event_name || eventData.family_name}" בתאריך ${formatDate(eventData.event_date)}.\n\nשירותים חסרי שיבוץ (${missingServices.length}):\n${servicesList}`;
                }

                const title = replacePlaceholders(missingTemplate.title_template, contextData);
                const message = customMessage || replacePlaceholders(missingTemplate.body_template, contextData);
                const waMessage = customMessage || replacePlaceholders(missingTemplate.whatsapp_body_template || missingTemplate.body_template, contextData);
                const link = buildDeepLink(missingTemplate.deep_link_base, missingTemplate.deep_link_params_map, contextData);

                const missingAssignmentRecords = [];
                for (const admin of targetedAdmins) {
                    // מניעת כפילות: כבר קיימת תזכורת מסוג זה לאירוע ולמנהל
                    const exists = existingPending.some(p =>
                        p.template_type === 'ADMIN_MISSING_ASSIGNMENT' && p.user_id === admin.id
                    );
                    if (exists) continue;

                    const waData = (allowedChannels.includes('whatsapp') && admin.phone)
                        ? JSON.stringify({ send_whatsapp: true, whatsapp_message: waMessage, phone: admin.phone })
                        : JSON.stringify({});

                    missingAssignmentRecords.push({
                        user_id: admin.id,
                        user_email: admin.email,
                        title, message, link: link || '',
                        scheduled_for: scheduledFor.toISOString(),
                        template_type: 'ADMIN_MISSING_ASSIGNMENT',
                        is_sent: false,
                        condition_type: 'event_still_missing_assignments',
                        related_event_id: eventData.id,
                        data: waData
                    });
                }
                if (missingAssignmentRecords.length > 0) {
                    await base44.asServiceRole.entities.PendingPushNotification.bulkCreate(missingAssignmentRecords);
                    results.missing_assignment_scheduled += missingAssignmentRecords.length;
                }
            }
        }

        // ============================================================
        // פאזה 6: יתרת תשלום -> תזכורת יומיים אחרי האירוע
        // ============================================================
        const paymentTemplate = templates.find(t => t.type === 'CLIENT_PAYMENT_REMINDER');
        if (paymentTemplate) {
            const vatSetting = appSettings.find(s => s.setting_key === 'vat_rate');
            const vatRate = vatSetting ? parseFloat(vatSetting.setting_value) / 100 : 0.17;

            // חישוב יתרה נוכחית
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
                // מועד מתוזמן: timing אחרי האירוע (ברירת מחדל 2 ימים)
                const timingValue = paymentTemplate.timing_value || 2;
                const timingUnit = paymentTemplate.timing_unit || 'days';
                const scheduledFor = computeScheduledAfterEvent(eventData.event_date, timingValue, timingUnit);

                const allowedChannels = paymentTemplate.allowed_channels || ['push'];
                const formatCurrency = (amount) => new Intl.NumberFormat('he-IL', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

                // מאתרים לקוחות מתוך parents
                const clientUsers = [];
                if (eventData.parents && Array.isArray(eventData.parents)) {
                    for (const parent of eventData.parents) {
                        if (parent.email) {
                            const clientUser = allUsers.find(u => u.email?.toLowerCase() === parent.email.toLowerCase());
                            if (clientUser) clientUsers.push({ user: clientUser, phone: parent.phone });
                        }
                    }
                }

                const paymentReminderRecords = [];
                for (const { user: clientUser, phone } of clientUsers) {
                    const exists = existingPending.some(p =>
                        p.template_type === 'CLIENT_PAYMENT_REMINDER' && p.user_id === clientUser.id
                    );
                    if (exists) continue;

                    const contextData = {
                        event_name: eventData.event_name || '',
                        family_name: eventData.family_name || '',
                        event_date: formatDate(eventData.event_date),
                        event_contacts: formatEventContacts(eventData),
                        balance: formatCurrency(balance),
                        event_id: eventData.id,
                        client_name: clientUser.full_name || ''
                    };

                    const title = replacePlaceholders(paymentTemplate.title_template, contextData);
                    const message = replacePlaceholders(paymentTemplate.body_template, contextData);
                    const waMessage = replacePlaceholders(paymentTemplate.whatsapp_body_template || paymentTemplate.body_template, contextData);
                    const link = buildDeepLink(paymentTemplate.deep_link_base, paymentTemplate.deep_link_params_map, contextData);

                    const waData = (allowedChannels.includes('whatsapp') && phone)
                        ? JSON.stringify({ send_whatsapp: true, whatsapp_message: waMessage, phone })
                        : JSON.stringify({});

                    paymentReminderRecords.push({
                        user_id: clientUser.id,
                        user_email: clientUser.email,
                        title, message, link: link || '',
                        scheduled_for: scheduledFor.toISOString(),
                        template_type: 'CLIENT_PAYMENT_REMINDER',
                        is_sent: false,
                        condition_type: 'event_still_has_balance',
                        related_event_id: eventData.id,
                        data: waData
                    });
                }
                if (paymentReminderRecords.length > 0) {
                    await base44.asServiceRole.entities.PendingPushNotification.bulkCreate(paymentReminderRecords);
                    results.payment_reminder_scheduled += paymentReminderRecords.length;
                }
            }
        }

        // ============================================================
        // פאזה 7: תזכורת אירוע (fan-out) -> תזכורת לפני האירוע
        // רשומה אחת בלבד לאירוע, עם condition_type='event_reminder_fanout'.
        // בעת השליחה, processScheduledPushNotifications מאתר את כל הספקים
        // המאושרים + המנהלים ושולח לכולם (push + whatsapp).
        // נשלט ע"י תבניות SUPPLIER_EVENT_REMINDER ו/או ADMIN_EVENT_REMINDER.
        // ============================================================
        const supplierReminderTemplate = templates.find(t => t.type === 'SUPPLIER_EVENT_REMINDER');
        const adminReminderTemplate = templates.find(t => t.type === 'ADMIN_EVENT_REMINDER');
        if (supplierReminderTemplate || adminReminderTemplate) {
            // תזמון לפי התבנית הזמינה (עדיפות לספק; ברירת מחדל יום אחד לפני)
            const timingTemplate = supplierReminderTemplate || adminReminderTemplate;
            const timingValue = timingTemplate.timing_value || 1;
            const timingUnit = timingTemplate.timing_unit || 'days';
            const scheduledFor = computeScheduledBeforeEvent(eventData.event_date, timingValue, timingUnit);

            // מניעת כפילות: רשומת fan-out אחת לאירוע
            const exists = existingPending.some(p => p.template_type === 'EVENT_REMINDER_FANOUT');
            if (!exists) {
                await base44.asServiceRole.entities.PendingPushNotification.create({
                    user_id: `event_fanout_${eventData.id}`,
                    user_email: '',
                    title: 'תזכורת אירוע',
                    message: 'תזכורת אירוע',
                    link: '',
                    scheduled_for: scheduledFor.toISOString(),
                    template_type: 'EVENT_REMINDER_FANOUT',
                    is_sent: false,
                    condition_type: 'event_reminder_fanout',
                    related_event_id: eventData.id,
                    data: JSON.stringify({})
                });
                results.event_reminder_scheduled++;
            }
        }

        return Response.json({ success: true, results });

    } catch (error) {
        console.error('[scheduleEventLifecycleNotifications] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// ============================================================
// Helpers
// ============================================================

// מחשב מועד "X זמן לפני תאריך האירוע" (09:00 שעון ישראל בקירוב, ב-UTC)
function computeScheduledBeforeEvent(eventDateStr, timingValue, timingUnit) {
    const base = getIsraelEventDate(eventDateStr, '09:00');
    applyTimingOffset(base, timingUnit, -timingValue);
    return base;
}

// מחשב מועד "X זמן אחרי תאריך האירוע" (09:00 שעון ישראל בקירוב, ב-UTC)
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
        } catch (e) {}
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