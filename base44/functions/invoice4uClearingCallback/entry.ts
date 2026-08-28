import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const token = new URL(req.url).searchParams.get("token");
    const form = await req.formData();
    const rawData = form.get("Data");
    const data = typeof rawData === "string" ? JSON.parse(rawData) : null;
    if (!token || !data?.OrderIdClientUsage) return Response.json({ error: "בקשת עדכון לא תקינה" }, { status: 400 });
    const payment = await base44.asServiceRole.entities.Payment.get(data.OrderIdClientUsage);
    if (!payment || payment.invoice4u_callback_token !== token) return Response.json({ error: "בקשת עדכון לא מורשית" }, { status: 403 });
    const successful = String(data.Success).toLowerCase() === "true";
    const update = { payment_status: successful ? "completed" : "failed", invoice4u_clearing_status: successful ? "approved" : (data.ErrorMessage || "declined"), invoice4u_payment_id: data.PaymentId || "", invoice4u_document_number: data.DocumentNumber || "", customer_name_on_card: data.CustomerName || "", client_ip: data.ClientIp || "" };
    if (successful && String(data.DocCreated).toLowerCase() === "true" && !payment.financial_document_id) {
      const document = await base44.asServiceRole.entities.FinancialDocument.create({ document_type: "invoice_receipt", document_number: String(data.DocumentNumber || ""), invoice4u_id: data.DocumentId || "", invoice4u_unique_id: data.UniqueId || "", status: "open", total: Number(data.Amount || payment.amount), currency: payment.currency || "ILS", issue_date: new Date().toISOString(), linked_event_id: payment.event_id, linked_payment_id: payment.id, customer_name: data.CustomerName || "", customer_identifier: data.CustomerId || "", cipher_text: data.CipherText || "", pdf_original_url: data.CipherTextOriginal || "", pdf_certified_url: data.CipherText || "" });
      update.financial_document_id = document.id;
    }
    await base44.asServiceRole.entities.Payment.update(payment.id, update);
    return Response.json({ received: true });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}