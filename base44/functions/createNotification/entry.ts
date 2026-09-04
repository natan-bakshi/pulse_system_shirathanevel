import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { createNotificationCore } from '../../shared/notificationCore.ts';

/**
 * Endpoint מאומת ליצירת התראה (in-app + Push + WhatsApp ידני).
 * מנהלים בלבד. אימות קשיח לפני קריאת ה-body ולפני כל שימוש ב-asServiceRole.
 * הלוגיקה עצמה מרוכזת ב-base44/shared/notificationCore.ts, שנקרא ישירות
 * מפונקציות ה-backend (הן אינן קוראות ל-endpoint הזה).
 */
Deno.serve(async (req) => {
    try {
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

        let payload = null;
        try {
            payload = await req.json();
        } catch (e) {
            return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const result = await createNotificationCore(base44, payload, {
            allowWhatsApp: true,
            allowManualPhone: true
        });

        return Response.json(result.body, { status: result.status });

    } catch (error) {
        console.error('[Notification] Error:', error?.message);
        return Response.json({ error: 'Failed to create notification' }, { status: 500 });
    }
});