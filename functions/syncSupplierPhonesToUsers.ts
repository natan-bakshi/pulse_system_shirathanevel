import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Syncs User Identity (Phone & Display Name) from Suppliers and Events.
 * 
 * Logic:
 * 1. Matches Users by Email.
 * 2. Syncs Phone: If User has no phone (in data.phone or root), updates it from Supplier/Event.
 * 3. Syncs Display Name:
 *    - For Suppliers: Uses 'contact_person' or 'supplier_name'.
 *    - For Clients (Event Parents): Uses '{parent.name} {event.family_name}'.
 * 4. Priority: Updates are sequential. If a user is both, Event data might overwrite Supplier data depending on order.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        console.log('[SyncIdentity] Starting sync process...');

        // 1. Fetch Data
        // Increasing limits to cover more records. For production with thousands, cursor pagination is recommended.
        const [suppliers, users, events] = await Promise.all([
            base44.asServiceRole.entities.Supplier.list({ limit: 1000 }),
            base44.asServiceRole.entities.User.list({ limit: 1000 }),
            base44.asServiceRole.entities.Event.list({ limit: 1000 })
        ]);

        console.log(`[SyncIdentity] Processing ${suppliers.length} suppliers, ${events.length} events against ${users.length} users.`);

        const updates = [];
        const errors = [];

        // Map users by Email (lowercase) for fast lookup
        const usersByEmail = new Map();
        users.forEach(u => {
            if (u.email) usersByEmail.set(u.email.toLowerCase().trim(), u);
        });

        // Helper to perform update
        const updateUser = async (user, newPhone, newName, source) => {
            try {
                // Determine if we need an update
                // Check both root phone and data.phone (Base44 structure nuances)
                const currentPhone = user.data?.phone || user.phone;
                const currentName = user.data?.display_name || user.display_name;

                let updatesToApply = {};
                let hasChanges = false;

                // Phone Logic: Only update if source has phone AND (user has no phone OR user phone is different)
                if (newPhone && (!currentPhone || currentPhone !== newPhone)) {
                    updatesToApply.phone = newPhone;
                    hasChanges = true;
                }

                // Name Logic: Update if source has name AND (user has no name OR different)
                // We overwrite name to ensure it's "updated" as requested
                if (newName && (!currentName || currentName !== newName)) {
                    updatesToApply.display_name = newName;
                    hasChanges = true;
                }

                if (hasChanges) {
                    console.log(`[SyncIdentity] Updating User ${user.email} (${source}):`, updatesToApply);
                    
                    // We simply pass the fields. Base44 SDK puts them in 'data' if they are custom fields.
                    await base44.asServiceRole.entities.User.update(user.id, updatesToApply);
                    
                    // Update local object to reflect change for subsequent loops (if any)
                    if (!user.data) user.data = {};
                    if (updatesToApply.phone) {
                         user.phone = updatesToApply.phone; 
                         user.data.phone = updatesToApply.phone;
                    }
                    if (updatesToApply.display_name) {
                        user.display_name = updatesToApply.display_name;
                        user.data.display_name = updatesToApply.display_name;
                    }

                    updates.push({
                        email: user.email,
                        source,
                        changes: updatesToApply
                    });
                }
            } catch (err) {
                console.error(`[SyncIdentity] Error updating ${user.email}:`, err);
                errors.push({ email: user.email, error: err.message });
            }
        };

        // 2. Process Suppliers
        for (const supplier of suppliers) {
            const emails = supplier.contact_emails || [];
            if (!Array.isArray(emails)) continue;

            const supplierName = supplier.contact_person || supplier.supplier_name;
            const supplierPhone = supplier.phone;

            for (const email of emails) {
                if (!email) continue;
                const matchedUser = usersByEmail.get(email.toLowerCase().trim());
                if (matchedUser) {
                    // Check logic: 
                    // - Prioritize updating phone if supplier has one.
                    // - Always try to sync name.
                    await updateUser(matchedUser, supplierPhone, supplierName, 'Supplier');
                }
            }
        }

        // 3. Process Events (Clients)
        for (const event of events) {
            const parents = event.parents || [];
            if (!Array.isArray(parents)) continue;

            for (const parent of parents) {
                if (!parent.email) continue;
                const matchedUser = usersByEmail.get(parent.email.toLowerCase().trim());
                
                if (matchedUser) {
                    const clientName = `${parent.name || ''} ${event.family_name || ''}`.trim();
                    const clientPhone = parent.phone;

                    await updateUser(matchedUser, clientPhone, clientName, 'Event/Client');
                }
            }
        }

        return Response.json({
            success: true,
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