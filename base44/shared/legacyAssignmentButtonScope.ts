// FAST TRACK: additive, strictly scoped button eligibility for EXISTING
// EventService.update() assignment saves. NEVER changes that save, its
// onAssignmentChange triggers, Push, reminders, calendar or queue enqueuing.
// The legacy Outbox key already contains a business-write timestamp. Bind a
// one-use response to that exact generation, not merely supplier+event IDs.
// NOTE: Any subsequent EventService mutation deliberately invalidates an old
// action (conservative, safe for initial controlled canary).
import {assignmentWhatsAppKey,canonicalAssignmentUpdatedDate} from './assignmentWhatsApp.ts';
import {supplierAssigned} from './whatsappSupplierTransition.ts';

const ID=/^[A-Za-z0-9_-]{3,100}$/;
const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const VALID_REVISION=/^r[1-9][0-9]{0,12}$/;
const TARGET_STATUS=new Set(['pending','confirmed','rejected']);
const refused=(reason:string)=>({allowed:false,reason,revision:null as string|null});
export type LegacyAssignmentButtonScope={
 eventServiceId:string;supplierId:string;chatId:string
};
const statuses=(raw:unknown):Record<string,string>|null=>{
 try{
  const data=typeof raw==='string'?JSON.parse(raw||'{}'):raw||{};
  if(!data||typeof data!=='object'||Array.isArray(data)||
   Object.values(data).some(s=>!TARGET_STATUS.has(String(s))))return null;
  return data;
 }catch{return null;}
};
export function legacyAssignmentGeneration(service:any):string|null{
 const raw=canonicalAssignmentUpdatedDate(service?.updated_date);
 // The six-fractional-digit legacy identity is the exact generation included
 // in assignmentWhatsAppKey. Conversion truncates only excess precision.
 if(typeof raw!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}$/.test(raw))
  return null;
 const ms=Date.parse(raw+'Z');
 if(!Number.isSafeInteger(ms)||ms<1||ms>9999999999999)return null;
 const revision='r'+ms;
 return VALID_REVISION.test(revision)?revision:null;
}
export function checkLegacyAssignmentButtonCandidate(input:{
 service:any;job:any;target:LegacyAssignmentButtonScope
}){
 const {service,job,target}=input||{} as any;
 if(!service||!job||!target||
  !ID.test(target.eventServiceId||'')||!ID.test(target.supplierId||'')||
  !PRIVATE.test(target.chatId||''))
  return refused('invalid_pilot_scope');
 if(service.id!==target.eventServiceId||service.is_external===true||
  job.event_service_id!==service.id||job.supplier_id!==target.supplierId||
  job.chat_id!==target.chatId||job.source_type!=='assignment_new'||
  job.message_type!=='text'||job.requested_provider!=='green')
  return refused('outside_exact_assignment_canary');
 if(service.assignment_intent_mode!==undefined&&
  service.assignment_intent_mode!==null&&service.assignment_intent_mode!=='')
  return refused('durable_v2_has_separate_lifecycle');
 if(!supplierAssigned(service.supplier_ids,target.supplierId))
  return refused('supplier_not_assigned');
 const current=statuses(service.supplier_statuses);
 if(!current|| (current[target.supplierId]||'pending')!=='pending')
  return refused('supplier_not_pending');
 const revision=legacyAssignmentGeneration(service);
 if(!revision)return refused('unverifiable_legacy_write_generation');
 if(job.idempotency_key!==assignmentWhatsAppKey(service,target.supplierId))
  return refused('outbox_business_generation_mismatch');
 return {allowed:true,reason:'legacy_generation_exact_match',revision};
}
// Inbound MUST compare the same exact service write generation inside the
// business CAS, not only at preflight. A manager's update while the message
// is in flight, or a decline followed by reopen, always retires old buttons.
// Read-only proof of a HISTORICAL accepted Outbox version, even after the
// EventService has changed. The callback must independently authenticate
// Green, source account, private sender, Outbox provider id and signed token.
export function legacyRevisionFromOutboxKey(job:any):string|null{
 if(!job||!ID.test(job.event_service_id||'')||
  !ID.test(job.supplier_id||''))return null;
 const prefix='assignment:'+job.event_service_id+':'+job.supplier_id+':';
 const suffix=':SUPPLIER_NEW_ASSIGNMENT';
 const key=job.idempotency_key;
 if(typeof key!=='string'||!key.startsWith(prefix)||!key.endsWith(suffix))return null;
 const date=key.slice(prefix.length,-suffix.length);
 return legacyAssignmentGeneration({updated_date:date});
}
export function legacyAssignmentRevisionEligibility(service:any,
 supplierId:string,revision:string){
 if(service?.assignment_intent_mode!==undefined&&
  service.assignment_intent_mode!==null&&service.assignment_intent_mode!=='')
  return {allowed:false,reason:'not_legacy_assignment'};
 if(!ID.test(supplierId||'')||!VALID_REVISION.test(revision||''))
  return {allowed:false,reason:'invalid_legacy_revision'};
 if(legacyAssignmentGeneration(service)!==revision)
  return {allowed:false,reason:'stale_legacy_assignment'};
 const status=statuses(service.supplier_statuses);
 if(!status||!supplierAssigned(service.supplier_ids,supplierId)||
  (status[supplierId]||'pending')!=='pending')
  return {allowed:false,reason:'legacy_assignment_not_pending'};
 return {allowed:true,reason:'current_legacy_generation'};
}
