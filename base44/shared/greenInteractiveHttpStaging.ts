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

export async function stageFutureGreenInteractiveHttpCallback(request:any,opts:{
 client:any;rolloutAuthorized:boolean;accountCapabilityVerified:boolean;
 webhookSecret:string;actionSigningSecret:string;expectedInstanceId:string;
 claimOwner:string;recalculateEventStatus:(eventId:string)=>Promise<any>;
 maxPerMinute?:number;now?:number;subtle?:SubtleCrypto;
 // Only a trusted, independently verified owner-approved routing decision;
 // never infer that plain-text messages are disposable merely because they
 // do not alter supplier assignments.
 ordinaryInboundHandlingVerified?:boolean
}){
 const decoded=await decodeFutureGreenInteractiveHttpRequest(request,{
  rolloutAuthorized:opts?.rolloutAuthorized===true,
  accountCapabilityVerified:opts?.accountCapabilityVerified===true,
  webhookSecret:opts?.webhookSecret
 });
 if(!decoded.ok)return {stage:'request_refused',reason:decoded.reason,
  validationHttpStatus:decoded.status,providerCalls:0,businessWritesAuthorized:false};
 const now=opts.now??Date.now();
 // Verify exact Green instance and recognized selection BEFORE any DB query.
 if(!parseGreenButtonSelection(decoded.rawCallback,opts.expectedInstanceId,now)){
  // A verified ordinary text/media event is intentionally ignored BEFORE any
  // DB or Base44 entity calls. Unknown button formats remain unverified; never
  // pretend that a beta callback we cannot parse is a harmless text message.
  const benign=isVerifiedGreenNonButtonEvent(decoded.rawCallback,opts.expectedInstanceId);
  return {stage:'invalid_selection',
   reason:benign?'recognized_non_button_event':'unverified_green_button_shape',
   verifiedProviderAndAccount:benign,
   ordinaryInboundHandlingVerified:opts.ordinaryInboundHandlingVerified===true,
   providerCalls:0,businessWritesAuthorized:false};
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
