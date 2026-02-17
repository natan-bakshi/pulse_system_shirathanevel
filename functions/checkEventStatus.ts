import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
        
        const { eventId } = body;
        if (!eventId) {
            return Response.json({ error: 'Missing eventId' }, { status: 400 });
        }

        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Fetch event services
        const eventServices = await base44.entities.EventService.filter({ event_id: eventId });
        
        // Fetch event to get current status
        const event = await base44.entities.Event.get(eventId);
        if (!event) {
            return Response.json({ error: 'Event not found' }, { status: 404 });
        }

        // Skip if status is quote or completed or cancelled
        // Logic: confirmed <-> in_progress
        if (['quote', 'completed', 'cancelled'].includes(event.status)) {
             return Response.json({ success: true, statusChanged: false, message: 'Status not eligible for auto-update' });
        }

        // Fetch all services to get defaults
        const allServicesDefinitions = await base44.entities.Service.list();
        const servicesMap = new Map(allServicesDefinitions.map(s => [s.id, s]));

        let allServicesSatisfied = true;

        for (const es of eventServices) {
            const serviceDef = servicesMap.get(es.service_id);
            // Determine required count
            let minRequired = 0; // Default to 0
            if (es.min_suppliers !== undefined && es.min_suppliers !== null) {
                minRequired = es.min_suppliers;
            } else if (serviceDef && serviceDef.default_min_suppliers !== undefined) {
                minRequired = serviceDef.default_min_suppliers;
            } else {
                minRequired = 0; // Default to 0 as requested
            }
            
            if (minRequired === 0) continue; // No suppliers required

            // Check assignments
            let supplierIds = [];
            try {
                supplierIds = JSON.parse(es.supplier_ids || '[]');
            } catch {
                supplierIds = [];
            }

            let supplierStatuses = {};
            try {
                supplierStatuses = JSON.parse(es.supplier_statuses || '{}');
            } catch {
                supplierStatuses = {};
            }

            // 1. Check if enough suppliers are assigned
            if (supplierIds.length < minRequired) {
                allServicesSatisfied = false;
                break;
            }

            // 2. Check if all assigned suppliers are confirmed
            const allAssignedConfirmed = supplierIds.every(id => supplierStatuses[id] === 'confirmed');
            
            if (!allAssignedConfirmed) {
                allServicesSatisfied = false;
                break;
            }
        }

        let newStatus = event.status;
        let statusChanged = false;

        if (allServicesSatisfied) {
            if (event.status === 'confirmed') {
                newStatus = 'in_progress';
                statusChanged = true;
            }
        } else {
            if (event.status === 'in_progress') {
                newStatus = 'confirmed';
                statusChanged = true;
            }
        }

        if (statusChanged) {
            await base44.entities.Event.update(eventId, { status: newStatus });
        }

        return Response.json({ success: true, statusChanged, newStatus });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});