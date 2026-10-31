// Enqueue one acknowledgement reply for an already-durable Green V2 supplier
// reminder click. Uses the EXISTING central WhatsApp Outbox, rate limits,
// idempotency key and sender-account pinning. No direct API request.
// Never sends based only on a caller-supplied event, selected button or
// unverified Outbox admin edit: original ACK proof HMAC must verify.
// Intended to be called AFTER recordVerifiedV2ReminderAcknowledgement.
// Not connected to the production webhook until V2 rollout checks complete.
import {readWhatsAppQueueControl,enqueueWhatsApp} from './whatsappOutbox.ts';
import {verifyV2ReminderAckProof,V2_REMINDER_ACK_FEEDBACK_TEXT} from './whatsappV2ReminderAckProof.ts';
import {whatsappEnqueueReceiptState} from './whatsappReceipt.ts';

const ID=/^[A-Za-z0-9_-]{3,128}$/;
const ACCOUNT=/^[0-9]{5,20}$/;
const CHAT=/^[1-9][0-9]{7,14}@c\.us$/;
const blocked=(reason:string)=>({queued:false,reason,noProviderCalls:true});
export async function enqueueVerifiedV2ReminderAckFeedback(input:{
 client:any;sourceOutboxId:string;signingSecret:string;
 activeGreenInstanceId:string
}):Promise<{queued:boolean;reason:string;outboxId?:string;noProviderCalls:true}>{
 if(!ID.test(input?.sourceOutboxId||'')||
  !ACCOUNT.test(input?.activeGreenInstanceId||'')||
  typeof input?.signingSecret!=='string'||input.signingSecret.length<32)
  return blocked('invalid_trusted_input');
 const db=input.client?.asServiceRole?.entities;
 if(!db?.WhatsAppOutbox?.get||!db?.WhatsAppQueueControl?.filter)
  return blocked('queue_unavailable');
 let source:any,control:any;
 try{
  [source,control]=await Promise.all([
   db.WhatsAppOutbox.get(input.sourceOutboxId),
   readWhatsAppQueueControl(input.client)
  ]);
 }catch{return blocked('source_read_uncertain');}
 if(!source||source.id!==input.sourceOutboxId||
  source.company_id!=='shirat_hanevel'||
  source.source_type!=='event_reminder'||
  source.message_kind!=='supplier_reminder'||
  source.status!=='accepted'||source.provider!=='green'||
  source.requested_provider!=='green'||
  !ACCOUNT.test(source.sender_account_id||'')||
  source.sender_account_id!==input.activeGreenInstanceId||
  !CHAT.test(source.chat_id||'')||
  !ID.test(source.supplier_id||'')||source.supplier_id!==source.recipient_id||
  !ID.test(source.reminder_acknowledgement_event_id||'')||
  !Number.isFinite(Date.parse(source.reminder_acknowledged_at||'')))
  return blocked('origin_untrusted_or_sender_changed');
 if(!(await verifyV2ReminderAckProof(source,input.signingSecret)))
  return blocked('ack_proof_invalid');
 if(control.enabled!==true||control.paused===true)
  return blocked('central_queue_unavailable');
 const feedbackKey='reminder-ack-feedback:'+source.id;
 let receipt:any;
 try{
  receipt=await enqueueWhatsApp(input.client,{
   chatId:source.chat_id,messageType:'text',messageText:V2_REMINDER_ACK_FEEDBACK_TEXT,
   context:{
    sourceType:'reminder_button_feedback',
    sourceId:source.id,idempotencyKey:feedbackKey,
    supplierId:source.supplier_id,
    feedbackSenderAccountId:source.sender_account_id,
    // This verified source is used by enqueueWhatsApp to independently
    // refuse forged feedback requests from any other backend entrypoint.
    reminderAckEvidence:source
   }
  },control);
 }catch{return blocked('enqueue_outcome_uncertain');}
 const state=whatsappEnqueueReceiptState(receipt);
 if(!receipt?.jobId)return blocked('no_durable_feedback_job');
 // The immutable enqueue idempotency key prevents duplicate feedback even
 // if Green redelivers a callback after the business ACK was recorded.
 try{
  const feedback=await db.WhatsAppOutbox.get(receipt.jobId);
  if(!feedback||feedback.idempotency_key!==feedbackKey||
   feedback.source_type!=='reminder_button_feedback'||
   feedback.source_id!==source.id||
   feedback.chat_id!==source.chat_id||
   feedback.requested_provider!=='green'||
   feedback.sender_account_id!==source.sender_account_id)
   return blocked('feedback_outbox_identity_mismatch');
 }catch{return blocked('feedback_identity_read_uncertain');}
 if(!['queued','retry_wait','sending','accepted'].includes(state))
  return blocked('feedback_'+state+'_manual_review');
 return {queued:true,reason:'feedback_durably_queued',outboxId:receipt.jobId,
  noProviderCalls:true};
}
