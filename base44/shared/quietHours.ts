// מודול זמן משותף - backend פנימי בלבד.
// מרכז את חישוב שעות השקט והשבת עבור יוצר ההתראות (notificationCore)
// ועבור המעבד המתוזמן (processScheduledPushNotifications), כדי שלא תהיה
// לוגיקת זמן כפולה ולא תלות באזור הזמן של השרת.
// כל החישובים נעשים לפי שעון ירושלים, כולל שעון קיץ.
// כל הפונקציות טהורות ומקבלות `now` להזרקה בבדיקות.

export const TIMEZONE = 'Asia/Jerusalem';
export const DEFAULT_QUIET_START = '22:00';
export const DEFAULT_QUIET_END = '08:00';

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** מפרסר "HH:mm". ערך חסר/לא תקין -> ברירת המחדל. */
export function parseHHmm(value, fallback) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
    if (match) {
        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return { hour, minute, minutes: hour * 60 + minute };
        }
    }
    const fb = /^(\d{1,2}):(\d{2})$/.exec(String(fallback));
    const fbHour = fb ? parseInt(fb[1], 10) : 0;
    const fbMinute = fb ? parseInt(fb[2], 10) : 0;
    return { hour: fbHour, minute: fbMinute, minutes: fbHour * 60 + fbMinute };
}

/** מחזיר את חלקי הזמן בירושלים (תאריך, שעה, יום בשבוע). */
export function getJerusalemParts(now = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = {};
    for (const part of formatter.formatToParts(now)) parts[part.type] = part.value;
    const hour = parseInt(parts.hour, 10) % 24; // hourCycle h23 guard
    return {
        weekday: parts.weekday,
        weekdayIndex: WEEKDAY_INDEX[parts.weekday] ?? 0,
        year: parseInt(parts.year, 10),
        month: parseInt(parts.month, 10),
        day: parseInt(parts.day, 10),
        hour,
        minute: parseInt(parts.minute, 10),
        second: parseInt(parts.second, 10),
        minutes: hour * 60 + parseInt(parts.minute, 10)
    };
}

/** מפרש שעון-קיר ירושלמי (כולל שעון קיץ) ומחזיר Date אמיתי ב-UTC. */
export function fromJerusalemWallClock(year, month, day, hour, minute) {
    const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
    // חישוב ההיסט בפועל לאותו רגע, ואז תיקון שני למעברי שעון קיץ.
    let offsetMinutes = jerusalemOffsetMinutes(new Date(wall));
    let timestamp = wall - offsetMinutes * 60000;
    offsetMinutes = jerusalemOffsetMinutes(new Date(timestamp));
    timestamp = wall - offsetMinutes * 60000;
    return new Date(timestamp);
}

function jerusalemOffsetMinutes(date) {
    const p = getJerusalemParts(date);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - date.getTime()) / 60000);
}

/** שבת: שישי מ-16:00 עד שבת 20:00 (שעון ירושלים). */
export function isShabbat(now = new Date()) {
    const p = getJerusalemParts(now);
    if (p.weekday === 'Fri' && p.hour >= 16) return true;
    if (p.weekday === 'Sat' && p.hour < 20) return true;
    return false;
}

/** מועד יציאת השבת הקרוב: שבת 20:00 שעון ירושלים. */
export function getShabbatEndTime(now = new Date()) {
    const p = getJerusalemParts(now);
    let daysToAdd = 0;
    if (p.weekday === 'Fri') daysToAdd = 1;
    else if (p.weekday !== 'Sat') daysToAdd = (6 - p.weekdayIndex + 7) % 7;
    // הזזת יום נעשית על התאריך הירושלמי עצמו (לא setHours מקומי).
    const base = Date.UTC(p.year, p.month - 1, p.day + daysToAdd, 12, 0, 0);
    const target = new Date(base);
    return fromJerusalemWallClock(
        target.getUTCFullYear(),
        target.getUTCMonth() + 1,
        target.getUTCDate(),
        20,
        0
    );
}

/** האם כרגע בתוך שעות השקט (תומך במעבר חצות). */
export function isInQuietHours(startValue, endValue, now = new Date()) {
    const start = parseHHmm(startValue, DEFAULT_QUIET_START);
    const end = parseHHmm(endValue, DEFAULT_QUIET_END);
    if (start.minutes === end.minutes) return false;
    const current = getJerusalemParts(now).minutes;
    if (start.minutes > end.minutes) {
        // חוצה חצות, לדוגמה 22:00-08:00
        return current >= start.minutes || current < end.minutes;
    }
    return current >= start.minutes && current < end.minutes;
}

/** מועד סיום שעות השקט הקרוב, לפי שעון ירושלים. */
export function getQuietHoursEndTime(endValue, now = new Date()) {
    const end = parseHHmm(endValue, DEFAULT_QUIET_END);
    const p = getJerusalemParts(now);
    let dayOffset = 0;
    if (p.minutes >= end.minutes) dayOffset = 1;
    const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset, 12, 0, 0));
    return fromJerusalemWallClock(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth() + 1,
        shifted.getUTCDate(),
        end.hour,
        end.minute
    );
}

/**
 * מחליט אם להשהות שליחה, לפי העדפות המשתמש בסכמה:
 * quiet_hours_start / quiet_hours_end / quiet_hours_enabled / respect_shabbat.
 * ליעד וירטואלי (user חסר) נשמרת ברירת המחדל השמרנית: שבת ושעות שקט חלות.
 */
export function resolveNotificationDelay(user, options = {}, now = new Date()) {
    const respectShabbat = user?.respect_shabbat !== false;
    const quietEnabled = user?.quiet_hours_enabled !== false;
    const checkQuietHours = options.checkQuietHours !== false;

    if (respectShabbat && isShabbat(now)) {
        return { shouldDelay: true, scheduledFor: getShabbatEndTime(now), reason: 'shabbat' };
    }

    if (checkQuietHours && quietEnabled
        && isInQuietHours(user?.quiet_hours_start, user?.quiet_hours_end, now)) {
        return {
            shouldDelay: true,
            scheduledFor: getQuietHoursEndTime(user?.quiet_hours_end, now),
            reason: 'quiet_hours'
        };
    }

    return { shouldDelay: false, scheduledFor: null, reason: '' };
}