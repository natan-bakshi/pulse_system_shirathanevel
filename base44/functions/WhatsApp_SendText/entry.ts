import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';
import { sendWhatsAppText } from '../../shared/whatsappSend.ts';

/**
 * שליחת הודעת טקסט בוואטסאפ. מנהלים בלבד.
 * אימות קשיח לפני קריאת ה-body ולפני גישה ל-secrets.
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

        const { Phone, Message } = payload || {};
        if (!Phone || !Message) {
            return Response.json({ success: false, error: 'Missing required parameters' }, { status: 400 });
        }

        const result = await sendWhatsAppText(Phone, Message);
        return Response.json({ success: true, messageId: result.messageId || '' });

    } catch (error) {
        const errorCode = error?.errorCode;
        console.error('[WhatsApp_SendText] failed');
        return Response.json(
            { success: false, error: 'Failed to send WhatsApp message', errorCode: errorCode || null },
            { status: errorCode ? 400 : 500 }
        );
    }
});