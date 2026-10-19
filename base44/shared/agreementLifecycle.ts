import { readAll } from "./eventReadiness.ts";
import { loadMilestonePaymentBalance } from "./milestonePaymentBalance.ts";
import { calculateEventBalance } from "./eventBilling.ts";
import { canClose, milestoneState, formatMessage, closingDefaults, roundMoney, firstCompletedPayment, effectiveDeposit, effectiveMilestones, milestoneDeliveryKey } from "./agreementRules.ts";
import { sendWhatsAppText, sendWhatsAppFileByUrl, sendWhatsAppFileUri } from "./whatsappSend.ts";
import {agreementDeliveryStatus,agreementDeliverySafeErrorLabel,agreementDeliveryErrorCode,agreementReceiptPatch} from "./agreementDeliverySafety.ts";

export class AgreementError extends Error { status:number; constructor(message,status=400){super(message);this.name="AgreementError";this.status=status;} }
export async function audit(client,a,kind,actor,details={}) {
 return client.entities.AgreementAuditEvent.create({agreement_id:a.id,event_id:a.event_id,kind,actor,at:new Date().toISOString(),details});
}
export async function lockAgreement(client,a,operation,fn) {
 if(a.busy_operation)throw new AgreementError("פעולה בהסכם בטיפול; יש לרענן",409);
 const owner=operation+":"+crypto.randomUUID();
 const claim=await client.entities.EventAgreement.updateMany({id:a.id,revision:a.revision,busy_operation:""},{$set:{busy_operation:owner,busy_started_at:new Date().toISOString(),revision:a.revision+1}});
 if(claim.updated!==1)throw new AgreementError("ההסכם השתנה; יש לרענן",409);
 try{return await fn(await client.entities.EventAgreement.get(a.id));}
 finally{await client.entities.EventAgreement.updateMany({id:a.id,busy_operation:owner},{$set:{busy_operation:""}});}
}
export async function settings(client) {return Object.fromEntries((await readAll(client.entities.AppSettings)).map(x=>[x.setting_key,x.setting_value]));}
export async function financials(client,event,config) {
 const [services,payments]=await Promise.all([readAll(client.entities.EventService,{event_id:event.id}),readAll(client.entities.Payment,{event_id:event.id})]);
 return {...calculateEventBalance(event,services,payments,(Number(config.vat_rate)||18)/100,Number(config.usd_ils_exchange_rate)||3.6),services,payments};
}
export async function notifyAgreementAdmin(client,a,title,message) {
 const admin=await client.entities.User.get(a.created_by_user_id);
 if(admin?.role!=="admin")return;
 // One active actionable failure per agreement event. Other agreement
 // notifications (OTP, payments) are not suppressed or combined.
 if(title==='נדרשת בדיקת תור הודעות לקוח'){
  const existing=await client.entities.InAppNotification.filter({user_id:admin.id,related_event_id:a.event_id,template_type:'EVENT_AGREEMENT',title,is_resolved:false},'-created_date',1);
  if(existing.length)return existing[0];
 }
 await client.entities.InAppNotification.create({user_id:admin.id,user_email:admin.email||"",title,message,template_type:"EVENT_AGREEMENT",is_read:false,is_resolved:false,link:"/EventDetails?id="+a.event_id,related_event_id:a.event_id});
}
// Caller holds the agreement lock. Enqueue once; the worker records provider acceptance asynchronously.
export async function deliver(client,a,kind,key,message,file=null,config={},backendClient:any=null) {
 if(kind==="milestone"){
  const prefix=a.id+":milestone:";
  if(!key.startsWith(prefix))throw new AgreementError("מזהה תזכורת תשלום לא תקין");
  const balance=await loadMilestonePaymentBalance(client,a.event_id,key.slice(prefix.length).split(":schedule:")[0],config);
  if(!Number.isFinite(Date.parse(balance.milestone.notify_at))||Date.parse(balance.milestone.notify_at)>Date.now())return {id:"",state:"deferred"};
  if(balance.milestone.agreement_id!==a.id)throw new AgreementError("אבן הדרך אינה שייכת להסכם");
  if(!balance.shouldSend)return {id:"",state:balance.paid?"skipped_paid":"skipped_inactive",balance};
  // Render using the fresh outstanding balance, not the earlier loop's snapshot.
  message=formatMessage(balance.milestone.template||closingDefaults[a.notifications?.language==="en"?"closing_message_template_en":"closing_message_template"],{customer_name:a.recipient_name,event_name:(await client.entities.Event.get(a.event_id)).event_name,amount:balance.outstanding,currency:balance.currency,due_date:balance.milestone.due_date,business_phone:config.business_phone||""});
 }
 const db=client.entities;
 const linkedOutbox=async(row:any)=>{
  // The first enqueue may have committed even if its HTTP response, or the
  // subsequent ClientMessageDelivery update, failed. Never create a second
  // Outbox job merely because our status mirror was stale.
  const found=await db.WhatsAppOutbox.filter({idempotency_key:key},'-created_date',2);
  if(!found.length)return null;
  const job=found[0];
  // This is an authoritative persisted Outbox row, not a send() receipt.
  // Some receipts require queued=true, while persisted records only have
  // status='queued'; never misclassify a committed job as UNKNOWN.
  const patch=agreementReceiptPatch({
    success:true,status:job.status,
    queued:['queued','sending','retry_wait'].includes(String(job.status)),
    jobId:job.id,messageId:job.provider_message_id||''
  },new Date().toISOString());
  try{return await db.ClientMessageDelivery.update(row.id,patch);}
  catch{
    console.warn('[AgreementDelivery] outbox linked; delivery mirror update pending');
    return {...row,...patch};
  }
 };
 const prior=await db.ClientMessageDelivery.filter({key},"id",1);
 if(prior.length){
   if(prior[0].state==='accepted')return prior[0];
   // READ ONLY reconciliation from the existing Outbox; NO transport or retry.
   try{return await linkedOutbox(prior[0])||prior[0];}
   catch{return prior[0];}
 }
 const row=await client.entities.ClientMessageDelivery.create({agreement_id:a.id,event_id:a.event_id,kind,key,target_masked:"••••"+a.recipient_phone.slice(-4),state:"dispatching",attempted_at:new Date().toISOString()});
 const context={sourceType:'agreement',sourceId:a.id,idempotencyKey:key,clientMessageDeliveryId:row.id,
  expiresAt:kind==='verification'?new Date(Date.now()+600000).toISOString():kind==='invitation'?(a.link_expires_at||''):''};
 // Agreement database calls are scoped to asServiceRole. Transport calls
 // require the root backend-client shape, including asServiceRole.entities.
 // Prefer the actual authenticated request backend when available, rather
 // than a simulated root wrapper around a service-role proxy. Daily/cron
 // callers continue using the backwards-compatible service-role adapter.
 const waBackend=backendClient?.asServiceRole?.entities
   ?backendClient
   :client?.asServiceRole?.entities?client:{asServiceRole:client};
 let receipt:any;
 try{
  receipt=file?(file.uri?await sendWhatsAppFileUri(a.recipient_phone,file.uri,file.name,message,waBackend,context):await sendWhatsAppFileByUrl(a.recipient_phone,file.url,file.name,message,waBackend,context)):await sendWhatsAppText(a.recipient_phone,message,waBackend,context);
 }catch(error){
  // Classify WITHOUT persisting raw errors (may include sensitive URLs or
  // provider responses). A thrown enqueue request is not proof that storage
  // did not commit: check the SAME Outbox business key first.
  const reason=agreementDeliveryErrorCode(error);
  console.error('[AgreementDelivery] queue did not confirm',reason);
  let recovered=null,lookupFailed=false;
  try{recovered=await linkedOutbox(row);}
  catch{lookupFailed=true;}
  if(recovered)return recovered; // Found committed record; no duplicate send.
  let queueEnabled:null|boolean=null;
  try{
    const controls=await db.WhatsAppQueueControl.filter({control_key:'global'},'-created_date',2);
    if(controls.length===1)queueEnabled=controls[0].enabled===true;
  }catch{}
  // If Outbox could not be inspected or queue was in legacy-direct mode,
  // absence of a job cannot prove the provider was not contacted.
  const ambiguous=lookupFailed||queueEnabled!==true||(error as any)?.deliveryUncertain===true;
  const code=lookupFailed?'QUEUE_LOOKUP_UNAVAILABLE':reason;
  const safeText=agreementDeliverySafeErrorLabel(code);
  await db.ClientMessageDelivery.update(row.id,{
    state:ambiguous?'unknown':'failed',error:safeText,error_code:code,
    failure_phase:ambiguous?'unverified':'enqueue_not_confirmed'
  });
  try{await notifyAgreementAdmin(client,a,"נדרשת בדיקת תור הודעות לקוח",
    "שליחת ההודעה לא אושרה: "+safeText+" נא לבדוק את היסטוריית התור לפני שליחה חוזרת.");}
  catch{console.warn('[AgreementDelivery] failure notification could not be recorded');}
  throw new AgreementError(safeText+
    (ambiguous?" תוצאת השליחה אינה ודאית. אין לשלוח שוב לפני בירור.":" ההודעה לא נקלטה בתור."),
    502);
 }
 // A deduplicated Outbox job may have status UNKNOWN/FAILED. queued=false
 // alone must NEVER be interpreted as supplier acceptance.
 const patch=agreementReceiptPatch(receipt,new Date().toISOString());
 if(!['queued','accepted'].includes(patch.state)){
   try{await notifyAgreementAdmin(client,a,"נדרשת בדיקת תור הודעות לקוח",
     "קיימת רשומת WhatsApp במצב "+patch.state+". נדרש בירור לפני שליחה נוספת.");}
   catch{console.warn('[AgreementDelivery] ambiguous delivery alert pending');}
 }
 try{return await db.ClientMessageDelivery.update(row.id,patch);}
 catch{
  console.warn('[AgreementDelivery] receipt persistence pending; outbox receipt remains authoritative');
  return {...row,...patch};
 }
}
export async function reconcileAgreement(client,eventId,config=null) {
 const event=await client.entities.Event.get(eventId);
 if(!event)return null;
 // Only an explicit administrator waiver permits payment-only closing.
 if(event.status==="quote"&&!event.closing_manual_override&&event.closing_payment_only_approved===true&&event.closing_payment_only_approved_by){
  const cfg=config||await settings(client),f=await financials(client,event,cfg);
  if(f.totalPaid>0){
   await client.entities.Event.updateMany({id:event.id,status:"quote",updated_date:event.updated_date,closing_payment_only_approved:true},{$set:{status:"confirmed"}});
  }
  return null;
 }
 if(!event.closing_agreement_id)return null;
 let a=await client.entities.EventAgreement.get(event.closing_agreement_id);
 if(!a?.active||!a.signed_at)return a;
 config ||= await settings(client);
 const f=await financials(client,event,config);
 const milestones=effectiveMilestones(a,await readAll(client.entities.PaymentMilestone,{agreement_id:a.id}));
 for(const m of milestones){
  const state=milestoneState(m,f.totalPaid);
  if(m.state!==state)await client.entities.PaymentMilestone.update(m.id,{state});
 }
 const customer=a.customer_id?await client.entities.BillingCustomer.get(a.customer_id):null;
 const card=customer?.active_card_id?await client.entities.StoredCard.get(customer.active_card_id):null;
 const token=!!(card?.state==="active"&&(card.environment==="production"||event.stored_card_qa_only===true)&&card.customer_id===a.customer_id&&card.environment===(config.stored_cards_env==="production"?"production":"qa")&&event.billing_customer_id===a.customer_id);
 const received=firstCompletedPayment(f.payments,f.currency,Number(config.usd_ils_exchange_rate)||3.6);
 // A verified first payment satisfies the deposit requirement, without changing signed terms.
 const deposit=a.require_deposit?f.totalPaid+0.005>=effectiveDeposit(a):false;
 const depositState=a.require_deposit?(deposit?"paid":"pending"):"waived";
 if(a.deposit_received!==received)await client.entities.EventAgreement.update(a.id,{deposit_received:received});
 const changes:any={};
 if(a.token_state!==(token?"verified":"pending")){
  const won=await client.entities.EventAgreement.updateMany({id:a.id,token_state:a.token_state},{$set:{token_state:token?"verified":"pending"}});
  if(token&&won.updated===1)await audit(client,a,"token_verified","provider",{card_suffix:card.card_suffix});
 }
 if(a.deposit_state!==depositState){
  const won=await client.entities.EventAgreement.updateMany({id:a.id,deposit_state:a.deposit_state},{$set:{deposit_state:depositState}});
  if(deposit&&won.updated===1)await audit(client,a,"deposit_paid","system",{amount:received});
 }
 const ready=canClose({signed:!!a.signed_at,requireToken:a.require_token,token,requireDeposit:a.require_deposit,depositPaid:deposit,active:a.active});
 // The signed financial scope must still match. Later edits require a new agreed version.
 const unchanged=f.currency===a.snapshot.currency&&Math.abs(f.finalTotal-a.snapshot.total)<0.01&&event.event_date===a.snapshot.event_date;
 if(ready&&unchanged&&!a.closing_applied&&!event.closing_manual_override){
  if(event.status==="quote"){
   const saved=await client.entities.Event.updateMany({id:event.id,status:"quote",closing_agreement_id:a.id,updated_date:event.updated_date},{$set:{status:"confirmed"}});
   if(saved.updated===1){changes.closing_applied=true;changes.completed_at=new Date().toISOString();changes.state="completed";await audit(client,a,"event_closed","system");}
  }else if(["confirmed","in_progress"].includes(event.status)){changes.closing_applied=true;changes.state="completed";changes.completed_at=new Date().toISOString();}
 }
 if(Object.keys(changes).length)a=await client.entities.EventAgreement.update(a.id,changes);
 return await client.entities.EventAgreement.get(a.id);
}
export async function afterAgreementChange(client,eventId) {
 try {if(eventId)await reconcileAgreement(client,eventId);}
 catch{console.warn("[agreement] reconciliation pending");}
}
export async function processAgreementMilestones(client,config) {
 const agreements=await readAll(client.entities.EventAgreement,{active:true});
 let sent=0;
 for(let a of agreements){
  if(!a.signed_at||a.busy_operation)continue;
  try{
   await reconcileAgreement(client,a.event_id,config);
   a=await client.entities.EventAgreement.get(a.id);
   await lockAgreement(client,a,"reminders",async current=>{
    const event=await client.entities.Event.get(a.event_id);
    if(event.status==="cancelled"||(event.status==="quote"&&event.closing_manual_override)||event.closing_agreement_id!==a.id)return;
    const rows=effectiveMilestones(current,await readAll(client.entities.PaymentMilestone,{agreement_id:a.id}));
    for(const m of rows){
     if((!a.require_deposit&&m.position===0)||!m.notification_enabled||m.state==="paid"||m.message_state!=="pending"||Date.parse(m.notify_at)>Date.now())continue;
     const balance=await loadMilestonePaymentBalance(client,event.id,m.id,config);
     if(!balance.shouldSend){if(balance.paid)await client.entities.PaymentMilestone.update(m.id,{state:"paid",message_state:"skipped_paid"});continue;}
     const outstanding=balance.outstanding;
     await client.entities.PaymentMilestone.update(m.id,{message_state:"dispatching"});
     const body=formatMessage(m.template||closingDefaults[current.notifications?.language==="en"?"closing_message_template_en":"closing_message_template"],{customer_name:current.recipient_name,event_name:event.event_name,amount:outstanding,currency:a.snapshot.currency,due_date:m.due_date,business_phone:config.business_phone||""});
     try{
      const delivery=await deliver(client,current,"milestone",milestoneDeliveryKey(current,m),body,null,config);
      if(delivery.state==="deferred"){await client.entities.PaymentMilestone.update(m.id,{message_state:"pending"});continue;}
      if(delivery.state==="skipped_paid"||delivery.state==="skipped_inactive"){
       await client.entities.PaymentMilestone.update(m.id,{message_state:delivery.state,...(delivery.state==="skipped_paid"?{state:"paid"}:{})});continue;
      }
      if(!["queued","accepted"].includes(delivery.state)){
       await client.entities.PaymentMilestone.update(m.id,{message_state:"unknown",message_id:delivery.id});
       continue; // Prior failed/unknown row is not evidence of a new delivery.
      }
      await client.entities.PaymentMilestone.update(m.id,{message_state:delivery.state,message_id:delivery.id});
      await audit(client,current,delivery.state==="accepted"?"reminder_accepted":"reminder_queued","system",
       {milestone_id:m.id,delivery_id:delivery.id});
      if(current.notifications?.notify_admin)await notifyAgreementAdmin(client,current,
       delivery.state==="accepted"?"תזכורת תשלום התקבלה אצל הספק":"תזכורת תשלום נשמרה בתור",
       m.label+(delivery.state==="accepted"?" — הספק קיבל את ההודעה.":" — ממתינה לאישור ספק WhatsApp."));
      sent++;
     }catch{await client.entities.PaymentMilestone.update(m.id,{message_state:"unknown"});}
    }
   });
  }catch{console.warn("[agreement] daily item pending");}
 }
 return {checked:agreements.length,sent};
}