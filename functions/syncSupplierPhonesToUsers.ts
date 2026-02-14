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

        console.log(`[SyncIdentity] Found ${suppliers.length} suppliers, ${events.length} events, and ${users.length} users.`);

        const updates = [];
        const errors = [];

        // Map users by Email (lowercase) for fast lookup
        const usersByEmail = new Map();
        users.forEach(u => {
            if (u.email) usersByEmail.set(u.email.toLowerCase().trim(), u);
        });
        console.log(`[SyncIdentity] Mapped ${usersByEmail.size} users by email.`);

        // Helper to perform update
        const updateUser = async (user, newPhone, newName, source) => {
            try {
                // Determine if we need an update
                // Check both root phone and data.phone (Base44 structure nuances)
                const currentPhone = user.phone; // Direct phone field (might be null)
                const currentDataPhone = user.data?.phone; // Phone within data object

                let updatesToApply = {};
                let hasChanges = false;

                // Phone Logic: Only update if source has phone AND (user has no phone OR user phone is different)
                if (newPhone) {
                    // Update root phone if missing or different
                    if (!currentPhone || currentPhone !== newPhone) { 
                        updatesToApply.phone = newPhone;
                        hasChanges = true;
                    } 
                    // Also update data.phone if it exists and is different, or if we are setting it for the first time
                    // Note: We prioritize root phone, but keeping data object in sync is good practice if used elsewhere
                }

                // Name Logic: Update if source has name AND (user has no name OR different)
                const currentDisplayName = user.display_name; // Direct display_name field
                
                if (newName) {
                    if (!currentDisplayName || currentDisplayName !== newName) { // Check root display_name first
                        updatesToApply.display_name = newName;
                        hasChanges = true;
                    }
                }

                if (hasChanges) {
                    console.log(`[SyncIdentity] Updating User ${user.email} (ID: ${user.id}, Source: ${source}):`, updatesToApply);
                    
                    // We simply pass the fields. Base44 SDK handles mapping to 'data' if they are custom fields
                    // and updating root fields if they exist.
                    await base44.asServiceRole.entities.User.update(user.id, updatesToApply);
                    
                    // Update local user object for subsequent checks within the same run
                    if (updatesToApply.phone) user.phone = updatesToApply.phone;
                    if (updatesToApply.display_name) user.display_name = updatesToApply.display_name;
                    
                    updates.push({
                        email: user.email,
                        source,
                        changes: updatesToApply
                    });
                }
            } catch (err) {
                console.error(`[SyncIdentity] Error updating user ${user.id} (${user.email}):`, err);
                errors.push({ email: user.email, error: err.message });
            }
        };

        // 2. Process Suppliers
        console.log('[SyncIdentity] Processing Suppliers...');
        for (const supplier of suppliers) {
            // console.log(`[SyncIdentity] Checking supplier: ${supplier.supplier_name} (ID: ${supplier.id})`);
            const emails = supplier.contact_emails || [];
            if (!Array.isArray(emails) || emails.length === 0) {
                continue;
            }

            const supplierName = supplier.contact_person || supplier.supplier_name;
            const supplierPhone = supplier.phone;

            for (const email of emails) {
                if (!email) continue;
                
                const normalizedEmail = email.toLowerCase().trim();
                const matchedUser = usersByEmail.get(normalizedEmail);
                
                if (matchedUser) {
                    await updateUser(matchedUser, supplierPhone, supplierName, 'Supplier');
                }
            }
        }

        // 3. Process Events (Clients)
        console.log('[SyncIdentity] Processing Events...');
        for (const event of events) {
            // console.log(`[SyncIdentity] Checking event: ${event.event_name} (ID: ${event.id})`);
            const parents = event.parents || [];
            if (!Array.isArray(parents) || parents.length === 0) {
                continue;
            }

            for (const parent of parents) {
                if (!parent.email) continue;

                const normalizedEmail = parent.email.toLowerCase().trim();
                const matchedUser = usersByEmail.get(normalizedEmail);
                
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