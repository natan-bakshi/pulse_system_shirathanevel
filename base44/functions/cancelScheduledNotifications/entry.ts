import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * מוחק תזמוני התראות (PendingPushNotification) שטרם נשלחו, לפי הקשר.
 * נקרא בשני אופנים:
 *  1. כאוטומציית entity (Event/EventService/Supplier) על delete/update -
 *     מקבל payload עם { event, data, old_data } ומסיק מה למחוק.
 *  2. בקריאה מפורשת עם פרמטרים: { event_id, event_service_id, supplier_id }.
 *
 * עיקרון: במקום לבדוק תנאי בזמן שליחה - מוחקים את התזמון בעת ביטול/מחיקה.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const payload = await req.json().catch(() => ({}));
        const { event, data, old_data } = payload;

        // אוסף את פרמטרי הסינון - או מפורשות מהקריאה, או מהקשר האוטומציה
        let eventId = payload.event_id || null;
        let eventServiceId = payload.event_service_id || null;
        let supplierId = payload.supplier_id || null;

        // רשימת מחיקות לביצוע: כל פריט הוא אובייקט סינון על PendingPushNotification
        const deletionFilters = [];

        if (event?.entity_name && event?.entity_id) {
            // --- הקשר אוטומציה ---
            const entityName = event.entity_name;
            const entityId = event.entity_id;
            const eventType = event.type; // create / update / delete

            if (entityName === 'Event') {
                // מחיקת אירוע => מחק כל התזמונים של האירוע
                if (eventType === 'delete') {
                    deletionFilters.push({ related_event_id: entityId });
                } else if (eventType === 'update') {
                    const newStatus = data?.status;
                    const oldStatus = old_data?.status;
                    const statusChanged = newStatus !== oldStatus;

                    // מעבר ל-cancelled/completed/in_progress => האירוע כבר לא רלוונטי
                    // לתזכורות מחזור-חיים פעילות (אירוע, שיבוצים חסרים) => מחק את כל
                    // התזמונים של האירוע (תשלום מתוזמן אחרי האירוע, אבל אם בוטל - גם הוא לא רלוונטי).
                    if (statusChanged && ['cancelled', 'completed', 'in_progress'].includes(newStatus)) {
                        deletionFilters.push({ related_event_id: entityId });
                    }

                    // מעבר חזרה ל-'quote' (מ-confirmed וכו') => מחק תזכורות מחזור-חיים
                    // שתוזמנו בעת האישור (תזכורת אירוע, שיבוצים חסרים, תשלום).
                    // התזמון של הצעת המחיר עצמה (ADMIN_QUOTE_FOLLOWUP) ייווצר מחדש ע"י scheduleQuoteFollowup.
                    if (statusChanged && newStatus === 'quote') {
                        deletionFilters.push({ related_event_id: entityId, template_type: 'EVENT_REMINDER_FANOUT' });
                        deletionFilters.push({ related_event_id: entityId, template_type: 'ADMIN_MISSING_ASSIGNMENT' });
                        deletionFilters.push({ related_event_id: entityId, template_type: 'CLIENT_PAYMENT_REMINDER' });
                    }

                    // יציאה מסטטוס 'quote' (אושר/בוטל) => מחק את תזכורת מעקב ההצעה.
                    if (statusChanged && oldStatus === 'quote' && newStatus !== 'quote') {
                        deletionFilters.push({ related_event_id: entityId, template_type: 'ADMIN_QUOTE_FOLLOWUP' });
                    }
                }
            } else if (entityName === 'Supplier') {
                // מחיקת ספק => מחק כל התזמונים הקשורים לספק
                if (eventType === 'delete') {
                    deletionFilters.push({ related_supplier_id: entityId });
                }
            } else if (entityName === 'EventService') {
                // מחיקת שירות => מחק כל התזמונים של אותו EventService
                if (eventType === 'delete') {
                    deletionFilters.push({ related_event_service_id: entityId });
                } else if (eventType === 'update') {
                    // ביטול אישור שיבוץ: ספק שעבר מ-approved/confirmed ל-rejected/pending/cancelled
                    // => מחק את התזמונים של אותו ספק באותו שירות.
                    const changedSuppliers = getSuppliersThatLostApproval(old_data, data);
                    for (const sid of changedSuppliers) {
                        deletionFilters.push({
                            related_event_service_id: entityId,
                            related_supplier_id: sid
                        });
                    }
                }
            }
        } else {
            // --- קריאה מפורשת ---
            if (supplierId && eventServiceId) {
                deletionFilters.push({ related_event_service_id: eventServiceId, related_supplier_id: supplierId });
            } else if (eventServiceId) {
                deletionFilters.push({ related_event_service_id: eventServiceId });
            } else if (supplierId) {
                deletionFilters.push({ related_supplier_id: supplierId });
            } else if (eventId) {
                deletionFilters.push({ related_event_id: eventId });
            }
        }

        if (deletionFilters.length === 0) {
            return Response.json({ success: true, deleted: 0, message: 'No matching cancellation context' });
        }

        let deletedCount = 0;
        for (const filter of deletionFilters) {
            // מוחקים רק רשומות שטרם נשלחו
            const records = await base44.asServiceRole.entities.PendingPushNotification.filter({
                ...filter,
                is_sent: false
            });
            for (const rec of records) {
                try {
                    await base44.asServiceRole.entities.PendingPushNotification.delete(rec.id);
                    deletedCount++;
                } catch (e) {
                    console.warn(`[CancelScheduled] Failed to delete ${rec.id}:`, e.message);
                }
            }
        }

        console.log(`[CancelScheduled] Deleted ${deletedCount} scheduled notifications`);
        return Response.json({ success: true, deleted: deletedCount });

    } catch (error) {
        console.error('[CancelScheduled] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

/**
 * מחזיר רשימת supplier_ids שאיבדו אישור בין old_data ל-data:
 * עברו מ-approved/confirmed לסטטוס שאינו מאושר (rejected/pending/cancelled/הוסרו).
 */
function getSuppliersThatLostApproval(oldData, newData) {
    const result = [];
    if (!oldData) return result;

    let oldStatuses = {};
    let newStatuses = {};
    try { oldStatuses = JSON.parse(oldData.supplier_statuses || '{}'); } catch { oldStatuses = {}; }
    try { newStatuses = JSON.parse(newData?.supplier_statuses || '{}'); } catch { newStatuses = {}; }

    const APPROVED = ['approved', 'confirmed'];

    for (const [supplierId, oldStatus] of Object.entries(oldStatuses)) {
        if (!APPROVED.includes(oldStatus)) continue;
        const newStatus = newStatuses[supplierId];
        // אם כבר לא מאושר (כולל אם הוסר מהרשימה => undefined)
        if (!APPROVED.includes(newStatus)) {
            result.push(supplierId);
        }
    }

    return result;
}