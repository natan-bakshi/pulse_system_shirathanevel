// Pure GREEN webhook ACK planning for a FUTURE explicitly approved endpoint.
// IMPORTANT: This module does NOT return an HTTP response, make network calls,
// commit receipts, or authorize any callback. Provider-specific ACK rules MUST
// be verified with a REAL Green beta account before an endpoint is published.
// In particular, do not ACK 200 for any event that may not have been stored
// durably, and do not rely on provider retries to reapply supplier status.
const ORDINARY_MESSAGES=new Set([
 'textMessage','extendedTextMessage','audioMessage','imageMessage',
 'videoMessage','documentMessage','stickerMessage','locationMessage',
 'contactMessage'
]);
export function isVerifiedGreenNonButtonEvent(raw:any,instance:string):boolean{
 return !!raw&&raw.typeWebhook==='incomingMessageReceived'&&
  /^[0-9]{5,20}$/.test(instance||'')&&
  String(raw.instanceData?.idInstance)===instance&&
  raw.instanceData?.typeInstance==='whatsapp'&&
  !!raw.messageData&&typeof raw.messageData==='object'&&
  ORDINARY_MESSAGES.has(raw.messageData.typeMessage)&&
  !('interactiveButtonsResponse' in raw.messageData)&&
  !('templateButtonReplyMessage' in raw.messageData)&&
  !('buttonsResponseMessage' in raw.messageData);
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
 if(result?.stage==='invalid_selection'&&
    result.reason==='recognized_non_button_event'&&
    result.verifiedProviderAndAccount===true)
  return plan('safe_ack_candidate','non_button_event_safely_ignored',true);
 if(result?.stage==='processed'){
  // These are confirmed durable end states from the internal coordinator,
  // not guessed delivery from a provider 2xx response.
  if(result.result==='applied'&&
    ['applied','already_applied'].includes(result.reason))
   return plan('safe_ack_candidate','durable_supplier_transition',true);
  if(result.result==='rejected'&&
    ['business_conflict','not_assigned','stale_assignment'].includes(result.reason))
   return plan('safe_ack_candidate','durable_business_conflict_receipt',true);
  if(result.result==='duplicate'&&result.reason==='provider_event_already_recorded')
   return plan('safe_ack_candidate','durable_duplicate_receipt',true);
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
