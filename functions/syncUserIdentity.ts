import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Sync User Identity with Business Entities (Supplier/Client)
 * 
 * Purpose: 
 * 1. Auto-classify new users as 'supplier' or 'client' based on email.
 * 2. Sync missing data (phone, name) from Entity -> User.
 * 3. Sync missing data (phone, name) from User -> Entity.
 * 
 * Triggered by: User creation/update automation.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // This function is typically called by automation payload which contains { event: ..., data: ... }
        // Or manually via SDK
        const payload = await req.json();
        
        // Handle Automation Payload vs Direct Call
        let userData = payload.data || payload; 
        const isAutomation = !!payload.event;
        
        // If it's a delete event, we do nothing
        if (isAutomation && payload.event.type === 'delete') {
            return Response.json({ skipped: true, reason: 'delete event' });
        }

        // If called manually with just ID, fetch the user
        if (userData && !userData.email && userData.id) {
             const fetched = await base44.asServiceRole.entities.User.filter({ id: userData.id });
             if (fetched.length) userData = fetched[0];
        }

        if (!userData || !userData.email) {
            return Response.json({ error: 'Valid user data with email is required' }, { status: 400 });
        }

        const userEmail = userData.email.toLowerCase().trim();
        const userId = userData.id;
        
        console.log(`[SyncIdentity] Starting sync for user: ${userEmail} (${userId})`);

        let updatesMade = false;
        let determinedType = userData.user_type; // Keep existing if set, or update if found
        let determinedPhone = userData.phone;
        let determinedName = userData.full_name;

        // --- 1. Check Supplier Match ---
        const suppliers = await base44.asServiceRole.entities.Supplier.list();
        const supplier = suppliers.find(s => 
            Array.isArray(s.contact_emails) && 
            s.contact_emails.some(e => e && e.toLowerCase().trim() === userEmail)
        );

        if (supplier) {
            console.log(`[SyncIdentity] Match found: Supplier ${supplier.supplier_name}`);
            
            // A. Update User from Supplier (if User missing info)
            if (userData.user_type !== 'supplier' && userData.user_type !== 'admin') {
                determinedType = 'supplier';
                updatesMade = true;
            }
            if (!determinedPhone && supplier.phone) {
                determinedPhone = supplier.phone;
                updatesMade = true;
            }
            if (!determinedName && supplier.contact_person) {
                determinedName = supplier.contact_person;
                updatesMade = true;
            }

            // B. Update Supplier from User (if Supplier missing info AND User has it)
            // Only update specific fields if they are missing on Supplier to avoid overwriting business data with random user data
            let supplierUpdates = {};
            if (!supplier.phone && userData.phone) {
                supplierUpdates.phone = userData.phone;
            }
            // Note: We don't overwrite contact_person easily as it might be different from user name
            
            if (Object.keys(supplierUpdates).length > 0) {
                await base44.asServiceRole.entities.Supplier.update(supplier.id, supplierUpdates);
                console.log(`[SyncIdentity] Updated Supplier ${supplier.id} with missing info from User`);
            }
        } 
        
        // --- 2. Check Client (Event Parent) Match ---
        // Only if not identified as supplier yet (or to enrich data)
        // A user can be both, but usually Role is one. We prioritize Supplier role if both exist, or Admin.
        
        if (!supplier) {
            // Check Events
            const events = await base44.asServiceRole.entities.Event.filter({ status: { $ne: 'cancelled' } });
            let matchedClient = null;
            let matchedEvent = null;

            for (const event of events) {
                if (event.parents && Array.isArray(event.parents)) {
                    const parent = event.parents.find(p => p.email && p.email.toLowerCase().trim() === userEmail);
                    if (parent) {
                        matchedClient = parent;
                        matchedEvent = event;
                        break;
                    }
                }
            }

            if (matchedClient) {
                console.log(`[SyncIdentity] Match found: Client in Event ${matchedEvent.event_name}`);

                // A. Update User from Client
                if (userData.user_type !== 'client' && userData.user_type !== 'admin' && userData.user_type !== 'supplier') {
                    determinedType = 'client';
                    updatesMade = true;
                }
                if (!determinedPhone && matchedClient.phone) {
                    determinedPhone = matchedClient.phone;
                    updatesMade = true;
                }
                if (!determinedName && matchedClient.name) {
                    determinedName = matchedClient.name;
                    updatesMade = true;
                }

                // B. Update Client (Event Parent) from User
                // This is harder because 'parents' is a JSON array. We must read, modify, write back.
                if (userData.phone && !matchedClient.phone) {
                    const newParents = matchedEvent.parents.map(p => {
                        if (p.email && p.email.toLowerCase().trim() === userEmail) {
                            return { ...p, phone: userData.phone };
                        }
                        return p;
                    });
                    
                    await base44.asServiceRole.entities.Event.update(matchedEvent.id, { parents: newParents });
                    console.log(`[SyncIdentity] Updated Event ${matchedEvent.id} parent phone from User`);
                }
            }
        }

        // --- 3. Apply Updates to User ---
        if (updatesMade) {
            // Only update if something changed
            const updatePayload = {};
            if (determinedType !== userData.user_type) updatePayload.user_type = determinedType;
            if (determinedPhone !== userData.phone) updatePayload.phone = determinedPhone;
            if (determinedName !== userData.full_name) updatePayload.full_name = determinedName;

            if (Object.keys(updatePayload).length > 0) {
                // If we are in an entity_create automation, writing back to the same entity *might* cause a loop 
                // if the platform doesn't detect it. Base44 usually handles this, or we check if changes are real.
                // We checked changes above.
                
                await base44.asServiceRole.entities.User.update(userId, updatePayload);
                console.log(`[SyncIdentity] User ${userId} synced successfully`, updatePayload);
            }
        } else {
            console.log(`[SyncIdentity] User ${userId} already in sync`);
        }

        return Response.json({ success: true, updates: updatesMade });

    } catch (error) {
        console.error('[SyncIdentity] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});