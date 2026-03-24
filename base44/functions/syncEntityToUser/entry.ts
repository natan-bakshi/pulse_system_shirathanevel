import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Sync Business Entity Changes TO User
 * 
 * Triggered by: Supplier or Event create/update.
 * Purpose: If a Supplier/Event is updated, ensure the linked User (if exists) is updated.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();
        
        // Payload structure from entity automation:
        // { event: { type, entity_name, entity_id }, data: { ... } }
        
        const { event, data } = payload;
        
        if (!event || !data) {
            return Response.json({ skipped: true, reason: 'Invalid payload' });
        }
        
        console.log(`[SyncEntityToUser] Processing ${event.entity_name} ${event.type}`);
        
        let targetEmails = [];
        let sourcePhone = '';
        let targetRole = '';
        
        if (event.entity_name === 'Supplier') {
            if (data.contact_emails && Array.isArray(data.contact_emails)) {
                targetEmails = data.contact_emails;
            }
            sourcePhone = data.phone;
            targetRole = 'supplier';
        } else if (event.entity_name === 'Event') {
            if (data.parents && Array.isArray(data.parents)) {
                // Collect all emails from parents that have a phone number (source of truth)
                // or just all emails to sync role
                data.parents.forEach(p => {
                    if (p.email) targetEmails.push(p.email);
                });
            }
            targetRole = 'client';
            // Note: Event has multiple parents, so we can't just pick one phone.
            // We need to match Email -> Parent Object -> Phone.
        }
        
        if (targetEmails.length === 0) {
            return Response.json({ skipped: true, reason: 'No emails found in entity' });
        }
        
        let updatesCount = 0;
        
        for (const email of targetEmails) {
            if (!email) continue;
            const normalizedEmail = email.toLowerCase().trim();
            
            // Find User
            const users = await base44.asServiceRole.entities.User.filter({ email: normalizedEmail });
            if (users.length === 0) continue;
            
            const user = users[0];
            let userUpdates = {};
            
            // Determine Phone for this specific email (especially for Event parents)
            let phoneToSync = sourcePhone;
            let nameToSync = '';
            
            if (event.entity_name === 'Event') {
                const parent = data.parents.find(p => p.email && p.email.toLowerCase().trim() === normalizedEmail);
                if (parent) {
                    phoneToSync = parent.phone;
                    nameToSync = parent.name;
                }
            } else if (event.entity_name === 'Supplier') {
                 nameToSync = data.contact_person;
            }
            
            // Check Role
            if (user.user_type !== 'admin' && user.user_type !== 'supplier') { // Don't downgrade admins/suppliers
                 if (targetRole === 'supplier') {
                     if (user.user_type !== 'supplier') userUpdates.user_type = 'supplier';
                 } else if (targetRole === 'client') {
                     if (user.user_type !== 'client' && user.user_type !== 'supplier') userUpdates.user_type = 'client';
                 }
            }
            
            // Check Phone (Only if user missing it? Or force sync? User said "Two way... missing info... will be pulled")
            // Safest: Fill if missing.
            if (!user.phone && phoneToSync) {
                userUpdates.phone = phoneToSync;
            }
            
            // Check Name
            if (!user.full_name && nameToSync) {
                userUpdates.full_name = nameToSync;
            }
            
            if (Object.keys(userUpdates).length > 0) {
                await base44.asServiceRole.entities.User.update(user.id, userUpdates);
                updatesCount++;
                console.log(`[SyncEntityToUser] Updated User ${user.email}`, userUpdates);
            }
        }
        
        return Response.json({ success: true, updates: updatesCount });
        
    } catch (error) {
        console.error('[SyncEntityToUser] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});