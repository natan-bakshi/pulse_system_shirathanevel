// Internal, unexposed Green API HTTP-to-business staging harness.
// NOT registered with Deno.serve; does not choose an HTTP ACK status.
// A live callback endpoint must be independently reviewed after real Green
// account beta QA, exact provider response samples, owner rollout approval,
// and a documented 2xx/4xx/5xx ACK/retry contract. No automatic replay.
// Security order: rollout gate -> method/size/auth/JSON decode -> provider
// shape/account validation -> bounded durable rate budget -> original signed
// Outbox + supplier identity + durable receipt CAS + business transition.
// The default disabled path touches no database and never reads request body.
import {decodeFutureGreenInteractiveHttpRequest} from './greenInteractiveHttpBoundary.ts';
import {parseGreenButtonSelection} from './greenInteractiveCallback.ts';
import {reserveVerifiedGreenInboundBudget} from './whatsappInboundRateBudget.ts';
import {processFutureGreenButtonCallback} from './greenInteractiveCallbackCoordinator.ts';
import {isVerifiedGreenNonButtonEvent} from './greenWebhookAckPlanning.ts';
import {isEligibleUnknownGreenCallback,registerUnknownGreenCallbackQuarantine} from './greenUnknownCallbackQuarantine.ts';

export async function stageFutureGreenInteractiveHttpCallback(request:any,opts:{
 client:any;rolloutAuthorized:boolean;accountCapabilityVerified:boolean;
 webhookSecret:string;actionSigningSecret:string;expectedInstanceId:string;
 claimOwner:string;recalculateEventStatus:(eventId:string)=>Promise<any>;
 // Only trusted single-chat QA config may supply this, never webhook JSON.
 qaChatId?:string;qaEventServiceId?:string;qaPreviousEventServiceId?:string;
 qaSupplierId?:string;
 maxPerMinute?:number;now?:number;subtle?:SubtleCrypto;
 // ONLY from trusted server configuration after owner retention/purge review.
 // Undefined by default: zero recoverable payloads are stored.
 encryptedUnknownRecovery?:{ownerRetentionApproved:boolean;
  encryptionKey:string;keyId:string}
}){
 const decoded=await decodeFutureGreenInteractiveHttpRequest(request,{
  rolloutAuthorized:opts?.rolloutAuthorized===true,
  accountCapabilityVerified:opts?.accountCapabilityVerified===true,
  webhookSecret:opts?.webhookSecret
 });
 if(!decoded.ok)return {stage:'request_refused',reason:decoded.reason,
  validationHttpStatus:decoded.status,providerCalls:0,businessWritesAuthorized:false};
 const now=opts.now??Date.now();
 // Single-chat QA must NEVER be able to apply actions for an unrelated
 // supplier, even if their callback carries a plausible signed identifier.
 // Return without DB/Outbox/receipt access. The provider's other messages
 // must stay on its existing webhook/office route, not this QA function.
 if(opts.qaChatId!==undefined){
  if(!/^[1-9][0-9]{7,14}@c\.us$/.test(opts.qaChatId)||
    decoded.rawCallback?.senderData?.chatId!==opts.qaChatId)
   return {stage:'qa_sender_outside_scope',reason:'qa_sender_not_allowed',
    providerCalls:0,businessWritesAuthorized:false};
 }
 // Verify exact Green instance and recognized selection BEFORE any DB query.
 if(!parseGreenButtonSelection(decoded.rawCallback,opts.expectedInstanceId,now)){
  // Owner-approved policy: ONLY an authenticated, account-matched Green
  // button click enters the assignment engine. Known text/quoted/media,
  // reactions and non-button provider notifications are ignored entirely in
  // this ISOLATED future handler, without a DB query, queue job or WhatsApp
  // action. Contact-office is a wa.me URL, not an inbound approval callback.
  // Unknown beta types are NOT guessed to be manual messages: they remain
  // unrecognized so a new button shape cannot be silently lost on rollout.
  if(isVerifiedGreenNonButtonEvent(decoded.rawCallback,opts.expectedInstanceId))
   return {stage:'ignored_non_button',reason:'owner_approved_buttons_only_filter',
    verifiedProviderAndAccount:true,assignmentOnlyRoute:true,
    noDatabaseCalls:true,providerCalls:0,businessWritesAuthorized:false};
  // An independently authenticated, account-matched PRIVATE incoming event
  // with a currently unknown format may be a new Beta button shape. Admit
  // bounded metadata ONLY through a separate durable CAS quarantine and
  // owner review. Unknown content is NEVER interpreted as approval, and even
  // a durably recorded metadata marker is NOT a provider ACK: the raw event
  // was intentionally not stored, so a future parser cannot safely replay it.
  if(isEligibleUnknownGreenCallback(decoded.rawCallback,opts.expectedInstanceId,now)){
   const unknownBudget=await reserveVerifiedGreenInboundBudget(opts.client,{
    authenticated:true,trustedRolloutEnabled:true,
    maxPerMinute:opts.maxPerMinute,now
   });
   if(!unknownBudget.allowed)return {stage:'rate_guard_refused',
    reason:unknownBudget.reason,retryAfterSeconds:unknownBudget.retryAfterSeconds,
    providerCalls:0,businessWritesAuthorized:false};
   try{
    const recorded=await registerUnknownGreenCallbackQuarantine(
     opts.client,decoded.rawCallback,{
      expectedInstanceId:opts.expectedInstanceId,
      fingerprintSecret:opts.actionSigningSecret,now,subtle:opts.subtle,
      encryptedRecovery:opts.encryptedUnknownRecovery
     });
    return {stage:'quarantined_unknown',reason:'unknown_button_requires_manual_review',
     quarantineRecorded:true,quarantineKind:recorded.kind,
     encryptedRecoveryRecorded:recorded.encryptedRecoveryRecorded,
     canAcknowledge:false,manualReviewRequired:true,
     providerCalls:0,businessWritesAuthorized:false};
   }catch{
    return {stage:'quarantine_unavailable',reason:'unknown_callback_not_confirmed_stored',
     manualReviewRequired:true,providerCalls:0,businessWritesAuthorized:false};
   }
  }
  return {stage:'invalid_selection',reason:'unverified_green_button_shape',
   verifiedProviderAndAccount:false,providerCalls:0,
   businessWritesAuthorized:false};
 }
 const budget=await reserveVerifiedGreenInboundBudget(opts.client,{
  authenticated:true,trustedRolloutEnabled:true,maxPerMinute:opts.maxPerMinute,now
 });
 if(!budget.allowed)return {stage:'rate_guard_refused',reason:budget.reason,
  retryAfterSeconds:budget.retryAfterSeconds,providerCalls:0,
  businessWritesAuthorized:false};
 const result=await processFutureGreenButtonCallback({
  client:opts.client,headers:decoded.headers,rawCallback:decoded.rawCallback,
  callbackByteLength:decoded.callbackByteLength,
  expectedInstanceId:opts.expectedInstanceId,webhookSecret:opts.webhookSecret,
  actionSigningSecret:opts.actionSigningSecret,
  trustedRolloutEnabled:true,accountCapabilityVerified:true,
  claimOwner:opts.claimOwner,recalculateEventStatus:opts.recalculateEventStatus,
  qaEventServiceId:opts.qaEventServiceId,
  qaPreviousEventServiceId:opts.qaPreviousEventServiceId,
  qaSupplierId:opts.qaSupplierId,
  now,subtle:opts.subtle
 });
 return {stage:'processed',result:result.status,reason:result.reason,
  ...(result.status==='duplicate'?{
    terminalReceiptVerified:('terminalReceiptVerified' in result &&
      result.terminalReceiptVerified===true),
    receiptState:('receiptState' in result?result.receiptState:undefined),
    resultCode:('resultCode' in result?result.resultCode:undefined)
  }:{}),
  providerCalls:0,businessWritesAuthorized:result.supplierWritesAuthorized};
}
