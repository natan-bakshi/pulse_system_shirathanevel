import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/**
 * הפקת קישור חתום לקובץ פרטי - מנהל מאומת בלבד.
 *
 * החוזה הקודם (file_uri שרירותי מהלקוח) בוטל לחלוטין.
 * הלקוח שולח reference עסקי בלבד, וה-URI נפתר בשרת מתוך הרשומה האמיתית:
 *   { resource_type: 'event_quote', event_id, quote_created_at, quote_file_name }
 *   { resource_type: 'manual_quote', manual_quote_id }
 *   { resource_type: 'signed_agreement', agreement_id }
 *
 * אין URI ואין signed URL בלוגים.
 */
const MIN_EXPIRES = 60;
const MAX_EXPIRES = 900;
const DEFAULT_EXPIRES = 300;

function isValidId(value) {
    const id = String(value || '').trim();
    return id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_\-:.]+$/.test(id);
}

function clampExpiry(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return DEFAULT_EXPIRES;
    return Math.min(MAX_EXPIRES, Math.max(MIN_EXPIRES, Math.floor(num)));
}

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
        if (user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const resourceType = String(body?.resource_type || '');
        const expiresIn = clampExpiry(body?.expires_in);
        const serviceRole = base44.asServiceRole;

        let fileUri = '';

        if (resourceType === 'event_quote') {
            if (!isValidId(body?.event_id)) {
                return Response.json({ error: 'Invalid event_id' }, { status: 400 });
            }
            const createdAt = String(body?.quote_created_at || '').trim();
            const fileName = String(body?.quote_file_name || '').trim();
            if (!createdAt || !fileName) {
                return Response.json({ error: 'quote_created_at and quote_file_name are required' }, { status: 400 });
            }

            let event = null;
            try {
                event = await serviceRole.entities.Event.get(body.event_id);
            } catch (e) {
                event = null;
            }
            if (!event) {
                return Response.json({ error: 'Resource not found' }, { status: 404 });
            }

            const history = Array.isArray(event.quote_history) ? event.quote_history : [];
            const entry = history.find(h => h && h.created_at === createdAt && h.file_name === fileName);
            if (!entry?.file_uri) {
                return Response.json({ error: 'Resource not found' }, { status: 404 });
            }
            fileUri = entry.file_uri;

        } else if (resourceType === 'manual_quote') {
            if (!isValidId(body?.manual_quote_id)) {
                return Response.json({ error: 'Invalid manual_quote_id' }, { status: 400 });
            }
            let quote = null;
            try {
                quote = await serviceRole.entities.ManualQuote.get(body.manual_quote_id);
            } catch (e) {
                quote = null;
            }
            if (!quote?.last_pdf_uri) {
                return Response.json({ error: 'Resource not found' }, { status: 404 });
            }
            fileUri = quote.last_pdf_uri;

        } else if (resourceType === 'signed_agreement') {
            if (!isValidId(body?.agreement_id)) {
                return Response.json({ error: 'Invalid agreement_id' }, { status: 400 });
            }
            let agreement = null;
            try {
                agreement = await serviceRole.entities.SignedAgreement.get(body.agreement_id);
            } catch (e) {
                agreement = null;
            }
            if (!agreement?.agreement_content_uri) {
                return Response.json({ error: 'Resource not found' }, { status: 404 });
            }
            fileUri = agreement.agreement_content_uri;

        } else {
            return Response.json({ error: 'Unsupported resource_type' }, { status: 400 });
        }

        const result = await serviceRole.integrations.Core.CreateFileSignedUrl({
            file_uri: fileUri,
            expires_in: expiresIn
        });

        if (!result?.signed_url) {
            return Response.json({ error: 'Could not create signed url' }, { status: 500 });
        }

        console.log(`[SignedUrl] issued for resource_type=${resourceType}`);
        return Response.json({ signed_url: result.signed_url });

    } catch (error) {
        console.error('[SignedUrl] failed');
        return Response.json({ error: 'Could not create signed url' }, { status: 500 });
    }
});