// FUTURE optional low-credit edge gate for Shirat HaNevel assignment buttons.
// This is an INTERNAL library, NOT a deployed Cloudflare/Netlify/Base44 route.
// No Deno.serve, no fetch, no timers, no database, no background polling.
// Authenticates the exact Green bearer token & expected instance BEFORE any
// filter decision. Only recognized non-button messages can be suppressed.
// Unknown/changed beta button shapes MUST be investigated, not discarded.
//
// An edge deployment must separately implement verified provider ACK semantics,
// durable forwarding or documented retry-on-unavailable behavior, rate limits,
// appropriate authentication to the downstream Base44 callback, and preserve
// any PRE-EXISTING Green status/office consumers before replacing webhookUrl.
import {decodeFutureGreenInteractiveHttpRequest} from './greenInteractiveHttpBoundary.ts';
import {isVerifiedGreenNonButtonEvent} from './greenWebhookAckPlanning.ts';
import {parseGreenButtonSelection} from './greenInteractiveCallback.ts';

type Route='ignored_non_button'|'forward_verified_button'|
 'forward_unknown_for_review'|'request_refused';
export type EdgeDecision={
 decision:Route;reason:string;
 providerAckNotPublished:true;noDatabaseCalls:true;
 noProviderCalls:true;noBackendInvocationsMade:true;
 requiresBase44Forward:boolean;manualReviewRequired:boolean;
 mayBeAckCandidateAfterGreenQa:boolean;
 // In-memory only. NEVER log or persist raw payloads in an edge gateway.
 callbackForSecureForward?:unknown;
};
function summary(decision:Route,reason:string,forward=false,
 review=false,ack=false,callback?:unknown):EdgeDecision{
 return {decision,reason,providerAckNotPublished:true,
  noDatabaseCalls:true,noProviderCalls:true,noBackendInvocationsMade:true,
  requiresBase44Forward:forward,manualReviewRequired:review,
  mayBeAckCandidateAfterGreenQa:ack,
  ...(forward?{callbackForSecureForward:callback}:{})
 };
}
export async function planGreenButtonsOnlyEdgeIngress(request:any,opts:{
 rolloutAuthorized:boolean;accountCapabilityVerified:boolean;
 webhookSecret:string;expectedInstanceId:string;now?:number
}):Promise<EdgeDecision>{
 const auth=await decodeFutureGreenInteractiveHttpRequest(request,{
  rolloutAuthorized:opts?.rolloutAuthorized===true,
  accountCapabilityVerified:opts?.accountCapabilityVerified===true,
  webhookSecret:opts?.webhookSecret
 });
 if(!auth.ok)return summary('request_refused',auth.reason);
 const raw=auth.rawCallback;
 if(isVerifiedGreenNonButtonEvent(raw,opts.expectedInstanceId))
  return summary('ignored_non_button','known_manual_or_non_button_event',false,false,true);
 // This gate performs routing ONLY. The backend must independently verify
 // original Outbox provider receipt, sender phone, signed button, revision and
 // durable inbox CAS; no button is authorized here.
 if(parseGreenButtonSelection(raw,opts.expectedInstanceId,opts.now??Date.now()))
  return summary('forward_verified_button','button_shape_recognized',true,false,false,raw);
 // A foreign provider instance MUST never be forwarded into our account.
 if(!/^[0-9]{5,20}$/.test(opts.expectedInstanceId||'')||
  String(raw.instanceData?.idInstance)!==opts.expectedInstanceId||
  raw.instanceData?.typeInstance!=='whatsapp')
  return summary('request_refused','foreign_or_unverified_instance');
 // Unknown beta type / stale or malformed button needs a separate secured
 // investigation path; never silently ACK or throw away a potential action.
 return summary('forward_unknown_for_review','unrecognized_green_callback',true,true,false,raw);
}
