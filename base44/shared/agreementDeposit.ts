import { secrets } from "base44:runtime";
import { verifyLog, isTrue } from "./storedCardProvider.ts";
import { AgreementError, afterAgreementChange, audit } from "./agreementLifecycle.ts";
// Callback is authenticated by its per-payment token in the caller. Only provider-read calls occur here.
export async function completeAgreementDeposit(client,payment,data=null) {
 if(payment.agreement_verified){await afterAgreementChange(client,payment.event_id);return {received:true};}
 if(data){
  if(!isTrue(data.Success)){
   await client.entities.Payment.update(payment.id,{invoice4u_clearing_status:"pending_provider_review"});
   return {received:true,pending_verification:true};
  }
  const callback={
   PaymentId:String(data.PaymentId||""),ClearingTraceId:String(data.ClearingTraceId||""),
   DocumentId:String(data.DocumentId||""),DocumentNumber:String(data.DocumentNumber||""),
   DocCreated:isTrue(data.DocCreated),CipherTextOriginal:String(data.CipherTextOriginal||""),
   CipherText:String(data.CipherText||""),AuthNumber:String(data.AuthNumber||data.ConfirmationNumber||""),
   CardSuffix:String(data.CardSuffix||data.CardNumber||"").slice(-4)
  };
  if(!callback.PaymentId&&!callback.ClearingTraceId)throw new AgreementError("חסר מזהה עסקה לאימות",409);
  payment=await client.entities.Payment.update(payment.id,{agreement_callback:callback});
 }
 const d=payment.agreement_callback;
 if(!d)throw new AgreementError("טרם התקבל מזהה עסקה מהספק. אין ליצור תשלום נוסף לפני בירור.",409);
 const env=payment.agreement_environment;
 if(!["qa","production"].includes(env))throw new AgreementError("סביבת תשלום חסרה",409);
 const event=await client.entities.Event.get(payment.event_id);
 if(env==="qa"&&event.stored_card_qa_only!==true)throw new AgreementError("תשלום בדיקה אינו מאשר אירוע אמיתי",409);
 const key=secrets.get(env==="qa"?"INVOICE4U_API_TOKEN_QA":"INVOICE4U_API_TOKEN");
 if(!key)throw new AgreementError("מפתח אימות אינו זמין",503);
 await verifyLog({environment:env,key,purpose:"hosted"},{paymentId:d.PaymentId,traceId:d.ClearingTraceId,amount:Number(payment.amount)+Number(payment.processing_fee_amount||0),currency:payment.currency},payment.created_date);
 // Lock only local accounting, never a financial request. Stale local processing can safely be resumed.
 if(payment.agreement_callback_busy&&Date.parse(payment.agreement_callback_started_at)<Date.now()-300000){
  await client.entities.Payment.updateMany({id:payment.id,agreement_callback_started_at:payment.agreement_callback_started_at,agreement_verified:false},{$set:{agreement_callback_busy:false}});
 }
 const owner=crypto.randomUUID();
 const claim=await client.entities.Payment.updateMany({id:payment.id,agreement_verified:false,agreement_callback_busy:{$ne:true}},{$set:{agreement_callback_busy:true,agreement_callback_owner:owner,agreement_callback_started_at:new Date().toISOString()}});
 if(claim.updated!==1)return {received:true,pending_verification:true};
 try{
  payment=await client.entities.Payment.get(payment.id);
  let documentId=payment.financial_document_id||"";
  if(d.DocCreated&&d.DocumentId&&!documentId){
   const existing=await client.entities.FinancialDocument.filter({linked_payment_id:payment.id},"id",2);
   if(existing.length>1)throw new AgreementError("נדרש בירור מסמכים לתשלום",409);
   const document=existing[0]||await client.entities.FinancialDocument.create({
    document_type:"invoice_receipt",document_number:d.DocumentNumber,invoice4u_id:d.DocumentId,status:"open",
    total:Number(payment.amount)+Number(payment.processing_fee_amount||0),currency:payment.currency,
    issue_date:new Date().toISOString(),linked_event_id:payment.event_id,linked_payment_id:payment.id,
    customer_name:payment.payer_name||"",cipher_text:d.CipherText,
    pdf_original_url:d.CipherTextOriginal?"https://newview.invoice4u.co.il/Views/PDF.aspx?cipher="+encodeURIComponent(d.CipherTextOriginal):"",
    pdf_certified_url:d.CipherText?"https://newview.invoice4u.co.il/Views/PDF.aspx?cipher="+encodeURIComponent(d.CipherText):""
   });documentId=document.id;
  }
  await client.entities.Payment.update(payment.id,{payment_status:"completed",agreement_verified:true,invoice4u_clearing_status:"approved",
   invoice4u_payment_id:d.PaymentId,invoice4u_document_number:d.DocumentNumber,financial_document_id:documentId,auth_number:d.AuthNumber,card_suffix:/^\d{4}$/.test(d.CardSuffix)?d.CardSuffix:""});
  const a=await client.entities.EventAgreement.get(payment.agreement_id);
  if(a)await audit(client,a,"deposit_verified","provider",{payment_id:payment.id,amount:payment.amount});
  await afterAgreementChange(client,payment.event_id);
  return {received:true,verified:true};
 }finally{
  await client.entities.Payment.updateMany({id:payment.id,agreement_callback_owner:owner},{$set:{agreement_callback_busy:false,agreement_callback_owner:""}});
 }
}
