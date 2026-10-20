import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { sendWhatsAppText } from "../../shared/whatsappSend.ts";
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from "../../shared/whatsappReceipt.ts";

const typeLabels: Record<string, string> = { invoice: "חשבונית מס", receipt: "קבלה", invoice_receipt: "חשבונית מס/קבלה", invoice_credit: "חשבונית זיכוי", proforma: "חשבונית עסקה" };

// שיתוף מסמך פיננסי קיים עם הלקוח במייל או בוואטסאפ (קישור ל-PDF שהופק ב-Invoice4U).
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const { documentId, channel, recipient, recipients, message } = await req.json();
    const targets = (Array.isArray(recipients) ? recipients : [recipient])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (!documentId || targets.length === 0) return Response.json({ error: "חסרים פרטי שיתוף" }, { status: 400 });
    if (!["email", "whatsapp"].includes(channel)) return Response.json({ error: "ערוץ שיתוף לא נתמך" }, { status: 400 });

    const document = await base44.asServiceRole.entities.FinancialDocument.get(documentId);
    if (!document) return Response.json({ error: "המסמך לא נמצא" }, { status: 404 });
    const pdfUrl = document.pdf_original_url || document.pdf_certified_url;
    if (!pdfUrl) return Response.json({ error: "אין קישור PDF למסמך זה. יש להפיק PDF לפני השיתוף" }, { status: 400 });

    const label = typeLabels[document.document_type] || "מסמך";
    const title = `${label} ${document.document_number || ""}`.trim();
    const body = `${message ? message + "\n\n" : ""}${title}\nלצפייה והורדה: ${pdfUrl}`;

    let fromName;
    if (channel === "email") {
      const settings = await base44.asServiceRole.entities.AppSettings.list();
      const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
      fromName = config.business_name || config.company_name || undefined;
    }

    const failures: string[] = [];
    let queued = 0, sent = 0, manualReview = 0;
    for (const target of targets) {
      try {
        if (channel === "email") {
          await base44.asServiceRole.integrations.Core.SendEmail({ to: target, subject: title, body, from_name: fromName });
          sent++;
        } else {
          const receipt=await sendWhatsAppText(target, body, base44, {sourceType:'financial_document'});
          const state=whatsappEnqueueReceiptState(receipt);
          if(isWhatsAppEnqueueConfirmed(receipt)){
            if(state==='accepted')sent++;
            else queued++;
          }else if(state==='unknown'||state==='unverified'){
            manualReview++;
          }else failures.push('הודעת WhatsApp נדחתה או הסתיימה לפני אישור שליחה חדשה.');
        }
      } catch (sendError) {
        // A generic timeout can happen after an Outbox commit; never replay.
        if(channel==='whatsapp' &&
          !(sendError?.errorCode===400&&sendError?.deliveryUncertain===false))
          manualReview++;
        else failures.push(channel==='whatsapp'
          ?'בקשת WhatsApp נדחתה לפני קליטה לתור.'
          :'לא ניתן לשלוח את האימייל.');
      }
    }
    if (failures.length === targets.length && manualReview===0)
      return Response.json({error:'שליחת המסמך נכשלה. יש לבדוק את סיבת הכשל.'},{status:400});
    return Response.json({ shared:sent+queued>0,channel,sent,queued,manualReview,
      manual_review_required:manualReview>0,failures,
      ...(manualReview>0?{warning:'מצב שליחת מסמך ב־WhatsApp אינו ודאי. בדוק את התור לפני ניסיון נוסף.'}:{}) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}