import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets } from "base44:runtime";
import { invoice4uErrors, invoice4uRequest } from "../../shared/invoice4uClient.ts";

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
    const { documentId, reason } = await req.json();
    if (!documentId) return Response.json({ error: "חסר מזהה מסמך" }, { status: 400 });
    const document = await base44.asServiceRole.entities.FinancialDocument.get(documentId);
    if (!document?.invoice4u_id || !["invoice", "invoice_receipt"].includes(document.document_type)) return Response.json({ error: "לא ניתן לזכות מסמך זה" }, { status: 400 });
    if (document.status === "fully_credited") return Response.json({ error: "המסמך כבר זוכה במלואו" }, { status: 400 });
    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
    const environment = config.invoice4u_env === "production" ? "production" : "qa";
    const referenceType = document.document_type === "invoice" ? 1 : 3;
    const total = Number(document.total);
    const response = await invoice4uRequest(environment, "CreateDocument", { token: secrets.get("INVOICE4U_API_TOKEN"), doc: { DocumentType: 4, DocumentReffType: referenceType, ClientID: Number(document.customer_identifier), Subject: reason || `זיכוי מלא למסמך ${document.document_number}`, TaxIncluded: true, Currency: document.currency || "ILS", Invoices: [{ ID: document.invoice4u_id, ReceiptAmount: total }], Items: [{ Name: reason || `זיכוי למסמך ${document.document_number}`, Quantity: 1, Price: total }] } });
    const result = response.CreateDocumentResult || response;
    const errorMessage = invoice4uErrors(result);
    if (errorMessage) return Response.json({ error: errorMessage }, { status: 400 });
    const credit = await base44.asServiceRole.entities.FinancialDocument.create({ document_type: "invoice_credit", document_number: String(result.DocumentNumber || ""), invoice4u_id: result.ID || "", status: "open", total: Number(result.Total || total), total_without_tax: Number(result.TotalWithoutTax || 0), total_tax: Number(result.TotalTaxAmount || 0), currency: document.currency || "ILS", issue_date: new Date().toISOString(), linked_event_id: document.linked_event_id, linked_payment_id: document.linked_payment_id, customer_name: document.customer_name, customer_identifier: document.customer_identifier, pdf_original_url: result.PrintOriginalPDFLink || "", pdf_certified_url: result.PrintCertifiedCopyPDFLink || "", ref_document_id: document.id });
    await base44.asServiceRole.entities.FinancialDocument.update(document.id, { status: "fully_credited" });
    return Response.json({ creditDocument: credit });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}