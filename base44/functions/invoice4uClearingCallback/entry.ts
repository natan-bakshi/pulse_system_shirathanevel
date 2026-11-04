import { afterAgreementChange } from "../../shared/agreementLifecycle.ts";
import { completeAgreementDeposit } from "../../shared/agreementDeposit.ts";
import { afterCardRelevantChange } from "../../shared/storedCards.ts";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { notifyAdminsClearingResult } from "../../shared/billingNotifications.ts";
import { renderClientMessage, sendClientMessage } from "../../shared/clientBillingMessages.ts";
import { ensureHostedPaymentInvoice, deliverHostedPaymentDocument, HOSTED_INVOICE_MODE } from "../../shared/hostedPaymentInvoice.ts";

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    let token = new URL(req.url).searchParams.get("token");
    // Invoice4U שולח form-data עם שדה Data, אך יש חשבונות ששולחים JSON ישר.
    const contentType = req.headers.get("content-type") || "";
    let data = null;
    let documentUrl = "";
    if (contentType.includes("json")) {
      const body = await req.json();
      data = typeof body?.Data === "string" ? JSON.parse(body.Data) : (body?.Data || body);
      if (!token && body?.token) token = body.token;
    } else {
      const form = await req.formData();
      const rawData = form.get("Data");
      data = typeof rawData === "string" ? JSON.parse(rawData) : null;
    }
    if (!token || !data?.OrderIdClientUsage) return Response.json({ error: "בקשת עדכון לא תקינה" }, { status: 400 });
    const payment = await base44.asServiceRole.entities.Payment.get(data.OrderIdClientUsage);
    if (!payment || payment.invoice4u_callback_token !== token) return Response.json({ error: "בקשת עדכון לא מורשית" }, { status: 403 });
    const successful = String(data.Success).toLowerCase() === "true";
    if(payment.agreement_id){
      // The agreement flow independently verifies the exact clearing-log
      // amount before marking the deposit completed. The old early return
      // skipped EVERY customer invoice / receipt notification.
      const agreementResult=await completeAgreementDeposit(base44.asServiceRole,payment,data);
      if(successful){
        const confirmed=await base44.asServiceRole.entities.Payment.get(payment.id);
        if(confirmed?.auto_invoice_mode===HOSTED_INVOICE_MODE && confirmed.agreement_verified===true){
          try{
            const issued=await ensureHostedPaymentInvoice(base44,confirmed);
            if(issued.state==="issued" && issued.document){
              const settings=await base44.asServiceRole.entities.AppSettings.list();
              const config=Object.fromEntries(settings.map(x=>[x.setting_key,x.setting_value]));
              try{await deliverHostedPaymentDocument(base44,confirmed,issued.document,config);}
              catch{console.warn("[ClearingCallback] agreement invoice message requires review");}
            }else console.warn("[ClearingCallback] agreement invoice not yet confirmed:",issued.state);
          }catch{
            console.error("[ClearingCallback] agreement invoice issuance requires reconciliation");
            // The provider has already collected the card charge; a retry
            // should re-enter the DOCUMENT path only, never charge the card.
            return Response.json({received:true,invoice_pending:true},{status:503});
          }
        }
      }
      return Response.json(agreementResult);
    }
    const update = { payment_status: successful ? "completed" : "failed", invoice4u_clearing_status: successful ? "approved" : (data.ErrorMessage || "declined"), invoice4u_payment_id: data.PaymentId || "", invoice4u_document_number: data.DocumentNumber || payment.invoice4u_document_number || "", customer_name_on_card: data.CustomerName || "", client_ip: data.ClientIp || "", auth_number: String(data.AuthNumber || data.ConfirmationNumber || ""), card_suffix: String(data.CardSuffix || data.CardNumber || "").slice(-4) };
    if (successful && String(data.DocCreated).toLowerCase() === "true" && !payment.financial_document_id) {
      // Legacy provider-created documents retain their existing flow; link
      // an already mirrored document on callback replay, without duplicating.
      const existing=await base44.asServiceRole.entities.FinancialDocument.filter({linked_payment_id:payment.id},"-created_date",2);
      const document=existing[0] || await base44.asServiceRole.entities.FinancialDocument.create({ document_type: "invoice_receipt", document_number: String(data.DocumentNumber || ""), invoice4u_id: data.DocumentId || "", invoice4u_unique_id: data.UniqueId || "", status: "open", total: Number(data.Amount || payment.amount), currency: payment.currency || "ILS", issue_date: new Date().toISOString(), linked_event_id: payment.event_id, linked_payment_id: payment.id, customer_name: data.CustomerName || "", customer_identifier: data.CustomerId || "", cipher_text: data.CipherText || "", pdf_original_url: data.CipherTextOriginal ? `https://newview.invoice4u.co.il/Views/PDF.aspx?cipher=${data.CipherTextOriginal}` : "", pdf_certified_url: data.CipherText ? `https://newview.invoice4u.co.il/Views/PDF.aspx?cipher=${data.CipherText}` : "" });
      update.financial_document_id = document.id;
      documentUrl = document.pdf_original_url || document.pdf_certified_url || "";
    }
    await base44.asServiceRole.entities.Payment.update(payment.id, update);
    let newInvoiceHandled=false;
    if(successful && payment.auto_invoice_mode===HOSTED_INVOICE_MODE){
      const confirmed=await base44.asServiceRole.entities.Payment.get(payment.id);
      try{
        const issued=await ensureHostedPaymentInvoice(base44,confirmed);
        if(issued.state==="issued" && issued.document){
          newInvoiceHandled=true;
          documentUrl=issued.document.pdf_original_url||issued.document.pdf_certified_url||"";
          const settings=await base44.asServiceRole.entities.AppSettings.list();
          const config=Object.fromEntries(settings.map(x=>[x.setting_key,x.setting_value]));
          try{await deliverHostedPaymentDocument(base44,confirmed,issued.document,config);}
          catch{console.warn("[ClearingCallback] customer invoice message requires review");}
        }else console.warn("[ClearingCallback] hosted invoice pending:",issued.state);
      }catch{
        console.error("[ClearingCallback] hosted invoice issuance requires reconciliation");
        return Response.json({received:true,invoice_pending:true},{status:503});
      }
    }

    // אישור תשלום ללקוח (וואטסאפ, ובהיעדר טלפון - אימייל) עם קישור לקבלה.
    if (successful && !newInvoiceHandled && payment.auto_invoice_mode!==HOSTED_INVOICE_MODE && payment.is_interested_in_invoice!==false && documentUrl) {
      try {
        const settings = await base44.asServiceRole.entities.AppSettings.list();
        const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
        if (config.client_payment_receipt_enabled !== "false") {
          const language = payment.document_language === "en" ? "en" : "he";
          const businessName = config.business_name || config.company_name || "המערכת";
          const currencySymbol = payment.currency === "USD" ? "$" : "₪";
          const body = renderClientMessage(config, "receipt", language, {
            name: payment.payer_name || data.CustomerName || "",
            business_name: businessName,
            amount: `${currencySymbol}${(Number(payment.amount || 0)+Number(payment.processing_fee_amount||0)).toLocaleString()}`,
            document_url: documentUrl
          });
          await sendClientMessage(base44, {
            phone: payment.payer_phone,
            email: payment.payer_email,
            subject: language === "en" ? `Payment confirmation - ${businessName}` : `אישור תשלום - ${businessName}`,
            body,
            businessName,
            idempotencyKey:'payment-receipt:'+payment.id
          });
        }
      } catch (receiptError) { console.warn(`[ClearingCallback] client receipt failed: ${receiptError.message}`); }
    }

    // התראת מנהלים על תוצאת הסליקה (מוצלחת או נכשלה) לפי תבניות המערכת.
    // סליקה כללית אינה משויכת לאירוע ולכן אינה מפעילה תבנית מבוססת-אירוע.
    try {
      if (!payment.event_id) return Response.json({ received: true });
      const event = await base44.asServiceRole.entities.Event.get(payment.event_id);
      if (successful && event?.billing_customer_id) await afterCardRelevantChange(base44, [event]);
      await notifyAdminsClearingResult(base44, {
        templateType: successful ? "PAYMENT_CLEARED_SUCCESS" : "PAYMENT_CLEARED_FAILED",
        event,
        payment: { ...payment, ...update },
        extra: { error_message: successful ? "" : (data.ErrorMessage || "") }
      });
    } catch (notifyError) { console.warn(`[ClearingCallback] notify failed: ${notifyError.message}`); }

    return Response.json({ received: true });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}