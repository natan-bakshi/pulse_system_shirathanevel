// מודול סנכרון זהויות משותף - backend פנימי בלבד (לא endpoint ציבורי).
// מרכז את כללי ההתאמה העסקית (Supplier/Event -> User) ואת allowlist השדות,
// כדי שלא יהיו שלוש גרסאות שונות של אותם כללים.
// אין לרשום ללוגים ואין להחזיר בתגובה PII (מיילים, טלפונים, שמות, מזהים).

// רשימת השדות היחידה שפונקציות הסנכרון רשאיות לעדכן ב-User.
export const ALLOWED_USER_FIELDS = ['phone', 'display_name', 'full_name', 'user_type'];

export const SYNC_ENTITIES = ['Supplier', 'Event'];

export function normalizeEmail(value) {
    return String(value || '').toLowerCase().trim();
}

// מזהה תקין: תווי מזהה חוקיים בלבד באורך סביר.
export function isValidEntityId(value) {
    const id = String(value || '').trim();
    return id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_\-:.]+$/.test(id);
}

/**
 * בוחר ערך יחיד מתוך מועמדים. אם קיימים כמה ערכים סותרים - מדווח conflict
 * ומחזיר ערך ריק (דילוג על השדה העמום, ולא בחירה לפי סדר הרשומות).
 */
export function pickUnique(values) {
    const unique = new Set((values || []).map(v => String(v || '').trim()).filter(Boolean));
    if (unique.size === 0) return { value: '', conflict: false };
    if (unique.size > 1) return { value: '', conflict: true };
    return { value: [...unique][0], conflict: false };
}

/**
 * אוסף אנשי קשר מאירוע (parents + organizer_contacts).
 */
export function collectEventContacts(eventRecord) {
    const list = [];
    if (Array.isArray(eventRecord?.parents)) list.push(...eventRecord.parents);
    if (eventRecord?.organizer_contacts) {
        try {
            const parsed = typeof eventRecord.organizer_contacts === 'string'
                ? JSON.parse(eventRecord.organizer_contacts)
                : eventRecord.organizer_contacts;
            if (Array.isArray(parsed)) list.push(...parsed);
        } catch (e) { /* מבנה לא תקין - מתעלמים */ }
    }
    return list.filter(c => c && typeof c === 'object');
}

function emptyCandidate(type = '') {
    return { type, phones: [], displayNames: [], fullNames: [] };
}

/**
 * צובר מועמדים לתוך מפה משותפת לפי מייל מנורמל.
 * ספק מקבל עדיפות מוחלטת: ברגע שקיימת התאמת Supplier למייל,
 * נתוני אנשי קשר מאירועים לא נכנסים ולא דורסים.
 * התוצאה אינה תלויה בסדר הרשומות.
 */
export function accumulateCandidate(map, email, data) {
    const key = normalizeEmail(email);
    if (!key) return;

    if (!map.has(key)) map.set(key, emptyCandidate(data.type));
    const entry = map.get(key);

    if (data.type === 'supplier' && entry.type !== 'supplier') {
        // מעבר לעדיפות ספק: מאפסים נתוני לקוח שנאספו קודם.
        entry.type = 'supplier';
        entry.phones = [];
        entry.displayNames = [];
        entry.fullNames = [];
    } else if (data.type === 'client' && entry.type === 'supplier') {
        // ספק כבר תפס את המייל - נתוני אירוע לא נאספים בכלל.
        return;
    }

    if (data.phone) entry.phones.push(data.phone);
    if (data.displayName) entry.displayNames.push(data.displayName);
    if (data.fullName) entry.fullNames.push(data.fullName);
}

/**
 * צובר את כל המועמדים מרשומת Supplier/Event אמיתית אל מפה משותפת.
 */
export function accumulateFromEntity(map, entityName, record) {
    if (entityName === 'Supplier') {
        const emails = Array.isArray(record?.contact_emails) ? record.contact_emails : [];
        const name = record?.contact_person || record?.supplier_name || '';
        for (const email of emails) {
            accumulateCandidate(map, email, {
                type: 'supplier',
                phone: record?.phone,
                displayName: name,
                fullName: record?.contact_person || ''
            });
        }
    } else if (entityName === 'Event') {
        for (const contact of collectEventContacts(record)) {
            accumulateCandidate(map, contact.email, {
                type: 'client',
                phone: contact.phone,
                displayName: `${contact.name || ''} ${record?.family_name || ''}`.trim(),
                fullName: contact.name || ''
            });
        }
    }
    return map;
}

/** גרסה לרשומה בודדת (משמשת את המסלול האינקרמנטלי). */
export function buildCandidatesFromEntity(entityName, record) {
    return accumulateFromEntity(new Map(), entityName, record);
}

/**
 * מחשב את העדכונים המותרים עבור משתמש קיים.
 * options.overwritePhone - true מאפשר עדכון טלפון קיים לערך העסקי (מסלול סנכרון טלפונים).
 * options.syncDisplayName - true מסנכרן display_name.
 * מחזיר { updates, conflicts } כאשר updates מכיל שדות מ-ALLOWED_USER_FIELDS בלבד.
 */
export function buildUserUpdates(user, candidate, options = {}) {
    const updates = {};
    let conflicts = 0;

    const phonePick = pickUnique(candidate?.phones);
    const displayPick = pickUnique(candidate?.displayNames);
    const fullNamePick = pickUnique(candidate?.fullNames);
    if (phonePick.conflict) conflicts++;
    if (displayPick.conflict) conflicts++;
    if (fullNamePick.conflict) conflicts++;

    // user_type: מנהל אינו מסווג מחדש; ספק אינו מורד ללקוח.
    if (user?.role !== 'admin' && candidate?.type) {
        if (candidate.type === 'supplier' && user?.user_type !== 'supplier') {
            updates.user_type = 'supplier';
        } else if (candidate.type === 'client' && user?.user_type !== 'client' && user?.user_type !== 'supplier' && user?.user_type !== 'admin') {
            updates.user_type = 'client';
        }
    }

    if (phonePick.value) {
        if (!user?.phone) updates.phone = phonePick.value;
        else if (options.overwritePhone === true && user.phone !== phonePick.value) updates.phone = phonePick.value;
    }

    if (options.syncDisplayName === true && displayPick.value && user?.display_name !== displayPick.value) {
        updates.display_name = displayPick.value;
    }

    // full_name מתעדכן רק כשהוא חסר.
    if (!user?.full_name && fullNamePick.value) {
        updates.full_name = fullNamePick.value;
    }

    // הגנה נוספת: allowlist קשיח.
    for (const key of Object.keys(updates)) {
        if (!ALLOWED_USER_FIELDS.includes(key)) delete updates[key];
    }

    return { updates, conflicts };
}

/**
 * מסלול self: מאתר התאמה עסקית למייל של המשתמש המאומת.
 * ספק מקבל עדיפות על לקוח. המקור הוא Supplier/Event בלבד - אין כתיבה חזרה.
 */
export async function resolveSelfBusinessMatch(serviceRole, email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return emptyCandidate();

    const map = new Map();

    const suppliers = await serviceRole.entities.Supplier.list();
    const matchedSuppliers = suppliers.filter(s => Array.isArray(s.contact_emails)
        && s.contact_emails.some(e => normalizeEmail(e) === normalized));

    if (matchedSuppliers.length > 0) {
        for (const supplier of matchedSuppliers) accumulateFromEntity(map, 'Supplier', supplier);
        return map.get(normalized) || emptyCandidate('supplier');
    }

    const events = await serviceRole.entities.Event.filter({ status: { $ne: 'cancelled' } });
    for (const eventRecord of events) accumulateFromEntity(map, 'Event', eventRecord);
    return map.get(normalized) || emptyCandidate();
}

/**
 * כותב מפת מועמדים מאוגדת אל המשתמשים התואמים.
 * כל מייל מעובד פעם אחת בלבד, והפעולה idempotent (אין עדכון כשהערכים זהים).
 */
export async function applyCandidatesToUsers(serviceRole, candidateMap, options = {}) {
    let updatesCount = 0;
    let conflictsCount = 0;
    let errorsCount = 0;
    const fieldsTouched = new Set();

    for (const [email, candidate] of candidateMap) {
        try {
            const users = await serviceRole.entities.User.filter({ email });
            for (const user of users) {
                const { updates, conflicts } = buildUserUpdates(user, candidate, options);
                conflictsCount += conflicts;
                if (Object.keys(updates).length === 0) continue;
                await serviceRole.entities.User.update(user.id, updates);
                Object.keys(updates).forEach(f => fieldsTouched.add(f));
                updatesCount++;
            }
        } catch (e) {
            errorsCount++;
            console.error('[IdentitySync] user update failed for one match');
        }
    }

    return { updatesCount, conflictsCount, errorsCount, updated_fields: [...fieldsTouched] };
}

/**
 * מסלול אינקרמנטלי: מסנכרן רשומה בודדת אמיתית.
 * עדכון Event אינו מורשה לדרוס משתמש שהמייל שלו משויך לספק -
 * לכן מיילים שספק תופס מסוננים לפני הכתיבה.
 */
export async function syncEntityRecordToUsers(serviceRole, entityName, record, options = {}) {
    const candidates = buildCandidatesFromEntity(entityName, record);

    if (entityName === 'Event' && candidates.size > 0) {
        const supplierEmails = await loadSupplierEmailSet(serviceRole);
        for (const email of [...candidates.keys()]) {
            if (supplierEmails.has(email)) candidates.delete(email);
        }
    }

    return await applyCandidatesToUsers(serviceRole, candidates, options);
}

/** אוסף את כל המיילים שמשויכים לספקים (לצורך עדיפות ספק). */
export async function loadSupplierEmailSet(serviceRole) {
    const suppliers = await serviceRole.entities.Supplier.list();
    const set = new Set();
    for (const supplier of suppliers) {
        const emails = Array.isArray(supplier.contact_emails) ? supplier.contact_emails : [];
        for (const email of emails) {
            const normalized = normalizeEmail(email);
            if (normalized) set.add(normalized);
        }
    }
    return set;
}