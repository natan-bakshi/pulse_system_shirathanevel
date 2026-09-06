import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { recalculateEventStatus, readAll, parseAssignmentValue } from '../../shared/eventReadiness.ts';

export default Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Handle OPTIONS for CORS
        if (req.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
                },
            });
        }

        // Parse body
        let body;
        try {
            body = await req.json();
        } catch (e) {
            return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        
        const { eventId, serviceId, supplierId, requestedStatus } = body;
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }
        if (!eventId && !serviceId && !supplierId) {
            return Response.json({ error: 'Missing eventId, serviceId or supplierId' }, { status: 400 });
        }
        if (requestedStatus !== undefined) {
            if (!eventId || !['quote', 'confirmed', 'completed', 'cancelled'].includes(requestedStatus)) {
                return Response.json({ error: 'Ready status is calculated from assignments' }, { status: 400 });
            }
            const current = await base44.entities.Event.get(eventId);
            if (current.status !== requestedStatus) {
                await base44.entities.Event.update(eventId, { status: requestedStatus });
            }
        }
        const eventIds = new Set(eventId ? [eventId] : []);
        if (serviceId || supplierId) {
            const rows = await readAll(base44.entities.EventService, serviceId ? { service_id: serviceId } : {});
            for (const row of rows) {
                const ids = parseAssignmentValue(row.supplier_ids, []);
                if ((serviceId && row.min_suppliers == null) || (supplierId && Array.isArray(ids) && ids.includes(supplierId))) {
                    if (row.event_id) eventIds.add(row.event_id);
                }
            }
        }
        const results = [];
        for (const id of eventIds) {
            const result = await recalculateEventStatus(base44, id);
            results.push({ eventId: id, newStatus: result.newStatus, statusChanged: result.statusChanged });
        }
        return Response.json({ success: true, ...(eventId ? results[0] : {}), results });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});
