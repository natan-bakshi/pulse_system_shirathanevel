import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * מחזיר את זהות המנהל המחובר לסוכן admin_event_manager בלבד.
 * חשיפה מינימלית: מזהה, שם, טלפון ותפקיד - ללא רשימת משתמשים וללא PII נוסף.
 * הזהות נקבעת בשרת מ-auth.me() בלבד; אין קריאה לגוף הבקשה.
 */
Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
        user = await base44.auth.me();
    } catch (e) {
        user = null;
    }

    if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    return Response.json({
        success: true,
        is_admin: true,
        user_id: user.id,
        full_name: user.full_name || user.display_name || '',
        phone: user.phone || ''
    });
});