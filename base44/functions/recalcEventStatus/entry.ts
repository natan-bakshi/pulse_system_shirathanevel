import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * recalcEventStatus
 * ----------------------------------------------------------------------------
 * מחשב מחדש את סטטוס האירוע (confirmed <-> in_progress) על בסיס מספר הספקים
 * המאושרים (confirmed) מול המינימום הנדרש לכל שירות.
 *
 * זוהי בדיוק אותה לוגיקה של checkEventStatus (שנקרא ידנית מהפרונט), אך מופעלת
 * אוטומטית כטריגר entity על EventService (update/delete) ועל Supplier (delete).
 *
 * כך, גם כשספק מבטל אישור, נמחק, או שירות נמחק - הסטטוס "תפור" (in_progress)
 * נבדק מחדש וחוזר ל-'confirmed' אם כבר אין מספיק ספקים מאושרים, ולהפך.
 *
 * הפונקציה פועלת רק על אירועים בסטטוס 'confirmed' או 'in_progress' (כמו
 * checkEventStatus). אירועים ב-quote/completed/cancelled אינם זכאים למעבר.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json().catch(() => ({}));
        const { event, data, old_data } = payload;

        if (event?.entity_name === 'EventService' && event?.type === 'update' && data && old_data) {
            const relevantFields = ['event_id', 'service_id', 'supplier_ids', 'supplier_statuses', 'min_suppliers'];
            const hasRelevantChange = relevantFields.some(field =>
                JSON.stringify(data?.[field] ?? null) !== JSON.stringify(old_data?.[field] ?? null)
            );
            if (!hasRelevantChange) {
                return Response.json({ success: true, skipped: true, reason: 'No status-relevant EventService change' });
            }
        }

        // איסוף רשימת מזהי אירועים לחישוב מחדש
        const eventIds = new Set();

        if (event?.entity_name === 'EventService') {
            // טריגר על EventService (update/delete): מזהה האירוע על הרשומה
            const evId = data?.event_id || old_data?.event_id;
            if (evId) eventIds.add(evId);
        } else if (event?.entity_name === 'Supplier' && event?.type === 'delete') {
            // מחיקת ספק: מאתרים את כל ה-EventServices שבהם הספק שובץ
            const supplierId = event.entity_id;
            if (supplierId) {
                let relevantEventServices = [];
                try {
                    relevantEventServices = await base44.asServiceRole.entities.EventService.filter({
                        supplier_ids: { "$like": `%${supplierId}%` }
                    });
                } catch {
                    relevantEventServices = await base44.asServiceRole.entities.EventService.list();
                }
                for (const es of relevantEventServices) {
                    if (!es.supplier_ids) continue;
                    let ids = [];
                    try { ids = JSON.parse(es.supplier_ids); } catch { continue; }
                    if (Array.isArray(ids) && ids.includes(supplierId) && es.event_id) {
                        eventIds.add(es.event_id);
                    }
                }
            }
        } else if (payload.eventId) {
            // קריאה ישירה
            eventIds.add(payload.eventId);
        }

        if (eventIds.size === 0) {
            return Response.json({ success: true, message: 'No event to recalc' });
        }

        const allServicesDefinitions = await base44.asServiceRole.entities.Service.list();
        const servicesMap = new Map(allServicesDefinitions.map(s => [s.id, s]));

        const updates = [];

        for (const eventId of eventIds) {
            let eventData = null;
            try {
                eventData = await base44.asServiceRole.entities.Event.get(eventId);
            } catch { continue; }
            if (!eventData) continue;

            // זכאות: רק confirmed <-> in_progress (כמו checkEventStatus)
            if (['quote', 'completed', 'cancelled'].includes(eventData.status)) {
                continue;
            }

            const eventServices = await base44.asServiceRole.entities.EventService.filter({ event_id: eventId });

            let allServicesSatisfied = true;

            for (const es of eventServices) {
                const serviceDef = servicesMap.get(es.service_id);
                let minRequired = 0;
                if (es.min_suppliers !== undefined && es.min_suppliers !== null) {
                    minRequired = es.min_suppliers;
                } else if (serviceDef && serviceDef.default_min_suppliers !== undefined) {
                    minRequired = serviceDef.default_min_suppliers;
                } else {
                    minRequired = 0;
                }

                if (minRequired === 0) continue;

                let supplierIds = [];
                try { supplierIds = JSON.parse(es.supplier_ids || '[]'); } catch { supplierIds = []; }

                let supplierStatuses = {};
                try { supplierStatuses = JSON.parse(es.supplier_statuses || '{}'); } catch { supplierStatuses = {}; }

                // בדיקה: מספר הספקים המאושרים (confirmed) מול המינימום הנדרש
                const confirmedCount = supplierIds.filter(id => supplierStatuses[id] === 'confirmed').length;

                if (confirmedCount < minRequired) {
                    allServicesSatisfied = false;
                    break;
                }
            }

            let newStatus = eventData.status;
            let statusChanged = false;

            if (allServicesSatisfied) {
                if (eventData.status === 'confirmed') {
                    newStatus = 'in_progress';
                    statusChanged = true;
                }
            } else {
                if (eventData.status === 'in_progress') {
                    newStatus = 'confirmed';
                    statusChanged = true;
                }
            }

            if (statusChanged) {
                await base44.asServiceRole.entities.Event.update(eventId, { status: newStatus });
                updates.push({ eventId, newStatus });
            }
        }

        return Response.json({ success: true, updates });

    } catch (error) {
        console.error('[recalcEventStatus] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});