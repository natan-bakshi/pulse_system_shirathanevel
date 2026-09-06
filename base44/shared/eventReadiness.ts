// The assignment rule is shared by status updates and the missing-assignment alert.
export function parseAssignmentValue(value, fallback) {
    try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); }
    catch { return fallback; }
}

export function getServiceReadiness(row, definition, validSupplierIds) {
    const rawMinimum = row.min_suppliers ?? definition?.default_min_suppliers ?? 0;
    const minimum = Math.max(0, Math.ceil(Number(rawMinimum) || 0));
    const parsedIds = parseAssignmentValue(row.supplier_ids, []);
    const statuses = parseAssignmentValue(row.supplier_statuses, {}) || {};
    const ids = [...new Set(Array.isArray(parsedIds) ? parsedIds : [])]
        .filter(id => typeof id === 'string' && id && (!validSupplierIds || validSupplierIds.has(id)));
    const assigned = ids.filter(id => !['rejected', 'cancelled'].includes(statuses[id])).length;
    const confirmed = ids.filter(id => statuses[id] === 'confirmed').length;
    return {
        eventServiceId: row.id,
        serviceName: row.service_name || definition?.service_name || 'שירות',
        minimum, assigned, confirmed,
        missingAssignments: Math.max(0, minimum - assigned),
        missingConfirmations: Math.max(0, minimum - confirmed)
    };
}

export function calculateEventReadiness(event, rows, definitions, suppliers) {
    const definitionsById = new Map(definitions.map(service => [service.id, service]));
    const validSupplierIds = new Set(suppliers.map(supplier => supplier.id));
    const services = rows
        .filter(row => row.event_id === event.id && !row.is_external && !row.is_package_main_item)
        .map(row => getServiceReadiness(row, definitionsById.get(row.service_id), validSupplierIds));
    const ready = services.every(service => service.missingAssignments === 0 && service.missingConfirmations === 0);
    const eligible = ['confirmed', 'in_progress'].includes(event.status);
    return { eventId: event.id, newStatus: eligible ? (ready ? 'in_progress' : 'confirmed') : event.status,
        ready: eligible && ready, services };
}

// Explicit pagination prevents an implicit SDK page size from hiding a required service.
export async function readAll(entity, query = {}) {
    const rows = [];
    for (let skip = 0; ; skip += 500) {
        const page = await entity.filter(query, 'id', 500, skip);
        rows.push(...page);
        if (page.length < 500) return rows;
    }
}

export async function loadEventReadiness(client, eventId) {
    const event = await client.entities.Event.get(eventId);
    if (!event) throw new Error('Event not found');
    if (!['confirmed', 'in_progress'].includes(event.status)) {
        return { event, eventId, newStatus: event.status, ready: false, services: [] };
    }
    const [rows, definitions, suppliers] = await Promise.all([
        readAll(client.entities.EventService, { event_id: eventId }),
        readAll(client.entities.Service), readAll(client.entities.Supplier)
    ]);
    return { event, ...calculateEventReadiness(event, rows, definitions, suppliers) };
}

export async function recalculateEventStatus(client, eventId) {
    // Compare-and-set prevents a concurrent cancellation/completion from being overwritten.
    let statusChanged = false;
    for (let attempt = 0; attempt < 4; attempt++) {
        const result = await loadEventReadiness(client, eventId);
        if (result.event.status === result.newStatus) return { ...result, statusChanged };
        const saved = await client.entities.Event.updateMany(
            { id: eventId, status: result.event.status, updated_date: result.event.updated_date },
            { $set: { status: result.newStatus } }
        );
        if (saved.updated === 1) statusChanged = true;
        // After a transition, re-read: an opposite supplier reply may have completed
        // during the write, without needing to change the previous event status itself.
    }
    throw new Error('Event changed while calculating status; please retry saving');
}
