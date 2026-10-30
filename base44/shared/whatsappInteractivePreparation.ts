// Future interactive assignment OUTBOUND preparation (server-only).
// Writes a frozen, signed button snapshot BEFORE the first provider attempt.
// NEVER invokes WhatsApp, does not modify pacing/queue leases, and is currently
// NOT wired to any worker/entrypoint or active company policy.
// IMPORTANT: caller must derive senderAccountId from trusted provider config,
// require independently approved account capability, and explicitly gate rollout.
// Base44 Outbox uses admin RLS; never expose this field or signed tokens in UI.
import {readAssignmentIntents} from './assignmentIntent.ts';
import {allowedInboundActionIds} from './whatsappInteractiveActionRegistry.ts';
import {supplierAssigned} from './whatsappSupplierTransition.ts';
import {checkLegacyAssignmentButtonCandidate,
 type LegacyAssignmentButtonScope} from './legacyAssignmentButtonScope.ts';
import {createFutureInteractiveButtonSnapshot,verifyFutureButtonSnapshotMac} from './whatsappButtonBindings.ts';
import {verifySignedWhatsAppAction} from './whatsappSignedAction.ts';

const VALID_ID=/^[A-Za-z0-9_-]{3,128}$/;
const GREEN_INSTANCE=/^[0-9]{5,20}$/;
const refused=(code:string,status=409)=>
 Object.assign(new Error(code),{code,status});
type Params={
 outboxJobId:string;senderAccountId:string;policy:any;signingSecret:string;
 providerCapabilityVerified:boolean;rolloutAuthorized:boolean;
 // Opt-in ONLY from a separately trusted server-verified, exact single
 // assignment+supplier+private chat pilot. Never derived from Outbox JSON.
 legacyCanaryScope?:LegacyAssignmentButtonScope;
 issuedAt?:number;subtle?:SubtleCrypto
};
function parseStatuses(service:any){
 try{
  const result=JSON.parse(service.supplier_statuses||'{}');
  if(!result||typeof result!=='object'||Array.isArray(result))return null;
  return result;
 }catch{return null;}
}
function latestSupplierRevision(service:any,supplierId:string):{revision:string;key:string}{
 if(service?.assignment_intent_mode!=='durable_v1')throw refused('assignment_intents_not_active');
 let intents;
 try{intents=readAssignmentIntents(service.assignment_notification_intents||'[]');}
 catch{throw refused('assignment_intents_invalid');}
 const latest=[...intents].reverse().find((i:any)=>i.supplier_id===supplierId);
 if(!latest||!['requested','queued','accepted'].includes(latest.state))
  throw refused('assignment_intent_not_ready');
 const revision='r'+latest.revision;
 if(!/^r[1-9][0-9]{0,12}$/.test(revision))throw refused('assignment_revision_invalid');
 return {revision,key:latest.key};
}
function isUnsentQueuedJob(job:any){
 return !!job&&job.status==='queued'&&job.source_type==='assignment_new'&&
  job.message_type==='text'&&job.requested_provider==='green'&&
  Number(job.attempt_count||0)===0&&!job.send_started_at&&
  !job.provider_message_id&&!job.completed_at&&
  typeof job.chat_id==='string'&&/^[1-9][0-9]{7,14}@c\.us$/.test(job.chat_id)&&
  VALID_ID.test(String(job.event_service_id||''))&&
  VALID_ID.test(String(job.supplier_id||''))&&
  VALID_ID.test(String(job.id||''));
}
async function signedButtonsMatch(raw:any,job:any,secret:string,subtle:SubtleCrypto,now:number){
 if(typeof raw!=='string'||raw.length>8192||
  !(await verifyFutureButtonSnapshotMac(raw,secret,subtle)))return false;
 let data:any;
 try{data=JSON.parse(raw);}catch{return false;}
 if(!data||data.version!==1||data.jobId!==job.id||
  data.eventServiceId!==job.event_service_id||data.supplierId!==job.supplier_id||
  data.chatId!==job.chat_id||data.provider!=='green'||
  data.senderAccountId!==job.sender_account_id||
  data.revision!==job.assignment_revision||
  !Array.isArray(data.buttons)||!data.buttons.length||data.buttons.length>2)return false;
 const actions=new Set<string>(),ids=new Set<string>();
 for(const button of data.buttons){
  if(!button||!allowedInboundActionIds('assignment').includes(button.action)||
   actions.has(button.action)||typeof button.buttonId!=='string'||
   !/^wa1_[A-Za-z0-9_-]{22}$/.test(button.buttonId)||ids.has(button.buttonId)||
   typeof button.label!=='string'||button.label.length<1||button.label.length>20){
   return false;
  }
  const bound=await verifySignedWhatsAppAction({token:button.actionToken,secret,now},subtle);
  if(!bound||bound.companyId!=='shirat_hanevel'||bound.provider!=='green'||
   bound.senderAccountId!==job.sender_account_id||
   bound.eventServiceId!==job.event_service_id||bound.supplierId!==job.supplier_id||
   bound.outboxJobId!==job.id||bound.revision!==job.assignment_revision||
   bound.action!==button.action)return false;
  actions.add(button.action);ids.add(button.buttonId);
 }
 return true;
}
export async function prepareFutureGreenAssignmentOutbox(client:any,input:Params){
 // Hard prerequisites before ANY database call; no accidental opt-in through
 // a draft policy. Both gates MUST come from trusted backend activation config.
 if(input?.rolloutAuthorized!==true||input?.providerCapabilityVerified!==true)
  throw refused('interactive_rollout_disabled',403);
 if(!VALID_ID.test(String(input.outboxJobId||''))||
  !GREEN_INSTANCE.test(String(input.senderAccountId||''))||
  typeof input.signingSecret!=='string'||input.signingSecret.length<32)
  throw refused('invalid_interactive_origin',400);
 const db=client?.asServiceRole?.entities;
 if(!db?.WhatsAppOutbox?.get||!db?.WhatsAppOutbox?.updateMany||
  !db?.EventService?.get)throw refused('interactive_storage_unavailable',503);
 const subtle=input.subtle??crypto.subtle;
 const now=input.issuedAt??Date.now();
 const original=await db.WhatsAppOutbox.get(input.outboxJobId);
 if(!isUnsentQueuedJob(original))throw refused('message_already_attempted_or_ineligible');
 const service=await db.EventService.get(original.event_service_id);
 if(!service||service.is_external===true||
  !supplierAssigned(service.supplier_ids,original.supplier_id))
  throw refused('supplier_assignment_not_active');
 const map=parseStatuses(service);
 if(!map||map[original.supplier_id]!=='pending')
  throw refused('supplier_not_pending');
 let revision:string;
 if(input.legacyCanaryScope){
  // Fast-track: reuse the original EventService UPDATE business generation.
  // No mutation of supplier assignment, original workflows or notification
  // producer. A newer update invalidates this queued candidate.
  const check=checkLegacyAssignmentButtonCandidate({
   service,job:original,target:input.legacyCanaryScope
  });
  if(!check.allowed||!check.revision)
   throw refused('legacy_canary_'+check.reason);
  revision=check.revision;
 }else{
  const currentIntent=latestSupplierRevision(service,original.supplier_id);
  if(original.idempotency_key!==currentIntent.key)
   throw refused('assignment_intent_key_mismatch');
  revision=currentIntent.revision;
 }
 if(original.sender_account_id||original.assignment_revision){
  // Partial origin is not proof that a prior version was never dispatched.
  if(!original.interactive_button_bindings_json)
   throw refused('partial_interactive_origin_requires_review');
  if(original.sender_account_id!==input.senderAccountId||
   original.assignment_revision!==revision)
   throw refused('interactive_origin_mismatch');
  const verified=await signedButtonsMatch(
   original.interactive_button_bindings_json,original,input.signingSecret,subtle,now);
  if(!verified)throw refused('invalid_existing_interactive_snapshot');
  return {status:'already_prepared',jobId:original.id,
   snapshot:original.interactive_button_bindings_json,persistedJob:original,noProviderCalled:true};
 }
 if(original.interactive_button_bindings_json)
  throw refused('orphan_interactive_snapshot_requires_review');
 const prepared={...original,sender_account_id:input.senderAccountId,assignment_revision:revision};
 const snapshot=await createFutureInteractiveButtonSnapshot({
  job:prepared,policy:input.policy,signingSecret:input.signingSecret,issuedAt:now
 },subtle);
 // Pre-CREATE side effects: one atomic conditional update of only the three
 // new metadata fields. Do not steal the worker lease or change message status.
 const filter={
  id:original.id,status:'queued',attempt_count:original.attempt_count??null,
  source_type:'assignment_new',requested_provider:'green',
  send_started_at:original.send_started_at??null,
  provider_message_id:original.provider_message_id??null,
  sender_account_id:original.sender_account_id??null,
  assignment_revision:original.assignment_revision??null,
  interactive_button_bindings_json:original.interactive_button_bindings_json??null
 };
 const patch={sender_account_id:input.senderAccountId,assignment_revision:revision,
  interactive_button_bindings_json:snapshot};
 let updated=false,thrown=false;
 try{
  const result=await db.WhatsAppOutbox.updateMany(filter,{$set:patch});
  updated=result?.updated===1;
  if(!updated&&result?.updated!==0)thrown=true;
 }catch{thrown=true;}
 // A successful SDK result is not enough; verify actual persisted bytes.
 // A timeout MAY mean the write committed; never issue a second CAS here.
 let current:any;
 try{current=await db.WhatsAppOutbox.get(original.id);}
 catch{throw refused('interactive_snapshot_persistence_unknown',503);}
 if(current?.status!=='queued'||Number(current?.attempt_count||0)!==0||
  current?.send_started_at||current?.provider_message_id||
  current?.sender_account_id!==input.senderAccountId||
  current?.assignment_revision!==revision)
  throw refused(thrown?'interactive_snapshot_persistence_unknown':
   'interactive_snapshot_race_or_unknown',thrown?503:409);
 const currentSnapshot=current.interactive_button_bindings_json;
 if(currentSnapshot===snapshot &&
  await signedButtonsMatch(snapshot,current,input.signingSecret,subtle,now))
  return {status:updated?'prepared':'verified_after_uncertain_write',
   jobId:original.id,snapshot,persistedJob:current,noProviderCalled:true};
 // An alternate concurrent preparer might have won with different random IDs.
 // It may only be reused after verifying all signed bindings; NEVER overwrite.
 if(currentSnapshot&&
  await signedButtonsMatch(currentSnapshot,current,input.signingSecret,subtle,now))
  return {status:'already_prepared',jobId:original.id,
   snapshot:currentSnapshot,persistedJob:current,noProviderCalled:true};
 throw refused(thrown?'interactive_snapshot_persistence_unknown':
  'interactive_snapshot_conflict',thrown?503:409);
}
