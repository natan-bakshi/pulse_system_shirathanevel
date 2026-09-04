// ולידציה וניקוי קלט עבור שכבת ההתראות.
// מודול פנימי בלבד - לא endpoint ציבורי.

export const PULSE_ORIGIN = 'https://pulse-system.base44.app';
export const PULSE_HOSTNAME = 'pulse-system.base44.app';

export const LIMITS = {
    title: 300,
    message: 4000,
    id: 64,
    email: 254,
    templateType: 100,
    phone: 20,
    fileName: 150,
    caption: 1000
};

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * מנקה טקסט מתווי בקרה וחותך לאורך מקסימלי.
 */
export function sanitizeText(value, maxLength) {
    if (value === undefined || value === null) return '';
    const cleaned = String(value).replace(CONTROL_CHARS, '').trim();
    return maxLength && cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/**
 * מנקה מזהה: תווי מזהה חוקיים בלבד, באורך סביר.
 */
export function sanitizeId(value, maxLength = LIMITS.id) {
    const cleaned = sanitizeText(value, maxLength);
    return /^[A-Za-z0-9_\-:.]*$/.test(cleaned) ? cleaned : '';
}

/**
 * נרמול מייל: אותיות קטנות, ללא רווחים, בדיקת מבנה בסיסית.
 */
export function normalizeEmail(value) {
    const cleaned = sanitizeText(value, LIMITS.email).toLowerCase();
    if (!cleaned) return '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : '';
}

/**
 * מאמת קישור ומחזיר קישור מוחלט ל-origin של Pulse בלבד.
 * - קישור יחסי מותר ומנורמל ל-origin הקבוע.
 * - נחסמים: protocol-relative, דומיינים חיצוניים, credentials ב-URL,
 *   backslashes, תווי בקרה וסכימות שאינן https.
 * מחזיר '' אם הקישור אינו תקין/מותר.
 */
export function sanitizeLink(value) {
    const raw = sanitizeText(value, 2000);
    if (!raw) return '';
    if (raw.includes('\\')) return '';
    if (raw.startsWith('//')) return '';
    if (/[\s]/.test(raw)) return '';

    let parsed;
    try {
        parsed = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
            ? new URL(raw)
            : new URL(raw.startsWith('/') ? raw : `/${raw}`, PULSE_ORIGIN);
    } catch (e) {
        return '';
    }

    if (parsed.protocol !== 'https:') return '';
    if (parsed.hostname !== PULSE_HOSTNAME) return '';
    if (parsed.username || parsed.password) return '';

    return `${PULSE_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * ולידציה מלאה של קלט יצירת התראה.
 * מחזיר { valid, error, value } - value מכיל שדות מנוקים בלבד.
 */
export function validateNotificationInput(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};

    const title = sanitizeText(input.title, LIMITS.title);
    const message = sanitizeText(input.message, LIMITS.message);

    if (!title || !message) {
        return { valid: false, error: 'title and message are required' };
    }

    const targetUserId = sanitizeId(input.target_user_id);
    const targetUserEmail = normalizeEmail(input.target_user_email);

    if (input.target_user_id && !targetUserId) {
        return { valid: false, error: 'invalid target_user_id' };
    }
    if (input.target_user_email && !targetUserEmail) {
        return { valid: false, error: 'invalid target_user_email' };
    }
    if (!targetUserId && !targetUserEmail) {
        return { valid: false, error: 'target_user_id or target_user_email is required' };
    }

    return {
        valid: true,
        value: {
            target_user_id: targetUserId,
            target_user_email: targetUserEmail,
            title,
            message,
            link: sanitizeLink(input.link),
            template_type: sanitizeText(input.template_type, LIMITS.templateType),
            related_event_id: sanitizeId(input.related_event_id),
            related_event_service_id: sanitizeId(input.related_event_service_id),
            related_supplier_id: sanitizeId(input.related_supplier_id),
            send_push: input.send_push !== false,
            send_whatsapp: input.send_whatsapp === true,
            check_quiet_hours: input.check_quiet_hours !== false,
            target_phone: sanitizeText(input.target_phone, LIMITS.phone)
        }
    };
}