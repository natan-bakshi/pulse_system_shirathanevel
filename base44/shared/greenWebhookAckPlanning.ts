// Pure GREEN webhook ACK planning for a FUTURE explicitly approved endpoint.
// This module NEVER returns HTTP, calls a provider, persists receipts or
// authorizes business mutations. The owner approved a BUTTONS-ONLY assignment
// inbox: ordinary manual chat is intentionally not captured here. This does
// NOT disable an existing webhook or other chat consumer. An independently
// verified Green deployment/ACK protocol is still required before publication.
const ORDINARY_MESSAGES=new Set([
 'textMessage','extendedTextMessage','audioMessage','imageMessage',
 'videoMessage','documentMessage','stickerMessage','locationMessage',
 'contactMessage','contactsArrayMessage','quotedMessage','reactionMessage',
 'groupInviteMessage','pollMessage','pollUpdateMessage',
 'editedMessage','deletedMessage','productMessage','orderMessage'
]);
// A future/undocumented selection must NOT be discarded as plain chat.
// Lists are also interactive selections, but are not approved assignment
// actions and therefore must be investigated rather than auto-processed.
const SELECTION_FIELDS=new Set([
 'buttonsResponseMessage','templateButtonReplyMessage',
 'interactiveButtonsResponse','interactiveButtonsReply',
 'listResponseMessage','buttonReplyMessage',
 'selectedButtonId','selectedId'
]);
export function isVerifiedGreenNonButtonEvent(raw:any,instance:string):boolean{
 return !!raw&&raw.typeWebhook==='incomingMessageReceived'&&
  /^[0-9]{5,20}$/.test(instance||'')&&
  String(raw.instanceData?.idInstance)===instance&&
  raw.instanceData?.typeInstance==='whatsapp'&&
  !!raw.messageData&&typeof raw.messageData==='object'&&
  !Array.isArray(raw.messageData)&&
  ORDINARY_MESSAGES.has(raw.messageData.typeMessage)&&
  ![...SELECTION_FIELDS].some(key=>Object.prototype.hasOwnProperty.call(
   raw.messageData,key));
}
export type AckPlan={
 decision:'safe_ack_candidate'|'no_ack_candidate'|'manual_reconcile_candidate';
 reason:string;providerAckNotPublished:true;
 providerHttpStatusNotChosen:true;mayRespond200AfterProviderQa:boolean;
 providerCalls:0;automaticSupplierReplayAllowed:false
};
const plan=(decision:AckPlan['decision'],reason:string,ok=false):AckPlan=>({
 decision,reason,providerAckNotPublished:true,providerHttpStatusNotChosen:true,
 mayRespond200AfterProviderQa:ok,providerCalls:0,
 automaticSupplierReplayAllowed:false
});
export function planFutureGreenWebhookAck(result:any):AckPlan{
 if(result?.stage==='ignored_non_button'&&
    result.reason==='owner_approved_buttons_only_filter'&&
    result.verifiedProviderAndAccount===true&&
    result.assignmentOnlyRoute===true&&result.noDatabaseCalls===true){
  // The user explicitly approved ignoring manual messages in the isolated
  // assignment callback. Authentication + exact account check already ran,
  // and there was no supplier/DB work to persist. The future HTTP endpoint
  // may consider an ACK after real provider QA; it MUST remain isolated from
  // existing independent status/office-chat consumers.
  return plan('safe_ack_candidate','known_non_button_filtered',true);
 }
 if(result?.stage==='processed'){
  // These are confirmed durable end states from the internal coordinator,
  // not guessed delivery from a provider 2xx response.
  if(result.result==='applied'&&
    ['applied','already_applied'].includes(result.reason))
   return plan('safe_ack_candidate','durable_supplier_transition',true);
  if(result.result==='rejected'&&
    ['business_conflict','not_assigned','stale_assignment'].includes(result.reason))
   return plan('safe_ack_candidate','durable_business_conflict_receipt',true);
  // A duplicate provider event is safe ONLY if the full receipt identity
  // matches and the ledger has a CONFIRMED terminal state/result/timestamp.
  // A mere row in pending/processing is not a successful application.
  if(result.result==='duplicate'&&result.reason==='provider_event_already_finalized'&&
    result.terminalReceiptVerified===true&&(
      (result.receiptState==='applied'&&
       ['applied','already_applied'].includes(result.resultCode))||
      (result.receiptState==='rejected'&&
       ['stale_assignment','not_assigned','invalid_assignment',
        'unauthorized_sender','identity_mismatch','business_conflict'].includes(result.resultCode))||
      (result.receiptState==='needs_review'&&result.resultCode==='unknown_after_write')
    ))return plan('safe_ack_candidate','durable_terminal_duplicate',true);
  if(result.result==='duplicate')
   return plan('manual_reconcile_candidate','duplicate_receipt_not_proven_terminal');
  if(result.result==='needs_review'&&result.reason==='unknown_after_write')
   return plan('safe_ack_candidate','durable_manual_review_receipt',true);
  if(result.result==='needs_review'||
    result.result==='held'||
    (result.result==='refused'&&
      ['receipt_registration_unverified','outbox_lookup_unavailable','context_unavailable']
       .includes(result.reason)))
   return plan('manual_reconcile_candidate','business_result_not_confirmed_durable');
  // Unknown/forged button and out-of-date action are NOT positive ACK proofs.
  return plan('no_ack_candidate','unverified_or_unhandled_button');
 }
 if(result?.stage==='rate_guard_refused')
  return plan('no_ack_candidate','rate_limit_or_storage_outage');
 if(result?.stage==='request_refused')
  return plan('no_ack_candidate','failed_request_auth_or_validation');
 return plan('no_ack_candidate','unknown_callback_outcome');
}
