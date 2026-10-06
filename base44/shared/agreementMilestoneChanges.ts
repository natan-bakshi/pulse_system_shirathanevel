import { readAll } from './eventReadiness.ts';
import { validateMilestones, effectiveMilestones, roundMoney, milestoneState, canonical, digest } from './agreementRules.ts';
import { AgreementError, financials, audit, reconcileAgreement } from './agreementLifecycle.ts';
import { reminderTime } from './agreementReminderTime.ts';

export async function milestoneEditPreview(client,a,config){
 const event=await client.entities.Event.get(a.event_id);
 if(!a.active||event?.closing_agreement_id!==a.id||event.status==='cancelled')throw new AgreementError('ניתן לערוך רק אבני דרך של הסכם פעיל',409);
 const f=await financials(client,event,config);
 if(f.currency!==a.snapshot.currency||Math.abs(f.finalTotal-a.snapshot.total)>0.01)throw new AgreementError('מחיר האירוע או המטבע השתנו; נדרשת גרסה מוסכמת מעודכנת',409);
 const rows=effectiveMilestones(a,await readAll(client.entities.PaymentMilestone,{agreement_id:a.id}));
 const sourceHash=await digest(canonical({rows:rows.map(m=>({id:m.id,amount:m.amount,due_date:m.due_date,cumulative_amount:m.cumulative_amount})),totalPaid:f.totalPaid,revision:a.payment_schedule?.revision||0}));
 return {rows,sourceHash,totalPaid:f.totalPaid,total:a.snapshot.total,currency:f.currency,pendingPayments:f.payments.some(p=>p.payment_status==='pending')};
}

export function validateBeneficialMilestones(previous,input,total,paid){
 if(!Array.isArray(input)||input.length!==previous.length||input.some((m,i)=>m?.id!==previous[i].id))throw new AgreementError('יש לשמור על אבני הדרך הקיימות ועל סדרן');
 if(paid>total+0.005)throw new AgreementError('סך אבני הדרך לא יכול להיות נמוך מהסכום שכבר התקבל באירוע');
 let validated;
 try{validated=validateMilestones(input.map((m,i)=>({label:previous[i].label,amount:m.amount,due_date:m.due_date})),total);}catch(e){throw new AgreementError(e.message);}
 for(let i=0;i<validated.length;i++){
  const m=validated[i],old=previous[i];
  if(m.cumulative_amount>Number(old.cumulative_amount)+0.005)throw new AgreementError('לא ניתן להגדיל את הסכום המצטבר של תשלום מוקדם; מותר רק לגלגל סכומים קדימה');
  if(m.cumulative_amount+0.005<Math.min(paid,Number(old.cumulative_amount)))throw new AgreementError('לא ניתן להפחית את הסכום המצטבר מתחת לתשלום שכבר נקלט עבור אבן הדרך');
  if(m.due_date<old.due_date)throw new AgreementError('לא ניתן להקדים מועד תשלום; מותר רק לדחות אותו');
 }
 return validated.map((m,i)=>({...m,id:previous[i].id}));
}

// Caller holds the same agreement lock used by reminders and charges.
export async function updateAgreementMilestones(client,a,body,user,config){
 const p=await milestoneEditPreview(client,a,config);
 if(body.sourceHash!==p.sourceHash)throw new AgreementError('אבני הדרך או התשלומים השתנו. יש לסגור ולפתוח שוב את העריכה',409);
 if(p.pendingPayments)throw new AgreementError('קיימת בקשת תשלום בבירור. יש להשלים או לבטל אותה לפני שינוי אבני הדרך',409);
 const next=validateBeneficialMilestones(p.rows,body.rows,p.total,p.totalPaid);
 const n=a.notifications||{},revision=(Number(a.payment_schedule?.revision)||0)+1;
 const rows=next.map(m=>({...m,notify_at:reminderTime(m.due_date,Number(n.days)||0,n.time||'09:00')}));
 // A single agreement write commits the authoritative schedule. The signed snapshot is never rewritten.
 await client.entities.EventAgreement.update(a.id,{payment_schedule:{revision,rows,updated_at:new Date().toISOString(),updated_by:user.id,paid_at_update:p.totalPaid}});
 const updates=rows.map((m,i)=>{
  const old=p.rows[i],changed=m.amount!==old.amount||m.due_date!==old.due_date;
  const state=milestoneState(m,p.totalPaid);
  return {...m,state,notification_enabled:!!n.enabled,template:n.template||old.template||'',message_state:state==='paid'?'skipped_paid':changed?'pending':old.message_state,message_id:changed?'':old.message_id||''};
 });
 await client.entities.PaymentMilestone.bulkUpdate(updates);
 await audit(client,a,'milestones_updated',user.id,{revision,total_paid:p.totalPaid,before:p.rows.map(m=>({id:m.id,amount:m.amount,cumulative_amount:m.cumulative_amount,due_date:m.due_date})),after:rows});
 await reconcileAgreement(client,a.event_id,config);
 return {success:true,revision,rows,totalPaid:p.totalPaid};
}