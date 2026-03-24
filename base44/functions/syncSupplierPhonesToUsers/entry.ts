import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Syncs User Identity (Phone & Display Name) from Suppliers and Events.
 * Logic: Matches Users by Email. Updates phone and display_name.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        console.log('[SyncIdentity] Starting sync process...');

        // Fetch Data (using default limits or pagination if needed, here testing simple list)
        const suppliers = await base44.asServiceRole.entities.Supplier.list();
        const users = await base44.asServiceRole.entities.User.list();
        const events = await base44.asServiceRole.entities.Event.list();

        console.log(`[SyncIdentity] Found ${suppliers.length} suppliers, ${events.length} events, and ${users.length} users.`);

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
                let updatesToApply = {};
                let hasChanges = false;

                // Phone Logic
                if (newPhone) {
                    if (!user.phone || user.phone !== newPhone) { 
                        updatesToApply.phone = newPhone;
                        hasChanges = true;
                    } 
                }

                // Name Logic
                if (newName) {
                    if (!user.display_name || user.display_name !== newName) {
                        updatesToApply.display_name = newName;
                        hasChanges = true;
                    }
                }

                if (hasChanges) {
                    console.log(`[SyncIdentity] Updating User ${user.email}:`, updatesToApply);
                    await base44.asServiceRole.entities.User.update(user.id, updatesToApply);
                    
                    // Update local object
                    if (updatesToApply.phone) user.phone = updatesToApply.phone;
                    if (updatesToApply.display_name) user.display_name = updatesToApply.display_name;
                    
                    updates.push({ email: user.email, source, changes: updatesToApply });
                }
            } catch (err) {
                console.error(`[SyncIdentity] Error updating user ${user.id}:`, err);
                errors.push({ email: user.email, error: err.message });
            }
        };

        // Process Suppliers
        for (const supplier of suppliers) {
            const emails = supplier.contact_emails || [];
            if (!Array.isArray(emails)) continue;

            const supplierName = supplier.contact_person || supplier.supplier_name;
            const supplierPhone = supplier.phone;

            for (const email of emails) {
                if (!email) continue;
                const matchedUser = usersByEmail.get(email.toLowerCase().trim());
                if (matchedUser) {
                    await updateUser(matchedUser, supplierPhone, supplierName, 'Supplier');
                }
            }
        }

        // Process Events
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
            processed_users: users.length,
            updates_count: updates.length,
            updates,
            errors
        });

    } catch (error) {
        console.error('[SyncIdentity] Fatal Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});