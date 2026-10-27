// SIMULATED Green API HTTP ACK contract, NEVER a published HTTP endpoint.
// Official Green documentation expects HTTP 200 promptly; non-200 means
// provider retry (~1 minute, for up to 24h). These are future proposed
// responses for QA; this module MUST NOT call Response.json, fetch, or DB.
//
// Durable exactly-once supplier receipts and known ignored manual chat can
// qualify for 200. UNKNOWN beta formats, transient DB failures, stale locks,
// auth problems and incomplete receipts MUST NOT be falsely ACKed. A real
// endpoint must first prove its actual retry/timeout + unknown-event handling
// with owner-authorized provider QA and a protected review inbox.
import {planFutureGreenWebhookAck} from './greenWebhookAckPlanning.ts';

type Status=200|400|401|404|405|413|415|422|429|503;
export function planFutureGreenWebhookHttpContract(result:any){
 const ack=planFutureGreenWebhookAck(result);
 let status:Status=503;
 let reason='unverified_callback_retry_before_ack';
 if(ack.decision==='safe_ack_candidate'&&ack.mayRespond200AfterProviderQa){
  status=200;reason='safe_finalized_or_intentionally_ignored';
 }else if(result?.stage==='request_refused'){
  const code=result.validationHttpStatus;
  if([400,401,404,405,413,415].includes(code)){
   status=code;reason='request_boundary_rejected';
  }else{status=401;reason='request_auth_or_parse_not_verified';}
 }else if(result?.stage==='qa_sender_outside_scope'){
  status=404;reason='single_chat_qa_outside_scope';
 }else if(result?.stage==='quarantined_unknown'){
  status=503;reason='unknown_button_metadata_review_not_recoverable';
 }else if(result?.stage==='quarantine_unavailable'){
  status=503;reason='unknown_button_quarantine_not_confirmed';
 }else if(result?.stage==='rate_guard_refused'){
  status=429;reason='durable_rate_budget_exceeded_or_unavailable';
 }else if(result?.stage==='invalid_selection'){
  status=422;reason='unsupported_button_shape_requires_review';
 }else if(result?.stage==='processed'&&
   ['held','needs_review'].includes(result.result)){
  status=503;reason='receipt_not_confirmed_durable';
 }else if(result?.stage==='processed'&&result.result==='refused'){
  status=422;reason='unverified_supplier_action';
 }
 return {
  plannedHttpStatus:status,
  planningOnly:true,noHttpResponseSent:true,
  productionEndpointPublished:false,
  greenProviderQaPending:true,
  existingWebhookPreservationPending:true,
  reason,
  acknowledgeCandidate:status===200,
  providerWillLikelyRetry:status!==200,
  retryPolicyMustBeMeasured:true,
  retryHorizonDocumentedHours:24,
  ackRequiresDurabilityProof:status===200,
  noProviderCalls:true,noDatabaseCalls:true,
  neverReplaySupplierMutation:true,
  // No automatic activation from local previews or owner audit reads.
  readyForLiveRollout:false
 };
}
