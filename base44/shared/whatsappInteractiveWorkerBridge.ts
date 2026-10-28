// Dormant Green API worker bridge. The existing processWhatsAppOutbox endpoint
// deliberately does NOT supply an interactive config. Requires BOTH trusted
// server config AND a separate owner-approved control flag (default false).
// No new provider call, scheduling trigger or polling is introduced here.
// This bridge prepares the frozen Outbox metadata BEFORE the existing worker
// claims a rate slot. Its output is a pure provider payload, not an HTTP call.
import {prepareFutureGreenAssignmentOutbox} from './whatsappInteractivePreparation.ts';
import {previewGreenInteractiveAssignment,type GreenOutboundPreview} from './greenInteractiveOutbound.ts';
import {verifyFutureButtonSnapshotMac} from './whatsappButtonBindings.ts';
import {verifySignedWhatsAppAction} from './whatsappSignedAction.ts';
import {whatsappRevisionEligibility} from './supplierStatusPersistence.ts';
import {supplierAssigned} from './whatsappSupplierTransition.ts';
import {type OfficeContextMode} from './whatsappOfficeInquiryLink.ts';

const V2_KEY=/^assignment:[A-Za-z0-9_-]{3,100}:[A-Za-z0-9_-]{3,100}:r[1-9][0-9]{0,12}:SUPPLIER_NEW_ASSIGNMENT$/;
type GreenCapability='reply_only'|'mixed_url';
export type TrustedGreenInteractiveConfig={
 enabled:true;accountCapabilityVerified:true;
 capability:GreenCapability;senderAccountId:string;
 signingSecret:string;policy:any;officeNumber?:string;officeLabel?:string;
 officeContextMode?:OfficeContextMode;
 // Strict one-number QA fence. Only trusted server may fill this.
 qaChatId?:string;qaEventServiceId?:string;qaSupplierId?:string;
 subtle?:SubtleCrypto;now?:number
};
type Decision={kind:'legacy';reason:string;job:any;preview:null}|
 {kind:'interactive';reason:string;job:any;preview:GreenOutboundPreview};
const legacy=(job:any,reason:string):Decision=>({kind:'legacy',reason,job,preview:null});
const blocked=(reason:string)=>Object.assign(new Error(reason),{code:reason});
function strictRetryReceipt(job:any){
 return job?.status==='retry_wait'&&job?.error_code===429&&
  Number.isInteger(Number(job?.attempt_count))&&Number(job.attempt_count)>0&&
  !job?.provider_message_id&&
  job?.provider==='green'&&job?.requested_provider==='green'&&
  typeof job?.sender_account_id==='string'&&job.sender_account_id.length>0&&
  typeof job?.assignment_revision==='string'&&
  typeof job?.interactive_button_bindings_json==='string'&&
  job.interactive_button_bindings_json.length>0;
}
async function validateDefiniteRateLimitRetry(client:any,job:any,config:TrustedGreenInteractiveConfig){
 if(!strictRetryReceipt(job))throw blocked('interactive_retry_not_verified_definite');
 if(job.sender_account_id!==config.senderAccountId)
  throw blocked('interactive_retry_sender_account_changed');
 const db=client?.asServiceRole?.entities;
 if(!db?.EventService?.get)throw blocked('interactive_retry_service_unavailable');
 const service=await db.EventService.get(job.event_service_id);
 if(!service||service.is_external===true||
  !supplierAssigned(service.supplier_ids,job.supplier_id))
  throw blocked('interactive_retry_assignment_removed');
 const revision=whatsappRevisionEligibility(service,job.supplier_id,job.assignment_revision);
 if(!revision.allowed)throw blocked(revision.reason);
 let statuses:any;
 try{statuses=JSON.parse(service.supplier_statuses||'{}');}catch{
  throw blocked('interactive_retry_status_corrupt');
 }
 if(!statuses||typeof statuses!=='object'||Array.isArray(statuses)||
  statuses[job.supplier_id]!=='pending')
  throw blocked('interactive_retry_not_pending');
 if(!await verifyFutureButtonSnapshotMac(job.interactive_button_bindings_json,
   config.signingSecret,config.subtle??crypto.subtle))
  throw blocked('interactive_retry_snapshot_tampered');
 let saved:any;
 try{saved=JSON.parse(job.interactive_button_bindings_json);}catch{
  throw blocked('interactive_retry_snapshot_corrupt');
 }
 if(saved.version!==1||saved.jobId!==job.id||
  saved.eventServiceId!==job.event_service_id||saved.supplierId!==job.supplier_id||
  saved.chatId!==job.chat_id||saved.senderAccountId!==job.sender_account_id||
  saved.provider!=='green'||saved.revision!==job.assignment_revision||
  !Array.isArray(saved.buttons)||saved.buttons.length<1||saved.buttons.length>2)
  throw blocked('interactive_retry_snapshot_mismatch');
 const now=config.now??Date.now();
 for(const b of saved.buttons){
  const token=await verifySignedWhatsAppAction({
   token:b.actionToken,secret:config.signingSecret,now
  },config.subtle??crypto.subtle);
  if(!token||token.companyId!=='shirat_hanevel'||
    token.provider!=='green'||token.outboxJobId!==job.id||
    token.eventServiceId!==job.event_service_id||
    token.supplierId!==job.supplier_id||
    token.senderAccountId!==job.sender_account_id||
    token.revision!==job.assignment_revision||token.action!==b.action)
   throw blocked('interactive_retry_action_expired_or_mismatched');
 }
}
export async function prepareGreenInteractiveWorkerCandidate(client:any,
 job:any,provider:string,control:any,
 config:TrustedGreenInteractiveConfig|null|undefined):Promise<Decision>{
 // Zero extra reads/credit-bearing calls when disabled or unconfigured.
 // A draft policy cannot enable this; production wrapper passes NO config.
 if(control?.interactive_outbound_live_enabled!==true||
  config?.enabled!==true||config?.accountCapabilityVerified!==true)
  return legacy(job,'interactive_feature_disabled');
 if(provider!=='green'||job?.source_type!=='assignment_new'||
  job?.message_type!=='text')return legacy(job,'not_green_supplier_assignment');
 if(config.qaChatId!==undefined){
  if(!/^[1-9][0-9]{7,14}@c\.us$/.test(config.qaChatId))
   throw blocked('invalid_qa_chat_scope');
  if(!/^[A-Za-z0-9_-]{3,128}$/.test(config.qaEventServiceId||'')||
    !/^[A-Za-z0-9_-]{3,128}$/.test(config.qaSupplierId||''))
   throw blocked('invalid_qa_business_scope');
  if(job.chat_id!==config.qaChatId||
    job.event_service_id!==config.qaEventServiceId||
    job.supplier_id!==config.qaSupplierId)
   return legacy(job,'not_allowed_single_assignment_qa');
  if(job.interactive_qa_required!==true)
   throw blocked('qa_assignment_requires_persisted_enrollment_marker');
 }
 if(!['reply_only','mixed_url'].includes(config.capability)||
  !/^[0-9]{5,20}$/.test(config.senderAccountId||'')||
  typeof config.signingSecret!=='string'||config.signingSecret.length<32||
  config.policy?.enabled!==true)
  throw blocked('interactive_trusted_configuration_invalid');
 // Never modify historical assignments or unrelated message templates.
 // The new durable revision is visible in the existing Outbox idempotency key.
 if(!V2_KEY.test(String(job.idempotency_key||''))){
  // A QA supplier must never receive plain text when the administrator
  // expects buttons. The legacy save UI does not create durable v2 intents;
  // hold ONLY this targeted QA job until that workflow is verified.
  if(config.qaChatId&&job.chat_id===config.qaChatId)
   throw blocked('qa_requires_durable_assignment_intent');
  if(job.interactive_button_bindings_json||job.assignment_revision||job.sender_account_id)
   throw blocked('interactive_unrecognized_existing_origin');
  return legacy(job,'legacy_assignment_without_durable_intent');
 }
 let persistedJob:any;
 if(job.status==='queued'){
  const result=await prepareFutureGreenAssignmentOutbox(client,{
   outboxJobId:job.id,senderAccountId:config.senderAccountId,
   signingSecret:config.signingSecret,policy:config.policy,
   providerCapabilityVerified:true,rolloutAuthorized:true,
   issuedAt:config.now,subtle:config.subtle
  });
  // One CAS + verified reread inside helper, no additional Outbox GET.
  persistedJob=result.persistedJob;
  if(!persistedJob||result.snapshot!==persistedJob.interactive_button_bindings_json)
   throw blocked('interactive_preparation_not_durable');
 }else if(job.status==='retry_wait'){
  // Reuse exact original buttons ONLY after a definite provider 429,
  // not after an UNKNOWN, stale send, expired action, or status mutation.
  await validateDefiniteRateLimitRetry(client,job,config);
  persistedJob=job;
 }else throw blocked('interactive_candidate_state_invalid');
 if(persistedJob.id!==job.id||persistedJob.status!==job.status||
  persistedJob.chat_id!==job.chat_id||
  persistedJob.event_service_id!==job.event_service_id||
  persistedJob.supplier_id!==job.supplier_id||
  persistedJob.requested_provider!=='green')
  throw blocked('interactive_candidate_changed');
 const preview=await previewGreenInteractiveAssignment({
  job:{...persistedJob,status:'sending'},
  frozenSnapshot:persistedJob.interactive_button_bindings_json,
  signingSecret:config.signingSecret,capability:config.capability,
  rolloutEnabled:true,officeNumber:config.officeNumber,
  officeLabel:config.officeLabel,officeContextMode:config.officeContextMode,
  now:config.now,subtle:config.subtle
 });
 if(!['interactive_reply','interactive_mixed'].includes(preview.kind))
  throw blocked('interactive_preview_not_authorized');
 return {kind:'interactive',reason:'frozen_snapshot_verified',
  job:persistedJob,preview};
}
