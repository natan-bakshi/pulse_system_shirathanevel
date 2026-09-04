import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { SYNC_ENTITIES, isValidEntityId, syncEntityRecordToUsers } from '../../shared/identitySync.ts';

/**
 * סנכרון שינוי בישות עסקית (Supplier/Event) אל המשתמש התואם.
 *
 * מאובטח: מנהל מאומת בלבד. מהאירוע נלקח metadata מצומצם בלבד
 * (entity_name, entity_id, type), והרשומה האמיתית נקראת מחדש מהמערכת.
 * payload.data / old_data / changed_fields אינם מקור לערכים שנכתבים ל-User.
 */
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
        const event = payload?.event;
        const entityName = String(event?.entity_name || '');
        const entityId = event?.entity_id;
        const eventType = String(event?.type || '');

        if (!SYNC_ENTITIES.includes(entityName)) {
            return Response.json({ skipped: true, reason: 'Unsupported entity' });
        }
        if (eventType !== 'create' && eventType !== 'update') {
            return Response.json({ skipped: true, reason: 'Unsupported event type' });
        }
        if (!isValidEntityId(entityId)) {
            return Response.json({ error: 'Invalid entity_id' }, { status: 400 });
        }

        const serviceRole = base44.asServiceRole;

        // קריאה מחדש של הרשומה האמיתית - מקור האמת היחיד.
        let record = null;
        try {
            record = await serviceRole.entities[entityName].get(entityId);
        } catch (e) {
            record = null;
        }
        if (!record) {
            return Response.json({ skipped: true, reason: 'Entity not found' }, { status: 404 });
        }

        const result = await syncEntityRecordToUsers(serviceRole, entityName, record, {
            overwritePhone: false,
            syncDisplayName: false
        });

        console.log(`[SyncEntityToUser] ${entityName} ${eventType}: ${result.updatesCount} updates, ${result.conflictsCount} conflicts`);

        return Response.json({
            success: true,
            entity: entityName,
            updates_count: result.updatesCount,
            updated_fields: result.updated_fields,
            conflicts_count: result.conflictsCount,
            errors_count: result.errorsCount
        });

    } catch (error) {
        console.error('[SyncEntityToUser] failed');
        return Response.json({ error: 'Sync failed' }, { status: 500 });
    }
});