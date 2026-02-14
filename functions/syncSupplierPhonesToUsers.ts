import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Syncs Supplier phone numbers to corresponding Users (by email).
 * Ensures that if a User exists for a Supplier, they have the correct phone number.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        console.log('[SyncPhones] Starting sync process...');

        // 1. Fetch all Suppliers and Users
        // Note: For large datasets, use pagination. Assuming < 1000 for now or increasing limit.
        const suppliers = await base44.asServiceRole.entities.Supplier.list({ limit: 1000 });
        const users = await base44.asServiceRole.entities.User.list({ limit: 1000 });

        console.log(`[SyncPhones] Found ${suppliers.length} suppliers and ${users.length} users.`);

        const updates = [];
        const errors = [];

        // 2. Create a map of Users by Email for O(1) lookup
        const usersByEmail = new Map();
        users.forEach(u => {
            if (u.email) usersByEmail.set(u.email.toLowerCase().trim(), u);
        });

        // 3. Iterate Suppliers
        for (const supplier of suppliers) {
            // Get supplier email (check contact_emails array or other fields if needed)
            // The schema says `contact_emails` is an array of strings.
            const emails = supplier.contact_emails || [];
            if (!Array.isArray(emails) || emails.length === 0) continue;

            // Use the first email or iterate all? Let's iterate all to find a match.
            for (const email of emails) {
                if (!email) continue;
                const normalizedEmail = email.toLowerCase().trim();
                
                if (usersByEmail.has(normalizedEmail)) {
                    const matchedUser = usersByEmail.get(normalizedEmail);
                    
                    // Check if sync needed
                    // Logic: If user phone is empty OR user phone is different from supplier phone
                    // AND supplier has a phone.
                    if (supplier.phone && (!matchedUser.phone || matchedUser.phone !== supplier.phone)) {
                        try {
                            console.log(`[SyncPhones] Updating User ${matchedUser.email} phone from ${matchedUser.phone || 'empty'} to ${supplier.phone}`);
                            
                            await base44.asServiceRole.entities.User.update(matchedUser.id, {
                                phone: supplier.phone
                            });
                            
                            updates.push({
                                user_email: matchedUser.email,
                                old_phone: matchedUser.phone,
                                new_phone: supplier.phone
                            });
                            
                            // Update the map instance too if we hit it again
                            matchedUser.phone = supplier.phone; 
                            
                        } catch (err) {
                            console.error(`[SyncPhones] Failed to update user ${matchedUser.id}:`, err);
                            errors.push({ email: matchedUser.email, error: err.message });
                        }
                    }
                }
            }
        }

        return Response.json({
            success: true,
            processed_suppliers: suppliers.length,
            updates_count: updates.length,
            updates,
            errors
        });

    } catch (error) {
        console.error('[SyncPhones] Fatal Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});