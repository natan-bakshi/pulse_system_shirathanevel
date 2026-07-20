import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { formatEventContacts } from '../../shared/eventContacts.ts';

/**
 * scheduleQuoteFollowup
 * ----------------------------------------------------------------------------
 * מחליף את checkOpenQuotes (Phase 2 הישן) במודל מונחה-אירועים.
 * מופעל כטריגר entity על Event create/update.
 *
 * כשאירוע נמצא בסטטוס 'quote', מתזמן תזכורת מעקב למנהלים (ADMIN_QUOTE_FOLLOWUP)
 * ל-X זמן אחרי יצירת ההצעה (לפי timing בתבנית), עם
 * condition_type='event_still_open_quote'.
 *
 * הבדיקה הסופית (האם האירוע עדיין בסטטוס 'quote') נעשית שוב בזמן השליחה
 * ב-processScheduledPushNotifications (Lazy Evaluation). אם האירוע כבר אושר/בוטל -
 * ההתראה מבוטלת בשקט. בנוסף, טריגר cancelScheduledNotifications מוחק את
 * התזמון בעת מעבר סטטוס/מחיקה.
 *
 * נשלט במלואו ע"י התבנית: is_active, timing_value, timing_unit,
 * title_template, body_template, whatsapp_body_template, allowed_channels,
 * admin_recipient_ids, deep_link_base, deep_link_params_map.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();

        // תמיכה בקריאה ישירה (eventId) + טריגר entity automation (event/data)
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

        if (!eventId) {
            return Response.json({ skipped: true, reason: 'No eventId' });
        }

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

        // פועלים רק כשהאירוע בסטטוס 'quote'.
        if (currentStatus !== 'quote') {
            return Response.json({ skipped: true, reason: 'Event not in quote status' });
        }
        // אם הגיע מ-update והסטטוס כבר היה 'quote' - לא יוצרים שוב (נוצר בעת היצירה).
        if (previousStatus !== null && previousStatus === 'quote') {
            return Response.json({ skipped: true, reason: 'Status unchanged (already quote)' });
        }

        const [templates, allUsers, existingPending] = await Promise.all([
            base44.asServiceRole.entities.NotificationTemplate.filter({ is_active: true }),
            base44.asServiceRole.entities.User.list(),
            base44.asServiceRole.entities.PendingPushNotification.filter({ related_event_id: eventId, is_sent: false })
        ]);

        const template = templates.find(t => t.type === 'ADMIN_QUOTE_FOLLOWUP');
        if (!template) {
            return Response.json({ skipped: true, reason: 'Template ADMIN_QUOTE_FOLLOWUP not active' });
        }

        const adminUsers = allUsers.filter(u => u.role === 'admin');
        const ids = template.admin_recipient_ids;
        const targetedAdmins = (Array.isArray(ids) && ids.length > 0)
            ? adminUsers.filter(a => ids.includes(a.id))
            : adminUsers;

        // מועד מתוזמן: X זמן אחרי יצירת ההצעה (ברירת מחדל 7 ימים) מרגע עכשיו
        const timingValue = template.timing_value || 7;
        const timingUnit = template.timing_unit || 'days';
        const scheduledFor = new Date();
        applyTimingOffset(scheduledFor, timingUnit, timingValue);

        const allowedChannels = template.allowed_channels || ['push'];

        // days_open: מספר הימים שההצעה תהיה פתוחה עד מועד התזכורת (לפי ה-timing).
        // בגישה מונחית-טריגר התזמון הוא timing ימים מהיצירה, ולכן זה הערך בעת השליחה.
        const daysOpenAtReminder = timingUnit === 'days' ? timingValue
            : timingUnit === 'weeks' ? timingValue * 7
            : timingValue;

        const contextData = {
            event_name: eventData.event_name || '',
            family_name: eventData.family_name || '',
            event_date: formatDate(eventData.event_date),
            event_contacts: formatEventContacts(eventData),
            days_open: daysOpenAtReminder,
            event_id: eventData.id
        };

        const title = replacePlaceholders(template.title_template, contextData);
        const message = replacePlaceholders(template.body_template, contextData);
        const waMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
        const link = buildDeepLink(template.deep_link_base, template.deep_link_params_map, contextData);

        let scheduled = 0;
        for (const admin of targetedAdmins) {
            const exists = existingPending.some(p =>
                p.template_type === 'ADMIN_QUOTE_FOLLOWUP' && p.user_id === admin.id
            );
            if (exists) continue;

            const waData = (allowedChannels.includes('whatsapp') && admin.phone)
                ? JSON.stringify({ send_whatsapp: true, whatsapp_message: waMessage, phone: admin.phone })
                : JSON.stringify({});

            await base44.asServiceRole.entities.PendingPushNotification.create({
                user_id: admin.id,
                user_email: admin.email,
                title, message, link: link || '',
                scheduled_for: scheduledFor.toISOString(),
                template_type: 'ADMIN_QUOTE_FOLLOWUP',
                is_sent: false,
                condition_type: 'event_still_open_quote',
                related_event_id: eventData.id,
                data: waData
            });
            scheduled++;
        }

        return Response.json({ success: true, scheduled });

    } catch (error) {
        console.error('[scheduleQuoteFollowup] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// ============================================================
// Helpers
// ============================================================
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