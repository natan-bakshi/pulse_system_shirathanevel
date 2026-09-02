import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { invoice4uErrors, invoice4uFindOrCreateCustomer, invoice4uRequest, invoice4uToken } from "../../shared/invoice4uClient.ts";
import { buildDocumentBody, documentRequirements, documentTypeLabels, round2, standaloneDocumentTypes, summarizeItems } from "../../shared/invoice4uDocuments.ts";

// הפקת מסמך פיננסי עצמאי (ללא תלות בתשלום קיים) מלשונית התשלומים.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const { documentType, customer = {}, items = [], payments = [], linkedEventId, subject, comments } = await req.json();
    if (!standaloneDocumentTypes.includes(documentType)) return Response.json({ error: "סוג מסמך לא נתמך" }, { status: 400 });

    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
    if (config.billing_enabled !== "true") return Response.json({ error: "מודול החיוב אינו פעיל" }, { status: 403 });

    const customerName = String(customer.name || "").trim();
    if (!customerName) return Response.json({ error: "נדרש שם לקוח עבור המסמך" }, { status: 400 });

    const requirements = documentRequirements(documentType);
    const cleanItems = items
      .filter((item) => String(item?.name || "").trim() && Number(item?.price) !== 0)
      .map((item) => ({ name: String(item.name).trim(), quantity: Number(item.quantity) || 1, price: round2(item.price), taxRate: item.taxRate }));
    const cleanPayments = payments
      .filter((payment) => Number(payment?.amount) > 0)
      .map((payment) => ({ amount: round2(payment.amount), type: payment.type || "cash", date: payment.date || new Date().toISOString().slice(0, 10) }));

    if (requirements.needsItems && cleanItems.length === 0) return Response.json({ error: "נדרשת לפחות שורת פריט אחת למסמך זה" }, { status: 400 });
    if (requirements.needsPayments && cleanPayments.length === 0) return Response.json({ error: "נדרש לפחות תשלום אחד למסמך זה" }, { status: 400 });

    const vatPercent = Number(config.vat_rate) || 18;
    const environment = config.invoice4u_env === "production" ? "production" : "qa";
    const token = invoice4uToken(environment);
    const label = documentTypeLabels[documentType];
    const docSubject = String(subject || "").trim() || label;

    const clientId = requirements.needsRegisteredCustomer
      ? await invoice4uFindOrCreateCustomer(environment, token, { name: customerName, email: customer.email || "", phone: customer.phone || "", identifier: customer.identifier || "" })
      : null;

    const response = await invoice4uRequest(environment, "CreateDocument", {
      token,
      doc: buildDocumentBody({
        slug: documentType,
        subject: docSubject,
        currency: customer.currency || "ILS",
        items: cleanItems,
        payments: cleanPayments,
        customer: { ...customer, name: customerName },
        clientId,
        comments: comments || config.default_email_comment || "",
        associatedEmails: customer.email ? [customer.email] : [],
        vatPercent
      })
    });
    const result = response.CreateDocumentResult || response;
    const errorMessage = invoice4uErrors(result);
    if (errorMessage) return Response.json({ error: errorMessage }, { status: 400 });

    const fallback = summarizeItems(cleanItems, vatPercent);
    const paidTotal = cleanPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const document = await base44.asServiceRole.entities.FinancialDocument.create({
      document_type: documentType,
      document_number: String(result.DocumentNumber || ""),
      invoice4u_id: result.ID || "",
      status: "open",
      total: Number(result.Total || (requirements.needsItems ? fallback.total : paidTotal)),
      total_without_tax: Number(result.TotalWithoutTax || fallback.totalWithoutTax),
      total_tax: Number(result.TotalTaxAmount || fallback.totalTax),
      currency: customer.currency || "ILS",
      issue_date: new Date().toISOString(),
      linked_event_id: linkedEventId || "",
      customer_name: customerName,
      customer_identifier: customer.identifier || String(result.ClientID || ""),
      pdf_original_url: result.PrintOriginalPDFLink || "",
      pdf_certified_url: result.PrintCertifiedCopyPDFLink || "",
      cipher_text: result.CipherTextOriginal || result.CipherText || ""
    });

    return Response.json({ document });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}