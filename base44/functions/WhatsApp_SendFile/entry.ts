import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';
import { sendWhatsAppFileByUrl } from '../../shared/whatsappSend.ts';

/**
 * שליחת קובץ בוואטסאפ. מנהלים בלבד.
 * לא מתקבל URL שרירותי מהלקוח: הלקוח מעביר FileUri מהאחסון הפרטי של Base44,
 * והשרת מפיק קישור חתום קצר-מועד בעצמו (allowlist בטוחה של hosts אינה ניתנת להוכחה).
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

        const { Phone, FileUri, FileName, Caption } = payload || {};
        if (!Phone || !FileUri) {
            return Response.json({ success: false, error: 'Missing required parameters (Phone, FileUri)' }, { status: 400 });
        }

        const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
            file_uri: FileUri,
            expires_in: 300
        });

        if (!signed?.signed_url) {
            return Response.json({ success: false, error: 'Failed to prepare file link' }, { status: 400 });
        }

        const result = await sendWhatsAppFileByUrl(Phone, signed.signed_url, FileName, Caption);
        return Response.json({ success: true, messageId: result.messageId || '' });

    } catch (error) {
        const errorCode = error?.errorCode;
        console.error('[WhatsApp_SendFile] failed');
        return Response.json(
            { success: false, error: 'Failed to send WhatsApp file', errorCode: errorCode || null },
            { status: errorCode ? 400 : 500 }
        );
    }
});