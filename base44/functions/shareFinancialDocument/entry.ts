import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { sendWhatsAppText } from "../../shared/whatsappSend.ts";

const typeLabels: Record<string, string> = { invoice: "חשבונית מס", receipt: "קבלה", invoice_receipt: "חשבונית מס/קבלה", invoice_credit: "חשבונית זיכוי", proforma: "חשבונית עסקה" };

// שיתוף מסמך פיננסי קיים עם הלקוח במייל או בוואטסאפ (קישור ל-PDF שהופק ב-Invoice4U).
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const { documentId, channel, recipient, message } = await req.json();
    if (!documentId || !recipient) return Response.json({ error: "חסרים פרטי שיתוף" }, { status: 400 });
    if (!["email", "whatsapp"].includes(channel)) return Response.json({ error: "ערוץ שיתוף לא נתמך" }, { status: 400 });

    const document = await base44.asServiceRole.entities.FinancialDocument.get(documentId);
    if (!document) return Response.json({ error: "המסמך לא נמצא" }, { status: 404 });
    const pdfUrl = document.pdf_original_url || document.pdf_certified_url;
    if (!pdfUrl) return Response.json({ error: "אין קישור PDF למסמך זה. יש להפיק PDF לפני השיתוף" }, { status: 400 });

    const label = typeLabels[document.document_type] || "מסמך";
    const title = `${label} ${document.document_number || ""}`.trim();
    const body = `${message ? message + "\n\n" : ""}${title}\nלצפייה והורדה: ${pdfUrl}`;

    if (channel === "email") {
      const settings = await base44.asServiceRole.entities.AppSettings.list();
      const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
      await base44.asServiceRole.integrations.Core.SendEmail({ to: recipient, subject: title, body, from_name: config.business_name || config.company_name || undefined });
    } else {
      await sendWhatsAppText(recipient, body);
    }
    return Response.json({ shared: true, channel, recipient });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}