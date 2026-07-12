import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * Syncs User Identity (Phone & Display Name) from Suppliers and Events.
 * Logic: Matches Users by Email. Updates phone and display_name.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json().catch(() => ({}));
        const { event, data, old_data } = payload;
        const oldData = old_data || payload.olddata;
        const updates = [];
        const errors = [];

        const normalizeEmail = (email) => String(email || '').toLowerCase().trim();
        const inferChangedFields = (current, previous) => {
            if (!current || !previous) return [];
            const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
            return [...keys].filter(key => JSON.stringify(current[key] ?? null) !== JSON.stringify(previous[key] ?? null));
        };

        const updateUsersByEmail = async (email, newPhone, newName, source) => {
            const normalizedEmail = normalizeEmail(email);
            if (!normalizedEmail) return;
            const matchedUsers = await base44.asServiceRole.entities.User.filter({ email: normalizedEmail });
            for (const user of matchedUsers) {
                try {
                    const updatesToApply = {};
                    if (newPhone && user.phone !== newPhone) updatesToApply.phone = newPhone;
                    if (newName && user.display_name !== newName) updatesToApply.display_name = newName;

                    if (Object.keys(updatesToApply).length > 0) {
                        await base44.asServiceRole.entities.User.update(user.id, updatesToApply);
                        updates.push({ email: user.email, source, changes: updatesToApply });
                    }
                } catch (err) {
                    errors.push({ email: user.email || normalizedEmail, error: err.message });
                }
            }
        };

        if (event?.entity_name && data) {
            const changedFields = Array.isArray(payload.changed_fields) ? payload.changed_fields : inferChangedFields(data, oldData);
            if (event.type === 'update' && changedFields.length > 0) {
                const relevantFields = event.entity_name === 'Supplier'
                    ? ['contact_emails', 'phone', 'contact_person', 'supplier_name']
                    : ['parents', 'family_name'];
                const hasRelevantChange = changedFields.some(field => relevantFields.includes(field));
                if (!hasRelevantChange) {
                    return Response.json({ success: true, skipped: true, reason: 'No identity-relevant change' });
                }
            }

            if (event.entity_name === 'Supplier') {
                const emails = Array.isArray(data.contact_emails) ? data.contact_emails : [];
                const supplierName = data.contact_person || data.supplier_name || '';
                for (const email of emails) {
                    await updateUsersByEmail(email, data.phone, supplierName, 'Supplier');
                }
                return Response.json({ success: true, mode: 'incremental_supplier', updates_count: updates.length, updates, errors });
            }

            if (event.entity_name === 'Event') {
                const parents = Array.isArray(data.parents) ? data.parents : [];
                for (const parent of parents) {
                    const clientName = `${parent.name || ''} ${data.family_name || ''}`.trim();
                    await updateUsersByEmail(parent.email, parent.phone, clientName, 'Event/Client');
                }
                return Response.json({ success: true, mode: 'incremental_event', updates_count: updates.length, updates, errors });
            }
        }

        // Fallback for manual/full sync calls without an entity payload.
        console.log('[SyncIdentity] Starting full sync fallback...');
        const suppliers = await base44.asServiceRole.entities.Supplier.list();
        const events = await base44.asServiceRole.entities.Event.list();

        for (const supplier of suppliers) {
            const emails = Array.isArray(supplier.contact_emails) ? supplier.contact_emails : [];
            const supplierName = supplier.contact_person || supplier.supplier_name || '';
            for (const email of emails) {
                await updateUsersByEmail(email, supplier.phone, supplierName, 'Supplier');
            }
        }

        for (const eventRecord of events) {
            const parents = Array.isArray(eventRecord.parents) ? eventRecord.parents : [];
            for (const parent of parents) {
                const clientName = `${parent.name || ''} ${eventRecord.family_name || ''}`.trim();
                await updateUsersByEmail(parent.email, parent.phone, clientName, 'Event/Client');
            }
        }

        return Response.json({
            success: true,
            mode: 'full_fallback',
            processed_suppliers: suppliers.length,
            processed_events: events.length,
            updates_count: updates.length,
            updates,
            errors
        });

    } catch (error) {
        console.error('[SyncIdentity] Fatal Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});