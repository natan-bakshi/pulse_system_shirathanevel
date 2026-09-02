import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { invoice4uErrors, invoice4uFindOrCreateCustomer, invoice4uRequest, invoice4uToken } from "../../shared/invoice4uClient.ts";

// Invoice4U מצפה לתאריכים בפורמט WCF: /Date(מילישניות)/
const wcfDate = (value: string) => `/Date(${new Date(value).getTime()})/`;

// שלב א' בביטול מסמך: הפקת חשבונית זיכוי מלאה מול Invoice4U.
async function createCreditDocument(base44, environment, token, document, reason) {
  const referenceType = document.document_type === "invoice" ? 1 : 3;
  const total = Number(document.total);
  // מסמך שהופק ללקוח מזדמן אינו מכיל מזהה לקוח, ולכן מאתרים/יוצרים לקוח לצורך הזיכוי.
  const clientId = Number(document.customer_identifier) || await invoice4uFindOrCreateCustomer(environment, token, { name: document.customer_name || "לקוח" });
  const response = await invoice4uRequest(environment, "CreateDocument", {
    token,
    doc: {
      DocumentType: 4,
      DocumentReffType: referenceType,
      ClientID: clientId,
      Subject: reason || `זיכוי מלא למסמך ${document.document_number}`,
      TaxIncluded: true,
      Currency: document.currency || "ILS",
      Invoices: [{ ID: document.invoice4u_id, ReceiptAmount: total }],
      Items: [{ Name: reason || `זיכוי למסמך ${document.document_number}`, Quantity: 1, Price: total }]
    }
  });
  const result = response.CreateDocumentResult || response;
  const errorMessage = invoice4uErrors(result);
  if (errorMessage) return { error: errorMessage };
  const credit = await base44.asServiceRole.entities.FinancialDocument.create({
    document_type: "invoice_credit",
    document_number: String(result.DocumentNumber || ""),
    invoice4u_id: result.ID || "",
    status: "open",
    total: Number(result.Total || total),
    total_without_tax: Number(result.TotalWithoutTax || 0),
    total_tax: Number(result.TotalTaxAmount || 0),
    currency: document.currency || "ILS",
    issue_date: new Date().toISOString(),
    linked_event_id: document.linked_event_id,
    linked_payment_id: document.linked_payment_id,
    customer_name: document.customer_name,
    customer_identifier: String(clientId),
    pdf_original_url: result.PrintOriginalPDFLink || "",
    pdf_certified_url: result.PrintCertifiedCopyPDFLink || "",
    ref_document_id: document.id
  });
  await base44.asServiceRole.entities.FinancialDocument.update(document.id, { status: "fully_credited" });
  return { document: credit };
}

// שלב ב' בביטול מסמך: קבלה שלילית (החזר כספי) לתיעוד יציאת הכסף, בסטנדרט המקובל.
async function createRefundReceipt(base44, environment, token, document, reason) {
  const total = Number(document.total);
  const clientId = Number(document.customer_identifier) || await invoice4uFindOrCreateCustomer(environment, token, { name: document.customer_name || "לקוח" });
  const response = await invoice4uRequest(environment, "CreateDocument", {
    token,
    doc: {
      // 2 = קבלה. סכום שלילי מייצג החזר כספי ללקוח.
      DocumentType: 2,
      ClientID: clientId,
      Subject: reason || `החזר כספי עבור מסמך ${document.document_number}`,
      TaxIncluded: true,
      Currency: document.currency || "ILS",
      Payments: [{ Amount: -total, PaymentType: 1, Date: wcfDate(new Date().toISOString()) }]
    }
  });
  const result = response.CreateDocumentResult || response;
  const errorMessage = invoice4uErrors(result);
  if (errorMessage) return { error: errorMessage };
  const refund = await base44.asServiceRole.entities.FinancialDocument.create({
    document_type: "receipt",
    document_number: String(result.DocumentNumber || ""),
    invoice4u_id: result.ID || "",
    status: "open",
    total: Number(result.Total ?? -total),
    total_without_tax: Number(result.TotalWithoutTax || 0),
    total_tax: Number(result.TotalTaxAmount || 0),
    currency: document.currency || "ILS",
    issue_date: new Date().toISOString(),
    linked_event_id: document.linked_event_id,
    linked_payment_id: document.linked_payment_id,
    customer_name: document.customer_name,
    customer_identifier: String(clientId),
    pdf_original_url: result.PrintOriginalPDFLink || "",
    pdf_certified_url: result.PrintCertifiedCopyPDFLink || "",
    ref_document_id: document.id
  });
  return { document: refund };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
    const { documentId, reason, step } = await req.json();
    if (!documentId) return Response.json({ error: "חסר מזהה מסמך" }, { status: 400 });
    const document = await base44.asServiceRole.entities.FinancialDocument.get(documentId);
    if (!document?.invoice4u_id || !["invoice", "invoice_receipt"].includes(document.document_type)) return Response.json({ error: "לא ניתן לזכות מסמך זה" }, { status: 400 });

    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
    const environment = config.invoice4u_env === "production" ? "production" : "qa";
    const token = invoice4uToken(environment);

    // שלב ב' - קבלה שלילית עבור מסמך שכבר זוכה.
    if (step === "refund_receipt") {
      if (document.status !== "fully_credited") return Response.json({ error: "יש להפיק תחילה חשבונית זיכוי" }, { status: 400 });
      const refund = await createRefundReceipt(base44, environment, token, document, reason);
      if (refund.error) return Response.json({ error: refund.error }, { status: 400 });
      return Response.json({ refundReceipt: refund.document });
    }

    // שלב א' - חשבונית זיכוי מלאה.
    if (document.status === "fully_credited") return Response.json({ error: "המסמך כבר זוכה במלואו" }, { status: 400 });
    const credit = await createCreditDocument(base44, environment, token, document, reason);
    if (credit.error) return Response.json({ error: credit.error }, { status: 400 });
    return Response.json({ creditDocument: credit.document });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}