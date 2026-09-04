// ליבת יצירת ההתראות - מודול backend פנימי בלבד (לא endpoint ציבורי).
// נקרא ישירות מפונקציות ה-backend, ומ-endpoint ה-HTTP המאומת createNotification.
import { validateNotificationInput, sanitizeLink, PULSE_ORIGIN } from "./notificationValidation.ts";
import { sendWhatsAppText } from "./whatsappSend.ts";

/**
 * יוצר התראה פנימית, ובאופן אופציונלי שולח Push ו/או WhatsApp.
 * options.allowWhatsApp - מאפשר ערוץ WhatsApp (נדלק רק מבקשת מנהל מאומתת).
 * options.allowManualPhone - מאפשר target_phone ידני (מנהל בלבד).
 */
export async function createNotificationCore(base44, payload, options = {}) {
    const validation = validateNotificationInput(payload);
    if (!validation.valid) {
        return { ok: false, status: 400, body: { error: validation.error } };
    }

    const input = validation.value;
    const allowWhatsApp = options.allowWhatsApp === true && input.send_whatsapp;
    const allowManualPhone = options.allowManualPhone === true;

    let targetUserId = input.target_user_id;
    let sendPush = input.send_push;
    let link = input.link;

    // --- 1. פתרון המשתמש היעד ---
    let targetUser = null;
    try {
        if (targetUserId && !targetUserId.startsWith('virtual')) {
            const users = await base44.asServiceRole.entities.User.filter({ id: targetUserId });
            targetUser = users.length > 0 ? users[0] : null;
        }
        if (input.target_user_email && !targetUser) {
            const usersByEmail = await base44.asServiceRole.entities.User.filter({ email: input.target_user_email });
            if (usersByEmail.length > 0) {
                targetUser = usersByEmail[0];
                if (!targetUserId) targetUserId = targetUser.id;
            }
        }
    } catch (e) {
        console.warn('[Notification] user resolution failed');
    }

    // אימות התאמה בין מזהה למייל כשמתקבלים שניהם
    if (targetUser && input.target_user_id && input.target_user_email) {
        const resolvedEmail = String(targetUser.email || '').toLowerCase().trim();
        if (targetUser.id === input.target_user_id && resolvedEmail && resolvedEmail !== input.target_user_email) {
            return { ok: false, status: 400, body: { error: 'target_user_id and target_user_email do not match the same user' } };
        }
    }

    // --- 2. תבנית ההתראה ---
    let template = null;
    if (input.template_type) {
        try {
            const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({ type: input.template_type });
            template = templates.length > 0 ? templates[0] : null;

            if (template) {
                const allowed = template.allowed_channels || ['push'];
                if (!allowed.includes('push')) sendPush = false;

                if (!link && template.dynamic_url_type && template.dynamic_url_type !== 'none') {
                    link = sanitizeLink(generateDynamicUrl(template.dynamic_url_type, {
                        event_id: input.related_event_id,
                        supplier_id: input.related_supplier_id,
                        user_role: targetUser?.role || targetUser?.user_type || 'client'
                    }));
                }
            }
        } catch (e) {
            console.warn('[Notification] template fetch failed');
        }
    }

    // העדפות משתמש - משפיעות על Push בלבד
    if (targetUser?.notification_preferences && input.template_type) {
        const pref = targetUser.notification_preferences[input.template_type];
        if (pref !== undefined) {
            const isEnabled = typeof pref === 'object' ? pref.enabled !== false : pref !== false;
            if (!isEnabled) sendPush = false;
        }
    }

    const userHasPushEnabled = targetUser?.push_enabled === true && !!targetUser?.onesignal_subscription_id;

    // --- 3. פתרון יעד WhatsApp (בצד השרת בלבד) ---
    let whatsappTargetPhone = '';
    let whatsappBlockedReason = '';
    if (allowWhatsApp) {
        const resolved = await resolveWhatsAppPhone(base44, targetUser, input, allowManualPhone);
        whatsappTargetPhone = resolved.phone;
        whatsappBlockedReason = resolved.reason;
    }

    // --- 4. רישום ההתראה הפנימית ---
    let notificationRecordId = null;
    const isVirtual = !!targetUserId && targetUserId.startsWith('virtual');

    try {
        if (targetUserId && !isVirtual) {
            const inAppNotification = await base44.asServiceRole.entities.InAppNotification.create({
                user_id: targetUserId,
                user_email: input.target_user_email || targetUser?.email,
                title: input.title,
                message: input.message,
                link: link || '',
                is_read: false,
                template_type: input.template_type || 'CUSTOM',
                related_event_id: input.related_event_id || '',
                related_event_service_id: input.related_event_service_id || '',
                related_supplier_id: input.related_supplier_id || '',
                push_sent: false,
                whatsapp_sent: false,
                whatsapp_message_id: '',
                reminder_count: 0,
                is_resolved: false
            });
            notificationRecordId = inAppNotification.id;
        }
    } catch (dbError) {
        console.warn('[Notification] DB save failed, continuing with delivery');
    }

    // --- 5. בדיקת השהיה (שבת / שעות שקט) ---
    let shouldDelay = false;
    let scheduledFor = null;

    if (isShabbat()) {
        shouldDelay = true;
        scheduledFor = getShabbatEndTime();
    } else if (input.check_quiet_hours) {
        const startHour = targetUser?.quiet_start_hour ?? 22;
        const endHour = targetUser?.quiet_end_hour ?? 8;
        if (isInQuietHours(startHour, endHour)) {
            shouldDelay = true;
            scheduledFor = getQuietHoursEndTime(endHour);
        }
    }

    if (shouldDelay && scheduledFor && notificationRecordId) {
        const pendingData = (allowWhatsApp && whatsappTargetPhone)
            ? JSON.stringify({ send_whatsapp: true, whatsapp_message: input.message, phone: whatsappTargetPhone })
            : JSON.stringify({});

        await base44.asServiceRole.entities.PendingPushNotification.create({
            user_id: targetUserId,
            user_email: input.target_user_email || targetUser?.email,
            title: input.title,
            message: input.message,
            link: link || '',
            scheduled_for: scheduledFor.toISOString(),
            template_type: input.template_type || 'CUSTOM',
            in_app_notification_id: notificationRecordId,
            is_sent: false,
            data: pendingData
        });

        await base44.asServiceRole.entities.InAppNotification.update(notificationRecordId, {
            push_scheduled_for: scheduledFor.toISOString()
        });

        const delayedBody = {
            success: true,
            notification_id: notificationRecordId,
            push: { sent: false, scheduled: true }
        };
        if (allowWhatsApp) {
            delayedBody.whatsapp = whatsappTargetPhone
                ? { sent: false, scheduled: true }
                : { sent: false, scheduled: false, reason: whatsappBlockedReason || 'No WhatsApp target' };
        }
        return { ok: true, status: 200, body: delayedBody };
    }

    // --- 6. Push מיידי ---
    let pushResult = { sent: false };

    if (sendPush && userHasPushEnabled && notificationRecordId) {
        try {
            const pushLink = link || '';
            const oneSignalPayload = {
                app_id: Deno.env.get('ONESIGNAL_APP_ID'),
                include_subscription_ids: [targetUser.onesignal_subscription_id],
                contents: { en: input.message, he: input.message },
                headings: { en: input.title, he: input.title },
                url: pushLink || undefined,
                data: { notification_id: notificationRecordId, link: pushLink }
            };

            const response = await fetch('https://onesignal.com/api/v1/notifications', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Deno.env.get('ONESIGNAL_API_KEY')}`
                },
                body: JSON.stringify(oneSignalPayload)
            });

            const result = await response.json();

            if (result.id && result.recipients > 0) {
                await base44.asServiceRole.entities.InAppNotification.update(notificationRecordId, { push_sent: true });
                pushResult = { sent: true, recipients: result.recipients, onesignal_id: result.id };
            } else {
                pushResult = { sent: false, error: 'No recipients' };
            }
        } catch (pushError) {
            console.error('[Notification] push send error');
            pushResult = { sent: false, error: 'Push send failed' };
        }
    } else if (sendPush && !userHasPushEnabled) {
        pushResult = { sent: false, reason: 'User disabled push' };
    }

    // --- 7. WhatsApp מיידי (מנהל מאומת בלבד) ---
    const body = {
        success: true,
        notification_id: notificationRecordId || 'virtual',
        push: pushResult
    };

    if (allowWhatsApp) {
        if (!whatsappTargetPhone) {
            body.whatsapp = { sent: false, scheduled: false, reason: whatsappBlockedReason || 'No WhatsApp target' };
        } else {
            try {
                const waResult = await sendWhatsAppText(whatsappTargetPhone, `*${input.title}*\n\n${input.message}`);
                body.whatsapp = { sent: true, scheduled: false, messageId: waResult.messageId || '' };
                if (notificationRecordId) {
                    await base44.asServiceRole.entities.InAppNotification.update(notificationRecordId, {
                        whatsapp_sent: true,
                        whatsapp_message_id: waResult.messageId || ''
                    });
                }
            } catch (waError) {
                console.error('[Notification] WhatsApp send failed');
                body.whatsapp = { sent: false, scheduled: false, reason: 'WhatsApp send failed' };
            }
        }
    }

    return { ok: true, status: 200, body };
}

/**
 * פתרון מספר הטלפון לשליחת WhatsApp בסדר: User, ספק תואם למייל, איש קשר באירוע תואם למייל,
 * ולבסוף target_phone ידני (מנהל בלבד).
 */
async function resolveWhatsAppPhone(base44, targetUser, input, allowManualPhone) {
    if (targetUser?.whatsapp_enabled === false) {
        return { phone: '', reason: 'User disabled WhatsApp' };
    }

    if (targetUser?.phone) return { phone: targetUser.phone, reason: '' };

    const email = input.target_user_email || String(targetUser?.email || '').toLowerCase().trim();

    if (email) {
        try {
            const suppliers = await base44.asServiceRole.entities.Supplier.list();
            const supplier = suppliers.find(s => Array.isArray(s.contact_emails)
                && s.contact_emails.some(e => String(e || '').toLowerCase().trim() === email));
            if (supplier) {
                if (supplier.whatsapp_enabled === false) {
                    return { phone: '', reason: 'Supplier disabled WhatsApp' };
                }
                if (supplier.phone) return { phone: supplier.phone, reason: '' };
            }
        } catch (e) {
            console.warn('[Notification] supplier phone lookup failed');
        }

        try {
            const events = input.related_event_id
                ? await base44.asServiceRole.entities.Event.filter({ id: input.related_event_id })
                : await base44.asServiceRole.entities.Event.list();
            for (const ev of events) {
                const contacts = collectEventContacts(ev);
                const match = contacts.find(c => String(c.email || '').toLowerCase().trim() === email && c.phone);
                if (match) return { phone: match.phone, reason: '' };
            }
        } catch (e) {
            console.warn('[Notification] event contact phone lookup failed');
        }
    }

    if (allowManualPhone && input.target_phone) {
        return { phone: input.target_phone, reason: '' };
    }

    return { phone: '', reason: 'No phone number found' };
}

function collectEventContacts(ev) {
    const list = [];
    if (Array.isArray(ev?.parents)) list.push(...ev.parents);
    if (ev?.organizer_contacts) {
        try {
            const parsed = typeof ev.organizer_contacts === 'string'
                ? JSON.parse(ev.organizer_contacts)
                : ev.organizer_contacts;
            if (Array.isArray(parsed)) list.push(...parsed);
        } catch (e) {}
    }
    return list.filter(c => c && typeof c === 'object');
}

function generateDynamicUrl(type, context) {
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
    return path ? `${PULSE_ORIGIN}${path}` : '';
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