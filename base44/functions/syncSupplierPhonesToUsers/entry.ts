import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { SYNC_ENTITIES, isValidEntityId, syncEntityRecordToUsers } from '../../shared/identitySync.ts';

/**
 * סנכרון טלפון ושם תצוגה מהישויות העסקיות אל המשתמשים.
 *
 * מאובטח: מנהל מאומת בלבד, ושני מסלולים מפורשים בלבד:
 *  1. מסלול אוטומציה - payload עם metadata של Supplier/Event; הרשומה נקראת מחדש לפי ID.
 *  2. מסלול ידני - { mode: 'full' } בלבד מפעיל סריקה מלאה.
 * אין fallback לסריקה מלאה, ואין אמון ב-data מהבקשה.
 * הכיוון הוא Entity -> User בלבד.
 */
const SYNC_OPTIONS = { overwritePhone: true, syncDisplayName: true };

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // אימות לפני קריאת body ולפני כל שימוש ב-asServiceRole.
        let user = null;
        try {
            user = await base44.auth.me();
        } catch (e) {
            user = null;
        }
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const payload = await req.json().catch(() => ({}));
        const serviceRole = base44.asServiceRole;
        const event = payload?.event;

        // --- מסלול אוטומציה ---
        if (event?.entity_name) {
            const entityName = String(event.entity_name || '');
            const eventType = String(event.type || '');

            if (!SYNC_ENTITIES.includes(entityName)) {
                return Response.json({ skipped: true, reason: 'Unsupported entity' });
            }
            if (eventType !== 'create' && eventType !== 'update') {
                return Response.json({ skipped: true, reason: 'Unsupported event type' });
            }
            if (!isValidEntityId(event.entity_id)) {
                return Response.json({ error: 'Invalid entity_id' }, { status: 400 });
            }

            let record = null;
            try {
                record = await serviceRole.entities[entityName].get(event.entity_id);
            } catch (e) {
                record = null;
            }
            if (!record) {
                return Response.json({ skipped: true, reason: 'Entity not found' }, { status: 404 });
            }

            const result = await syncEntityRecordToUsers(serviceRole, entityName, record, SYNC_OPTIONS);
            console.log(`[SyncPhones] incremental ${entityName}: ${result.updatesCount} updates, ${result.conflictsCount} conflicts`);

            return Response.json({
                success: true,
                mode: entityName === 'Supplier' ? 'incremental_supplier' : 'incremental_event',
                updates_count: result.updatesCount,
                updated_fields: result.updated_fields,
                conflicts_count: result.conflictsCount,
                errors_count: result.errorsCount
            });
        }

        // --- מסלול ידני מפורש בלבד ---
        if (payload?.mode !== 'full') {
            return Response.json({ error: "Explicit mode is required: { mode: 'full' } or an entity automation payload" }, { status: 400 });
        }

        const [suppliers, events] = await Promise.all([
            serviceRole.entities.Supplier.list(),
            serviceRole.entities.Event.list()
        ]);

        let updatesCount = 0;
        let conflictsCount = 0;
        let errorsCount = 0;
        const fieldsTouched = new Set();

        for (const supplier of suppliers) {
            const result = await syncEntityRecordToUsers(serviceRole, 'Supplier', supplier, SYNC_OPTIONS);
            updatesCount += result.updatesCount;
            conflictsCount += result.conflictsCount;
            errorsCount += result.errorsCount;
            result.updated_fields.forEach(f => fieldsTouched.add(f));
        }

        for (const eventRecord of events) {
            const result = await syncEntityRecordToUsers(serviceRole, 'Event', eventRecord, SYNC_OPTIONS);
            updatesCount += result.updatesCount;
            conflictsCount += result.conflictsCount;
            errorsCount += result.errorsCount;
            result.updated_fields.forEach(f => fieldsTouched.add(f));
        }

        console.log(`[SyncPhones] full sync: ${updatesCount} updates, ${conflictsCount} conflicts, ${errorsCount} errors`);

        return Response.json({
            success: true,
            mode: 'full',
            processed_suppliers: suppliers.length,
            processed_events: events.length,
            updates_count: updatesCount,
            updated_fields: [...fieldsTouched],
            conflicts_count: conflictsCount,
            errors_count: errorsCount
        });

    } catch (error) {
        console.error('[SyncPhones] failed');
        return Response.json({ error: 'Sync failed' }, { status: 500 });
    }
});