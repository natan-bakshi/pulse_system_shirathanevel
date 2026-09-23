import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { generateQuoteHtml } from '../../shared/quoteHtml.ts';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // אימות לפני קריאת body ולפני כל שימוש ב-asServiceRole. ההרשאה לפי role בלבד.
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
        const eventId = body.eventId;
        const includeIntro = body.includeIntro !== false;
        const includePaymentTerms = body.includePaymentTerms !== false;
        const includeSchedule = body.includeSchedule !== false;
        const includeExternalServices = body.includeExternalServices !== false;

        if (typeof eventId !== 'string' || !/^[A-Za-z0-9_\-:.]{1,64}$/.test(eventId.trim())) {
            return Response.json({ error: 'Invalid event id' }, { status: 400 });
        }

        // קריאת האירוע המבוקש מיד לאחר האימות - לפני שאר הישויות ולפני API2PDF.
        let requestedEvent = null;
        try {
            requestedEvent = await base44.asServiceRole.entities.Event.get(eventId);
        } catch (e) {
            requestedEvent = null;
        }
        if (!requestedEvent) {
            return Response.json({ error: 'Event not found' }, { status: 404 });
        }

        // Generate HTML content
        const { html, fileAndTitleName, margins } = await generateQuoteHtml(eventId, base44, { includeIntro, includePaymentTerms, includeSchedule, includeExternalServices, preloadedEvent: requestedEvent });

        const apiKey = Deno.env.get('API2PDF_API_KEY');
        if (!apiKey) {
            console.error('[GenerateQuotePdf] PDF service is not configured');
            return Response.json({ error: 'PDF service unavailable' }, { status: 503 });
        }

        const response = await fetch('https://v2.api2pdf.com/chrome/html', {
            method: 'POST',
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                html: html,
                inlinePdf: true,
                fileName: `${fileAndTitleName}.pdf`,
                options: {
                    printBackground: true,
                    preferCSSPageSize: true,
                    displayHeaderFooter: false, // We handle header/footer via table
                    marginTop: '0',
                    marginBottom: '0',
                    marginLeft: '0',
                    marginRight: '0',
                    landscape: false,
                    scale: 1
                }
            })
        });

        if (!response.ok) {
            // שגיאת ספק ה-PDF נרשמת כסטטוס בלבד, ללא גוף התשובה הגולמי ובלי להחזירה ללקוח.
            console.error(`[GenerateQuotePdf] PDF service rejected the request (status ${response.status})`);
            return Response.json({ error: 'Could not generate PDF' }, { status: 502 });
        }

        let result = null;
        try { result = await response.json(); } catch (e) { result = null; }
        
        if (!result?.pdf) {
            console.error('[GenerateQuotePdf] PDF service returned no file');
            return Response.json({ error: 'Could not generate PDF' }, { status: 502 });
        }

        const pdfUrl = result.pdf;
        const fileName = `${fileAndTitleName}.pdf`;
        let savedFileUri = null;

        // שמירה לאחסון הפרטי, ורק לאחר העלאה מוצלחת - כתיבה ל-quote_history.
        try {
            const pdfDownload = await fetch(pdfUrl);
            // חובה לוודא הורדה תקינה (2xx) לפני העלאה.
            if (!pdfDownload.ok) {
                console.error(`[GenerateQuotePdf] PDF download failed (status ${pdfDownload.status}) - history not updated`);
            } else {
                const pdfArrayBuffer = await pdfDownload.arrayBuffer();
                if (!pdfArrayBuffer || pdfArrayBuffer.byteLength === 0) {
                    console.error('[GenerateQuotePdf] Empty PDF payload - history not updated');
                } else {
                    const pdfUint8Array = new Uint8Array(pdfArrayBuffer);
                    const pdfBlob = new Blob([pdfUint8Array], { type: 'application/pdf' });
                    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

                    const uploadResult = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: pdfFile });
                    const fileUri = uploadResult?.file_uri;

                    if (!fileUri) {
                        console.error('[GenerateQuotePdf] Upload returned no file reference - history not updated');
                    } else {
                        savedFileUri = fileUri;

                        const currentEvent = await base44.asServiceRole.entities.Event.get(eventId);
                        const existingHistory = currentEvent?.quote_history || [];

                        const newEntry = {
                            file_uri: fileUri,
                            file_name: fileName,
                            created_at: new Date().toISOString(),
                            created_by_user_name: user.full_name || 'לא ידוע',
                            event_status: currentEvent?.status || 'quote'
                        };

                        await base44.asServiceRole.entities.Event.update(eventId, {
                            quote_history: [...existingHistory, newEntry]
                        });

                        console.log('[GenerateQuotePdf] Quote stored and history updated');
                    }
                }
            }
        } catch (historyError) {
            // כשל בשמירה אינו מפיל את הבקשה, אך גם אינו רושם היסטוריה.
            console.error('[GenerateQuotePdf] Storing the quote failed (non-blocking)');
        }

        return Response.json({ pdf_url: pdfUrl, fileName, file_uri: savedFileUri });

    } catch (error) {
        // ללא הודעות שגיאה גולמיות של ספק ה-PDF וללא stack trace ללקוח.
        console.error('[GenerateQuotePdf] failed');
        return Response.json({ error: 'Could not generate PDF' }, { status: 500 });
    }
});
