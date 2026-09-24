import { readAll } from "./eventReadiness.ts";
import { calculateEventBalance } from "./eventBilling.ts";
import { canClose, milestoneState, formatMessage, closingDefaults, roundMoney } from "./agreementRules.ts";
import { sendWhatsAppText, sendWhatsAppFileByUrl } from "./whatsappSend.ts";

export class AgreementError extends Error { status:number; constructor(message,status=400){super(message);this.name="AgreementError";this.status=status;} }
export async function audit(client,a,kind,actor,details={}) {
 return client.entities.AgreementAuditEvent.create({agreement_id:a.id,event_id:a.event_id,kind,actor,at:new Date().toISOString(),details});
}
export async function lockAgreement(client,a,operation,fn) {
 if(a.busy_operation)throw new AgreementError("פעולה בהסכם בטיפול; יש לרענן",409);
 const owner=operation+":"+crypto.randomUUID();
 const claim=await client.entities.EventAgreement.updateMany({id:a.id,revision:a.revision,busy_operation:""},{$set:{busy_operation:owner,revision:a.revision+1}});
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
 await client.entities.InAppNotification.create({user_id:admin.id,user_email:admin.email||"",title,message,template_type:"EVENT_AGREEMENT",is_read:false,is_resolved:false,link:"/EventDetails?id="+a.event_id,related_event_id:a.event_id});
}
// Caller holds the agreement lock. Persist dispatch BEFORE sending; transport uncertainty never auto-retries.
export async function deliver(client,a,kind,key,message,file=null) {
 const prior=await client.entities.ClientMessageDelivery.filter({key},"id",1);
 if(prior.length)return prior[0];
 const row=await client.entities.ClientMessageDelivery.create({agreement_id:a.id,event_id:a.event_id,kind,key,target_masked:"••••"+a.recipient_phone.slice(-4),state:"dispatching",attempted_at:new Date().toISOString()});
 try{
  const result=file?await sendWhatsAppFileByUrl(a.recipient_phone,file.url,file.name,message):await sendWhatsAppText(a.recipient_phone,message);
  return await client.entities.ClientMessageDelivery.update(row.id,{state:"accepted",provider_message_id:result.messageId||"",sent_at:new Date().toISOString()});
 }catch{
  await client.entities.ClientMessageDelivery.update(row.id,{state:"unknown",error:"לא התקבל אישור מהספק. לבדוק לפני שליחה ידנית נוספת."});
  await notifyAgreementAdmin(client,a,"נדרשת בדיקת הודעת לקוח","השליחה לא אושרה. ניתן לראות את מצב ההודעה בכרטיסיית האירוע.");
  throw new AgreementError("לא התקבל אישור שליחה. בדקו את הוואטסאפ לפני שליחה חוזרת.",502);
 }
}
export async function reconcileAgreement(client,eventId,config=null) {
 const event=await client.entities.Event.get(eventId);
 if(!event?.closing_agreement_id)return null;
 let a=await client.entities.EventAgreement.get(event.closing_agreement_id);
 if(!a?.active||!a.signed_at)return a;
 config ||= await settings(client);
 const f=await financials(client,event,config);
 const milestones=await readAll(client.entities.PaymentMilestone,{agreement_id:a.id});
 for(const m of milestones){
  const state=milestoneState(m,f.totalPaid);
  if(m.state!==state)await client.entities.PaymentMilestone.update(m.id,{state});
 }
 const customer=a.customer_id?await client.entities.BillingCustomer.get(a.customer_id):null;
 const card=customer?.active_card_id?await client.entities.StoredCard.get(customer.active_card_id):null;
 const token=!!(card?.state==="active"&&(card.environment==="production"||event.stored_card_qa_only===true)&&card.customer_id===a.customer_id&&card.environment===(config.stored_cards_env==="production"?"production":"qa")&&event.billing_customer_id===a.customer_id);
 const deposit=f.totalPaid+0.005>=a.snapshot.deposit;
 const changes:any={};
 if(a.token_state!==(token?"verified":"pending")){
  const won=await client.entities.EventAgreement.updateMany({id:a.id,token_state:a.token_state},{$set:{token_state:token?"verified":"pending"}});
  if(token&&won.updated===1)await audit(client,a,"token_verified","provider",{card_suffix:card.card_suffix});
 }
 if(a.deposit_state!==(deposit?"paid":"pending")){
  const won=await client.entities.EventAgreement.updateMany({id:a.id,deposit_state:a.deposit_state},{$set:{deposit_state:deposit?"paid":"pending"}});
  if(deposit&&won.updated===1)await audit(client,a,"deposit_paid","system",{amount:a.snapshot.deposit});
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
    if(["cancelled","quote"].includes(event.status)||event.closing_agreement_id!==a.id)return;
    const f=await financials(client,event,config);
    const rows=await readAll(client.entities.PaymentMilestone,{agreement_id:a.id});
    for(const m of rows){
     if(!m.notification_enabled||m.state==="paid"||m.message_state!=="pending"||Date.parse(m.notify_at)>Date.now())continue;
     const outstanding=roundMoney(Math.max(0,m.cumulative_amount-f.totalPaid)); if(!outstanding)continue;
     await client.entities.PaymentMilestone.update(m.id,{message_state:"dispatching"});
     const body=formatMessage(m.template||closingDefaults.closing_message_template,{customer_name:current.recipient_name,event_name:event.event_name,amount:outstanding,currency:a.snapshot.currency,due_date:m.due_date,business_phone:config.business_phone||""});
     try{
      const delivery=await deliver(client,current,"milestone",a.id+":milestone:"+m.id,body);
      await client.entities.PaymentMilestone.update(m.id,{message_state:delivery.state,message_id:delivery.id});
      await audit(client,current,"reminder_accepted","system",{milestone_id:m.id,delivery_id:delivery.id});
      if(current.notifications?.notify_admin)await notifyAgreementAdmin(client,current,"תזכורת תשלום נשלחה",m.label+" — ההודעה התקבלה אצל ספק הוואטסאפ.");
      sent++;
     }catch{await client.entities.PaymentMilestone.update(m.id,{message_state:"unknown"});}
    }
   });
  }catch{console.warn("[agreement] daily item pending");}
 }
 return {checked:agreements.length,sent};
}
