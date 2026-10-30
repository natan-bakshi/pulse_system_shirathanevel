// Button feedback uses the EXISTING central WhatsApp Outbox. No direct
// provider calls, no new workflow, and no second supplier business mutation.
// Only a terminal receipt created from an authenticated Green button is eligible.
// Historical receipts without feedback_required are intentionally not replayed.
import {enqueueWhatsApp,readWhatsAppQueueControl} from './whatsappOutbox.ts';
import {resolveWhatsAppProvider} from './whatsappProviderConfig.ts';
import {verifyFutureButtonSnapshotMac} from './whatsappButtonBindings.ts';
import {inboundReceiptKey} from './whatsappInteractiveReceipt.ts';
import {parseWhatsAppPhone} from './whatsappPhone.ts';

const ID=/^[A-Za-z0-9_-]{3,160}$/;
const JID=/^[1-9][0-9]{7,14}@c\.us$/;
const COMPANY='shirat_hanevel';
const allowedRejections=new Set([
 'business_conflict','stale_assignment','not_assigned','invalid_assignment',
 'unauthorized_sender','identity_mismatch'
]);
const declined='השיבוץ נדחה בהצלחה וההחלטה נרשמה במערכת. לשינוי נוסף יש להיכנס למערכת Pulse או לפנות למשרד.';
const approved='השיבוץ אושר בהצלחה וההחלטה נרשמה במערכת. תודה! לשינוי נוסף יש להיכנס למערכת Pulse או לפנות למשרד.';
const conflict='לא ניתן לקבל את הלחיצה: פרטי השיבוץ כבר השתנו במערכת. יש לבדוק את המצב העדכני ב־Pulse. שינוי נוסף מתבצע מתוך המערכת או דרך המשרד.';
const failed='הבקשה לא עודכנה במערכת. נא לבדוק את מצב השיבוץ ב־Pulse או לפנות למשרד.';
const reason=(code:string)=>({queued:false,reason:code,noProviderCalls:true});
export function planVerifiedButtonFeedback(receipt:any){
 if(!receipt||receipt.feedback_required!==true||
  !ID.test(receipt.id||'')||receipt.company_id!==COMPANY||
  receipt.provider!=='green'||!['assignment_approve','assignment_reject'].includes(receipt.action)||
  typeof receipt.receipt_key!=='string'||receipt.receipt_key.length>600||
  !Number.isFinite(Date.parse(receipt.completed_at||''))||
  !ID.test(receipt.outbox_job_id||'')||
  !ID.test(receipt.event_service_id||'')||!ID.test(receipt.supplier_id||''))
  return null;
 let message='';
 if(receipt.state==='applied'&&['applied','already_applied'].includes(receipt.result_code))
  message=receipt.action==='assignment_approve'?approved:declined;
 else if(receipt.state==='rejected'&&allowedRejections.has(receipt.result_code))
  message=receipt.result_code==='business_conflict'?conflict:failed;
 else return null; // UNKNOWN, needs_review, pending and forged status are silent.
 return {idempotencyKey:'button-feedback:'+receipt.id,sourceId:receipt.id,
  message};
}
function matchedSource(row:any,job:any,supplier:any){
 if(!row||!job||!supplier||
  row.receipt_key!==inboundReceiptKey({
   provider:row.provider,senderAccountId:row.sender_account_id,
   providerEventId:row.provider_event_id
  })||row.company_id!==COMPANY||
  row.provider!=='green'||job.status!=='accepted'||
  job.source_type!=='assignment_new'||
  job.provider!=='green'||job.requested_provider!=='green'||
  job.id!==row.outbox_job_id||
  job.provider_message_id!==row.provider_message_id||
  job.sender_account_id!==row.sender_account_id||
  job.event_service_id!==row.event_service_id||
  job.supplier_id!==row.supplier_id||
  job.assignment_revision!==row.assignment_revision||
  !JID.test(job.chat_id||'')||
  supplier.id!==row.supplier_id||supplier.is_active===false)
  return false;
 const verifiedNumber=parseWhatsAppPhone(supplier.phone);
 return verifiedNumber.status==='VALID'&&verifiedNumber.chatId===job.chat_id;
}
export async function enqueueVerifiedButtonFeedback(
 client:any,receiptId:string,signingSecret:string
):Promise<{queued:boolean;reason:string;jobId?:string;noProviderCalls:true}>{
 if(!ID.test(receiptId||'')||typeof signingSecret!=='string'||
  signingSecret.length<32)return reason('invalid_receipt_or_signing_context');
 const db=client?.asServiceRole?.entities;
 if(!db?.WhatsAppInboundReceipt?.get||!db?.WhatsAppInboundReceipt?.updateMany||
  !db?.WhatsAppOutbox?.get||!db?.Supplier?.get)
  return reason('verified_feedback_storage_unavailable');
 let row:any;
 try{row=await db.WhatsAppInboundReceipt.get(receiptId);}
 catch{return reason('receipt_read_unavailable');}
 const planned=planVerifiedButtonFeedback(row);
 if(!planned)return reason('receipt_not_terminal_feedback');
 if(row.feedback_outbox_id)return reason('feedback_already_linked');
 // After callback ACK loss, rereads of the exact original + supplier prevent
 // fabricated or unrelated receipts from being converted to outbound messages.
 let job:any,supplier:any,control:any;
 try{
  [job,supplier,control]=await Promise.all([
   db.WhatsAppOutbox.get(row.outbox_job_id),
   db.Supplier.get(row.supplier_id),
   readWhatsAppQueueControl(client)
  ]);
 }catch{return reason('feedback_source_unavailable');}
 if(!control?.enabled)return reason('durable_queue_disabled');
 try{
  if(!matchedSource(row,job,supplier))return reason('feedback_source_not_verified');
 }catch{return reason('feedback_source_not_verified');}
 const frozen=job.interactive_button_bindings_json;
 if(typeof frozen!=='string'||frozen.length>8192)
  return reason('button_snapshot_missing');
 try{
  if(!(await verifyFutureButtonSnapshotMac(frozen,signingSecret)))
   return reason('unverified_button_snapshot');
  const parsed=JSON.parse(frozen);
  if(parsed.jobId!==job.id||parsed.chatId!==job.chat_id||
   parsed.provider!=='green'||parsed.senderAccountId!==job.sender_account_id||
   parsed.revision!==row.assignment_revision||parsed.eventServiceId!==row.event_service_id||
   parsed.supplierId!==row.supplier_id||
   !Array.isArray(parsed.buttons)||!parsed.buttons.some((b:any)=>
    b?.action===row.action))
   return reason('button_action_not_bound_to_source');
 }catch{return reason('unverified_button_snapshot');}
 // Green original and feedback must belong to the same verified sender.
 // The central queue stamps the existing Green provider and account.
 try{
  if(await resolveWhatsAppProvider(client)!=='green')
   return reason('original_green_provider_no_longer_active');
 }catch{return reason('provider_config_unavailable');}
 let queued:any;
 try{
  queued=await enqueueWhatsApp(client,{
   chatId:job.chat_id,messageType:'text',messageText:planned.message,
   context:{
    sourceType:'assignment_button_feedback',
    sourceId:planned.sourceId,idempotencyKey:planned.idempotencyKey,
    eventServiceId:row.event_service_id,supplierId:row.supplier_id,
    feedbackSenderAccountId:row.sender_account_id
   }
  },control);
 }catch{return reason('feedback_enqueue_uncertain');}
 if(!queued?.jobId||!['queued','accepted','retry_wait','sending','unknown','failed'].includes(queued.status))
  return reason('feedback_enqueue_unverified');
 // Its original business identity is never re-used as a send token;
 // source receipt is linked only after durable Outbox identity exists.
 try{
  const current=await db.WhatsAppOutbox.get(queued.jobId);
  if(!current||current.idempotency_key!==planned.idempotencyKey||
   current.source_type!=='assignment_button_feedback'||
   current.source_id!==receiptId||current.chat_id!==job.chat_id||
   current.requested_provider!=='green'||
   current.sender_account_id!==row.sender_account_id)
   return reason('feedback_outbox_origin_unverified');
  const linked=await db.WhatsAppInboundReceipt.updateMany({
   id:row.id,receipt_key:row.receipt_key,state:row.state,
   completed_at:row.completed_at,feedback_outbox_id:row.feedback_outbox_id??null
  },{$set:{feedback_outbox_id:current.id,
   feedback_queued_at:new Date().toISOString()}});
  if(linked?.updated!==1)return reason('feedback_receipt_link_uncertain');
  return {queued:true,reason:'feedback_enqueued_once',jobId:current.id,noProviderCalls:true};
 }catch{return reason('feedback_receipt_link_uncertain');}
}
// Tiny source-only recovery on the EXISTING WhatsApp watchdog. No supplier
// business mutation, no direct provider network and no Cron. Old receipts
// without feedback_required=true are excluded from this scan entirely.
export async function reconcileTerminalButtonFeedback(
 client:any,signingSecret:string,limit=4
){
 const db=client?.asServiceRole?.entities?.WhatsAppInboundReceipt;
 if(!db?.filter||typeof signingSecret!=='string'||signingSecret.length<32)
  return {scanned:0,queued:0,reason:'unavailable'};
 const max=Math.min(6,Math.max(1,Number.isSafeInteger(limit)?limit:4));
 let rows:any[];
 try{rows=await db.filter({
  feedback_required:true,feedback_outbox_id:null,
  state:{$in:['applied','rejected']}
 },'completed_at',max,0,['id']);}
 catch{return {scanned:0,queued:0,reason:'receipt_scan_unavailable'};}
 let count=0;
 for(const row of rows||[]){
  const result=await enqueueVerifiedButtonFeedback(client,row.id,signingSecret);
  if(result.queued)count++;
  if(result.reason==='feedback_enqueue_uncertain'||
   result.reason==='feedback_receipt_link_uncertain')break;
 }
 return {scanned:(rows||[]).length,queued:count,reason:'bounded_reconciliation'};
}
