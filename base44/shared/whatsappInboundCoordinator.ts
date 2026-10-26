// INTERNAL integration boundary for a future explicitly activated WhatsApp
// callback endpoint. It is NOT exported as a Base44 function or scheduled.
// Never run against real messages before provider-account QA and owner rollout.
// Every effect follows: provider+binding+identity admission -> durable receipt
// -> one-owner claim -> ONE EventService CAS -> event readiness -> terminal audit.
// A committed write with lost response NEVER triggers a repeat mutation.
import {preflightWhatsAppAssignmentResponse} from './whatsappInboundAdmission.ts';
import {registerVerifiedInboundReceipt,claimPendingInboundReceipt,
 finishInboundReceipt} from './whatsappInboundInbox.ts';
import {persistAuthorizedSupplierStatus} from './supplierStatusPersistence.ts';

const preflightRefused=(reason:string)=>({status:'refused',reason,
 providerCalls:0,supplierWritesAuthorized:false});
export type InboundOutcome='refused'|'duplicate'|'held'|'applied'|'rejected'|'needs_review';
export async function processVerifiedWhatsAppAssignmentResponse(input:{
 providerEvent:any;client:any;trustedRolloutEnabled:boolean;
 providerCapabilityVerified:boolean;claimOwner:string;
 recalculateEventStatus:(eventId:string)=>Promise<any>
}):Promise<{status:InboundOutcome;reason:string;providerCalls:0;supplierWritesAuthorized:boolean}>{
 if(input?.trustedRolloutEnabled!==true||input?.providerCapabilityVerified!==true)
  return preflightRefused('rollout_disabled');
 if(typeof input.claimOwner!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(input.claimOwner)||
  typeof input.recalculateEventStatus!=='function')
  return preflightRefused('invalid_trusted_callback_context');
 // Does ALL required provider authentication, signed action, original Outbox
 // receipt, sender account, registered supplier and current intent checks.
 const admission=await preflightWhatsAppAssignmentResponse(
  input.providerEvent,input.client?.asServiceRole);
 if(!admission.admissible)
  return preflightRefused(admission.reason);
 const record=admission.receipt;
 let registered;
 try{registered=await registerVerifiedInboundReceipt(input.client,record);}
 catch{return preflightRefused('receipt_registration_unverified');}
 if(registered.kind==='duplicate')
  return {status:'duplicate',reason:'provider_event_already_recorded',
   providerCalls:0,supplierWritesAuthorized:false};
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

 // After CAS claim, all failures must be reflected on the receipt if safe.
 // Incomplete terminal writes remain 'processing', and expiry triggers
 // operator review; the system NEVER auto-claims expired processing jobs.
 let outcome:'applied'|'rejected'|'needs_review'='needs_review';
 let resultCode='unknown_after_write';
 let supplierWritesAuthorized=false;
 try{
  const status=record.action==='assignment_approve'?'confirmed':'rejected';
  supplierWritesAuthorized=true;
  const changed=await persistAuthorizedSupplierStatus(
   input.client.asServiceRole,{
    eventServiceId:record.eventServiceId,supplierId:record.supplierId,
    newStatus:status,source:'whatsapp',expectedRevision:record.revision
   });
  // The business CAS may have committed. A subsequent failure to recalculate
  // readiness must NEVER cause the supplier CAS to be run again.
  if(changed.kind==='changed')
   await input.recalculateEventStatus(changed.eventId);
  outcome='applied';resultCode=changed.kind==='unchanged'?'already_applied':'applied';
 }catch(error){
  // Only strictly known validation/concurrency rejection is safe to conclude
  // as NOT applied. All provider/network/DB failures are ambiguous even when
  // a caller believes the operation failed before commit.
  const code=String((error as any)?.code||'');
  const known=new Set(['stale_assignment_revision','assignment_intent_inactive',
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
  if(done?.finalized)
   return {status:outcome,reason:resultCode,providerCalls:0,supplierWritesAuthorized};
 }catch{}
 // Business state may have changed even when this audit write did not.
 // No automated callback retry is allowed to write it a second time.
 return {status:'needs_review',reason:'receipt_finalization_unverified',
  providerCalls:0,supplierWritesAuthorized};
}
