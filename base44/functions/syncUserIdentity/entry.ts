import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { normalizeEmail, resolveSelfBusinessMatch, buildUserUpdates } from '../../shared/identitySync.ts';

/**
 * סנכרון זהות עצמית (self בלבד).
 *
 * הזהות נקבעת רק מ-auth.me(). גוף הבקשה אינו נקרא ואינו משמש כלל:
 * מזהה, מייל, role או user_type שנשלחים מהדפדפן מתעלמים מהם לחלוטין.
 *
 * המקור הוא Supplier/Event בלבד - אין כתיבה חזרה אל הישויות העסקיות.
 * העדכון מוגבל ל-allowlist: phone, display_name, full_name (רק כשחסר), user_type.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // אימות לפני קריאת body ולפני כל שימוש ב-asServiceRole.
        let user = null;
        try {
            user = await base44.auth.me();
        } catch (e) {
            user = null;
        }
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const email = normalizeEmail(user.email);
        if (!email) {
            return Response.json({ success: true, updates: false, updated_fields: [], conflicts: 0 });
        }

        const serviceRole = base44.asServiceRole;
        const candidate = await resolveSelfBusinessMatch(serviceRole, email);

        // מסלול self שמרני: לא דורסים טלפון קיים ולא נוגעים ב-display_name.
        const { updates, conflicts } = buildUserUpdates(user, candidate, {
            overwritePhone: false,
            syncDisplayName: false
        });

        const updatedFields = Object.keys(updates);
        if (updatedFields.length > 0) {
            await serviceRole.entities.User.update(user.id, updates);
        }

        console.log(`[SyncIdentity] self sync done (fields: ${updatedFields.join(',') || 'none'}, conflicts: ${conflicts})`);

        return Response.json({
            success: true,
            updates: updatedFields.length > 0,
            updated_fields: updatedFields,
            conflicts
        });

    } catch (error) {
        console.error('[SyncIdentity] self sync failed');
        return Response.json({ error: 'Sync failed' }, { status: 500 });
    }
});