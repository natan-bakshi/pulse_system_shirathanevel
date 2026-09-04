import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { sendWhatsAppText } from '../../shared/whatsappSend.ts';

/**
 * שליחת הודעת וואטסאפ לפי מספר טלפון. מנהלים בלבד.
 * chat_id אינו מתקבל מהלקוח - השרת בונה אותו מהמספר המנורמל.
 */
Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') {
            return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
        }

        const base44 = createClientFromRequest(req);

        let user = null;
        try {
            user = await base44.auth.me();
        } catch (e) {
            user = null;
        }
        if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        if (user.role !== 'admin') {
            return Response.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        let payload = null;
        try {
            payload = await req.json();
        } catch (e) {
            return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
        }

        const { phone, message } = payload || {};
        if (!phone || !message) {
            return Response.json({ success: false, error: 'Missing target or message' }, { status: 400 });
        }

        const result = await sendWhatsAppText(phone, message);
        return Response.json({ success: true, messageId: result.messageId || '' });

    } catch (error) {
        const errorCode = error?.errorCode;
        console.error('[SendWhatsApp] failed');
        return Response.json(
            { success: false, error: 'Failed to send WhatsApp message', errorCode: errorCode || null },
            { status: errorCode ? 400 : 500 }
        );
    }
});