import { readAll } from "./eventReadiness.ts";
import { CardError } from "./storedCards.ts";
import { assertChargePermission, roundMoney } from "./agreementRules.ts";
import { lockAgreement, deliver, audit } from "./agreementLifecycle.ts";

export async function chargeContext(client,event,customer) {
 if(!event?.closing_agreement_id)throw new CardError("יש להשלים הסכם חתום בנוהל סגירת האירוע לפני גבייה מהכרטיס",409);
 const a=await client.entities.EventAgreement.get(event.closing_agreement_id);
 if(!a?.active||!a.signed_at||a.customer_id!==customer.id||event.billing_customer_id!==customer.id)throw new CardError("אין הסכם חתום פעיל המשויך ללקוח ולאירוע",409);
 if(a.busy_operation)throw new CardError("פעולה בהסכם בטיפול; יש לרענן",409);
 const milestones=await readAll(client.entities.PaymentMilestone,{agreement_id:a.id});
 const notices=await readAll(client.entities.AgreementChargeNotice,{agreement_id:a.id});
 return {a,milestones,notices};
}
export async function authorizeCharge(client,event,customer,body,f) {
 const ctx=await chargeContext(client,event,customer),a=ctx.a;
 if(body.agreementHash!==a.content_hash)throw new CardError("יש לקרוא ולאשר את ההרשאה החתומה העדכנית",409);
 if(event.status==="cancelled")throw new CardError("לא ניתן לחייב אירוע שבוטל במסלול זה",409);
 if(f.currency!==a.snapshot.currency||Math.abs(f.finalTotal-a.snapshot.total)>0.01||event.event_date!==a.snapshot.event_date)throw new CardError("פרטי האירוע השתנו מאז החתימה; נדרשת גרסה מוסכמת מעודכנת",409);
 const kind=body.chargeKind==="exceptional"?"exceptional":"regular";
 const milestone=ctx.milestones.find(m=>m.id===body.milestoneId);
 const exceptionalPaid=roundMoney(f.payments.filter(p=>p.charge_type==="exceptional"&&p.payment_status!=="failed"&&p.payment_status!=="cancelled").reduce((s,p)=>s+Number(p.amount||0),0));
 try {assertChargePermission({snapshot:a.snapshot,accepted:a.signature?.accepted,kind,amount:roundMoney(body.amount),paid:f.totalPaid,exceptionalPaid,milestone});}
 catch(e){throw new CardError(e.message,409);}
 if(kind==="exceptional"){
  if(!String(body.description||"").trim())throw new CardError("יש לציין את סיבת החיוב החריג");
  if(a.snapshot.exceptional_notice){
   const n=ctx.notices.find(n=>n.id===body.noticeId);
   if(!n||n.state!=="accepted"||n.amount!==roundMoney(body.amount)||n.reason!==String(body.description).trim().slice(0,300)||Date.parse(n.available_at)>Date.now())throw new CardError("נדרשת הודעה מקדימה והמתנה לפי המדיניות החתומה",409);
   const used=await client.entities.StoredCardOperation.filter({notice_id:n.id},"id",100);
   if(used.some(o=>o.state!=="failed"&&o.id!==body.currentOperationId))throw new CardError("הודעה זו כבר שימשה לפעולת גבייה; יש לבדוק את התוצאה",409);
  }
 }
 return {...ctx,kind,milestone};
}
export async function createChargeNotice(client,event,customer,body,user) {
 const {a}=await chargeContext(client,event,customer);
 if(body.agreementHash!==a.content_hash||!a.signature?.accepted?.exceptional)throw new CardError("אין אישור תואם להסכם",409);
 const amount=roundMoney(body.amount),reason=String(body.description||"").trim().slice(0,300);
 if(!Number.isFinite(amount)||amount<=0||amount>a.snapshot.exceptional_cap||!reason)throw new CardError("נדרש סכום בגבול התקרה וסיבה");
 return lockAgreement(client,a,"charge_notice",async current=>{
  const available=new Date(Date.now()+Number(a.snapshot.exceptional_notice_days||0)*86400000).toISOString();
  const message="שלום "+a.recipient_name+", בהתאם להסכם עבור "+a.snapshot.event_name+", נדרש תשלום חריג של "+amount+" "+a.snapshot.currency+" בגין: "+reason+". ניתן לשלם באמצעי חלופי עד "+new Date(available).toLocaleString("he-IL",{timeZone:"Asia/Jerusalem"})+". לאחר מועד זה ניתן לבצע חיוב ידני בכרטיס לפי ההרשאה החתומה, בתוספת עמלת הסליקה לפי ההסכם.";
  const n=await client.entities.AgreementChargeNotice.create({agreement_id:a.id,event_id:event.id,customer_id:customer.id,amount,reason,available_at:available,state:"dispatching",message,created_by_user_id:user.id});
  try{
   const d=await deliver(client,current,"exceptional_notice","notice:"+n.id,message);
   await client.entities.AgreementChargeNotice.update(n.id,{state:d.state});
   await audit(client,a,"exceptional_notice",user.id,{notice_id:n.id,amount,available_at:available});
   return {...n,state:d.state};
  }catch(e){await client.entities.AgreementChargeNotice.update(n.id,{state:"unknown"});throw e;}
 });
}
