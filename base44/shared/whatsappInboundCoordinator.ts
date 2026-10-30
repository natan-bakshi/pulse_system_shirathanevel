// INTERNAL integration boundary for a future explicitly activated WhatsApp
// callback endpoint. It is NOT exported as a Base44 function or scheduled.
// Never run against real messages before provider-account QA and owner rollout.
// Every effect follows: provider+binding+identity admission -> durable receipt
// -> one-owner claim -> ONE EventService CAS -> event readiness -> terminal audit.
// A committed write with lost response NEVER triggers a repeat mutation.
import {preflightWhatsAppAssignmentResponse} from './whatsappInboundAdmission.ts';
import {registerVerifiedInboundReceipt,claimPendingInboundReceipt,
 finishInboundReceipt,inspectVerifiedInboundReplay} from './whatsappInboundInbox.ts';
import {persistAuthorizedSupplierStatus} from './supplierStatusPersistence.ts';
import {wakeExistingCalendarSyncAfterSupplierDecision} from './calendarSyncStatusWake.ts';
import {enqueueVerifiedButtonFeedback} from './whatsappButtonFeedback.ts';
import {assignmentDecisionForAction} from './whatsappInteractiveActionRegistry.ts';

const preflightRefused=(reason:string)=>({status:'refused',reason,
 providerCalls:0,supplierWritesAuthorized:false});
async function feedbackAfterVerifiedTerminal(client:any,receiptId:string,secret:string){
 try{
  const outcome=await enqueueVerifiedButtonFeedback(client,receiptId,secret);
  if(!outcome.queued&&outcome.reason!=='feedback_already_linked')
   console.warn('[WhatsAppInbound] Button feedback pending reconciliation');
 }catch{
  // An acknowledged business decision must never be replayed or turned into
  // a provider error because its supplementary feedback enqueue failed.
  console.warn('[WhatsAppInbound] Button feedback requires reconciliation');
 }
}
export type InboundOutcome='refused'|'duplicate'|'held'|'applied'|'rejected'|'needs_review';
type InboundResult={status:InboundOutcome;reason:string;providerCalls:0;
 supplierWritesAuthorized:boolean;terminalReceiptVerified?:boolean;
 receiptState?:string;resultCode?:string};
export async function processVerifiedWhatsAppAssignmentResponse(input:{
 providerEvent:any;client:any;trustedRolloutEnabled:boolean;
 providerCapabilityVerified:boolean;claimOwner:string;
 recalculateEventStatus:(eventId:string)=>Promise<any>
}):Promise<InboundResult>{
 if(input?.trustedRolloutEnabled!==true||input?.providerCapabilityVerified!==true)
  return preflightRefused('rollout_disabled');
 if(typeof input.claimOwner!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(input.claimOwner)||
  typeof input.recalculateEventStatus!=='function')
  return preflightRefused('invalid_trusted_callback_context');
 // Does ALL required provider authentication, signed action, original Outbox
 // receipt, sender account, registered supplier and current intent checks.
 const admission=await preflightWhatsAppAssignmentResponse(
  input.providerEvent,input.client?.asServiceRole);
 let safeLateActionReceipt:any=null;
 if(!admission.admissible){
  // Only a credential-verified, HMAC-bound original provider message and
  // authenticated supplier may produce this candidate. A changed assignment
  // is NOT sufficient proof of duplicate: check the exact durable receipt.
  // One projected read ONLY on these historical/retry paths, not every new
  // callback. There is never another business CAS from this branch.
  if('verifiedReplayCandidate' in admission && admission.verifiedReplayCandidate){
   try{
    const prior=await inspectVerifiedInboundReplay(
     input.client,admission.verifiedReplayCandidate);
    if(prior.kind==='finalized')
     return {status:'duplicate',reason:'provider_event_already_finalized',
      terminalReceiptVerified:true,receiptState:prior.receiptState,
      resultCode:prior.resultCode,
      providerCalls:0,supplierWritesAuthorized:false};
    if(prior.kind==='not_terminal')
     return {status:'held',reason:'existing_receipt_not_finalized',
      providerCalls:0,supplierWritesAuthorized:false};
    if(prior.kind==='identity_conflict'||prior.kind==='unverifiable')
     return {status:'held',reason:'existing_receipt_needs_reconciliation',
      providerCalls:0,supplierWritesAuthorized:false};
    // The original signed provider message was verified, but the supplier
    // already resolved THIS revision. A NEW distinct provider event must
    // become a terminal rejected receipt instead of triggering Green retries.
    // No supplier CAS is authorized on this branch.
    if(prior.kind==='not_found'&&
       'verifiedTerminalRejectionCandidate' in admission&&
       admission.verifiedTerminalRejectionCandidate===true)
      safeLateActionReceipt=admission.verifiedReplayCandidate;
   }catch{
    return {status:'held',reason:'existing_receipt_lookup_unverified',
     providerCalls:0,supplierWritesAuthorized:false};
   }
  }
  if(!safeLateActionReceipt)return preflightRefused(admission.reason);
 }
 const record=safeLateActionReceipt||
  ('receipt' in admission?admission.receipt:null);
 if(!record)return preflightRefused('receipt_identity_unavailable');
 let registered;
 try{registered=await registerVerifiedInboundReceipt(input.client,record);}
 catch{return preflightRefused('receipt_registration_unverified');}
 if(registered.kind==='duplicate'){
  // The business state could still look pending after an already terminal
  // rejection or an incomplete receipt. An existing row is NEVER sufficient
  // evidence to send HTTP ACK. Verify its full identity + durable terminal
  // state via a bounded read, without touching the supplier or claiming it.
  try{
   const prior=await inspectVerifiedInboundReplay(input.client,record);
   if(prior.kind==='finalized')
    return {status:'duplicate',reason:'provider_event_already_finalized',
     terminalReceiptVerified:true,receiptState:prior.receiptState,
     resultCode:prior.resultCode,
     providerCalls:0,supplierWritesAuthorized:false};
   return {status:'held',reason:prior.kind==='not_found'?
    'existing_receipt_lookup_unverified':'existing_receipt_not_finalized',
    providerCalls:0,supplierWritesAuthorized:false};
  }catch{return {status:'held',reason:'existing_receipt_lookup_unverified',
   providerCalls:0,supplierWritesAuthorized:false};}
 }
 if(!registered.processAllowed)
  return {status:'held',reason:'receipt_not_newly_pending',
   providerCalls:0,supplierWritesAuthorized:false};
 let claim;
 try{
  claim=await claimPendingInboundReceipt(input.client,{
   receiptId:registered.id,receiptKey:registered.receiptKey,
   claimOwner:input.claimOwner
  });
 }catch{
  return {status:'needs_review',reason:'receipt_claim_unverified',
   providerCalls:0,supplierWritesAuthorized:false};
 }
 if(!claim?.claimed)
  return {status:'held',reason:claim?.reason||'receipt_claim_unverified',
   providerCalls:0,supplierWritesAuthorized:false};

 if(safeLateActionReceipt){
  // A verified but late, different button press is a durable *business*
  // rejection, not a second decision. ACK only after terminal receipt CAS.
  try{
   const done=await finishInboundReceipt(input.client,{
    receiptId:registered.id,receiptKey:registered.receiptKey,
    claimOwner:input.claimOwner,outcome:'rejected',
    resultCode:'business_conflict'
   });
   if(done?.finalized){
    await feedbackAfterVerifiedTerminal(input.client,registered.id,
     input.providerEvent.actionSigningSecret);
    return {status:'rejected',reason:'business_conflict',
     providerCalls:0,supplierWritesAuthorized:false};
   }
  }catch{}
  return {status:'needs_review',reason:'late_receipt_finalization_unverified',
   providerCalls:0,supplierWritesAuthorized:false};
 }

 // After CAS claim, all failures must be reflected on the receipt if safe.
 // Incomplete terminal writes remain 'processing', and expiry triggers
 // operator review; the system NEVER auto-claims expired processing jobs.
 let outcome:'applied'|'rejected'|'needs_review'='needs_review';
 let resultCode='unknown_after_write';
 let supplierWritesAuthorized=false;
 try{
  const status=assignmentDecisionForAction(record.action);
  if(!status)throw Object.assign(Error('Invalid inbound action'),{code:'invalid_assignment'});
  supplierWritesAuthorized=true;
  const changed=await persistAuthorizedSupplierStatus(
   input.client.asServiceRole,{
    eventServiceId:record.eventServiceId,supplierId:record.supplierId,
    newStatus:status,source:'whatsapp',expectedRevision:record.revision
   });
  // The business CAS may have committed. A subsequent failure to recalculate
  // readiness must NEVER cause the supplier CAS to be run again.
  if(changed.kind==='changed'){
   await input.recalculateEventStatus(changed.eventId);
   // WhatsApp CAS does not fire the previous EventService UPDATE trigger.
   // Retain the existing Calendar pipeline; no direct Google call is made
   // inside the provider's callback. Calendar failures cannot replay CAS.
   const wake=await wakeExistingCalendarSyncAfterSupplierDecision(
    input.client.asServiceRole,record.eventServiceId);
   if(!wake.requested)
    console.warn('[WhatsAppInbound] Calendar wake outcome uncertain');
  }
  outcome='applied';resultCode=changed.kind==='unchanged'?'already_applied':'applied';
 }catch(error){
  // Only strictly known validation/concurrency rejection is safe to conclude
  // as NOT applied. All provider/network/DB failures are ambiguous even when
  // a caller believes the operation failed before commit.
  const code=String((error as any)?.code||'');
  const known=new Set(['stale_assignment_revision','stale_legacy_assignment',
   'legacy_assignment_not_pending','assignment_intent_inactive',
   'assignment_intent_not_ready','stale_or_invalid_supplier_transition',
   'assignment_changed_concurrently','supplier_not_assigned',
   'external_service','invalid_assignment','invalid_supplier_status_record',
   'invalid_decline_history']);
  if(known.has(code)){
   outcome='rejected';resultCode=code==='supplier_not_assigned'?'not_assigned':
    'business_conflict';
  }
 }
 try{
  const done=await finishInboundReceipt(input.client,{
   receiptId:registered.id,receiptKey:registered.receiptKey,
   claimOwner:input.claimOwner,outcome,resultCode
  });
  if(done?.finalized){
   if(outcome==='applied'||outcome==='rejected'||
      (outcome==='needs_review'&&resultCode==='unknown_after_write'))
    await feedbackAfterVerifiedTerminal(input.client,registered.id,
     input.providerEvent.actionSigningSecret);
   return {status:outcome,reason:resultCode,providerCalls:0,supplierWritesAuthorized};
  }
 }catch{}
 // Business state may have changed even when this audit write did not.
 // No automated callback retry is allowed to write it a second time.
 return {status:'needs_review',reason:'receipt_finalization_unverified',
  providerCalls:0,supplierWritesAuthorized};
}
