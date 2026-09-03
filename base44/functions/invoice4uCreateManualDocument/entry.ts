import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { invoice4uErrors, invoice4uFindOrCreateCustomer, invoice4uRequest, invoice4uToken } from "../../shared/invoice4uClient.ts";
import { buildDocumentBody, round2 } from "../../shared/invoice4uDocuments.ts";

// איש הקשר הראשון של האירוע (הורה או איש קשר של המזמין) - לפרטי הלקוח במסמך.
function firstEventContact(event) {
  const parse = (value) => { if (Array.isArray(value)) return value; try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
  return [...parse(event?.parents), ...parse(event?.organizer_contacts)].find((contact) => contact?.name || contact?.phone || contact?.email) || {};
}



// הפקת חשבונית מס/קבלה עבור תשלום שנרשם ידנית במערכת (מזומן, העברה, צ'ק).
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const { paymentId, customer, documentType, language, item, paymentMethod, subject: subjectOverride } = await req.json();
    const docLanguage = language === "en" ? "en" : "he";
    const isReceiptOnly = documentType === "receipt";
    if (!paymentId) return Response.json({ error: "חסר מזהה תשלום" }, { status: 400 });

    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
    if (config.billing_enabled !== "true") return Response.json({ error: "מודול החיוב אינו פעיל" }, { status: 403 });
    if (config.manual_payment_invoice_enabled !== "true") return Response.json({ error: "הפקת מסמך לתשלום ידני אינה מופעלת בהגדרות" }, { status: 403 });

    const payment = await base44.asServiceRole.entities.Payment.get(paymentId);
    if (!payment) return Response.json({ error: "התשלום לא נמצא" }, { status: 404 });
    if (payment.financial_document_id) return Response.json({ error: "לתשלום זה כבר הופק מסמך" }, { status: 400 });
    if (payment.payment_status && payment.payment_status !== "completed") return Response.json({ error: "ניתן להפיק מסמך רק לתשלום שהושלם" }, { status: 400 });
    const amount = round2(Number(payment.amount));
    if (!Number.isFinite(amount) || amount <= 0) return Response.json({ error: "סכום התשלום אינו תקין" }, { status: 400 });

    const event = payment.event_id ? await base44.asServiceRole.entities.Event.get(payment.event_id) : null;
    const vatPercent = Number(config.vat_rate) || 18;
    const defaultSubject = event
      ? (docLanguage === "en" ? `Payment for ${event.event_name}` : `תשלום עבור ${event.event_name}`)
      : (payment.notes || (docLanguage === "en" ? "Payment" : "תשלום"));
    const subject = String(subjectOverride || "").trim() || defaultSubject;
    const contact = firstEventContact(event);
    const customerName = customer?.name || payment.payer_name || contact.name || event?.family_name || (docLanguage === "en" ? "Customer" : "לקוח");

    const environment = config.invoice4u_env === "production" ? "production" : "qa";
    const token = invoice4uToken(environment);
    const customerEmail = customer?.email || payment.payer_email || contact.email || "";
    const customerPhone = customer?.phone || payment.payer_phone || contact.phone || "";
    // קבלה מחייבת לקוח קיים במערכת Invoice4U, בעוד חשבונית מס/קבלה מאפשרת לקוח מזדמן.
    const clientId = isReceiptOnly
      ? await invoice4uFindOrCreateCustomer(environment, token, { name: customerName, email: customerEmail, phone: customerPhone, identifier: customer?.identifier || "" })
      : null;

    // שורת הפריט מגיעה מדיאלוג ההפקה (תיאור/כמות/מחיר) - המחיר כולל מע"מ.
    // חייבת להסתכם בסכום התשלום, אחרת המסמך לא יתאים לתשלום שנרשם.
    const itemName = String(item?.name || "").trim() || subject;
    const itemQuantity = Number(item?.quantity) > 0 ? Number(item.quantity) : 1;
    const itemPrice = item?.price === undefined || item?.price === null || item?.price === "" ? round2(amount / itemQuantity) : round2(item.price);
    if (!Number.isFinite(itemPrice) || itemPrice <= 0) return Response.json({ error: "מחיר הפריט אינו תקין" }, { status: 400 });
    if (Math.abs(round2(itemPrice * itemQuantity) - amount) > 0.01) return Response.json({ error: `סך שורת הפריט (${round2(itemPrice * itemQuantity)}) אינו זהה לסכום התשלום (${amount})` }, { status: 400 });

    const doc = buildDocumentBody({
      slug: isReceiptOnly ? "receipt" : "invoice_receipt",
      subject,
      currency: payment.currency || "ILS",
      // TaxIncluded - המחיר נשלח כולל מע"מ ו-Invoice4U מחשב את המע"מ לאחור, כך שאין פער עיגול.
      taxIncluded: true,
      items: [{ name: itemName, quantity: itemQuantity, price: itemPrice, taxRate: vatPercent }],
      payments: [{ amount, type: paymentMethod || payment.payment_method, date: payment.payment_date }],
      customer: { name: customerName, email: customerEmail, phone: customerPhone, identifier: customer?.identifier || "" },
      clientId,
      vatPercent,
      language: docLanguage
    });
    const response = await invoice4uRequest(environment, "CreateDocument", { token, doc });
    const result = response.CreateDocumentResult || response;
    const errorMessage = invoice4uErrors(result);
    if (errorMessage) return Response.json({ error: errorMessage }, { status: 400 });

    const document = await base44.asServiceRole.entities.FinancialDocument.create({
      document_type: isReceiptOnly ? "receipt" : "invoice_receipt",
      document_number: String(result.DocumentNumber || ""),
      invoice4u_id: result.ID || "",
      status: "open",
      total: Number(result.Total || amount),
      total_without_tax: Number(result.TotalWithoutTax || 0),
      total_tax: Number(result.TotalTaxAmount || 0),
      currency: payment.currency || "ILS",
      issue_date: new Date().toISOString(),
      linked_event_id: payment.event_id || "",
      linked_payment_id: payment.id,
      customer_name: customerName,
      customer_identifier: String(customer?.identifier || result.ClientID || ""),
      pdf_original_url: result.PrintOriginalPDFLink || "",
      pdf_certified_url: result.PrintCertifiedCopyPDFLink || ""
    });
    await base44.asServiceRole.entities.Payment.update(payment.id, { financial_document_id: document.id, invoice4u_document_number: document.document_number });
    return Response.json({ document });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}