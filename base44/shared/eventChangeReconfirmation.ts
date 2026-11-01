import {readAssignmentIntents,ASSIGNMENT_INTENT_MODE} from './assignmentIntent.ts';
import {assignmentTransitionWhatsAppKey} from './assignmentTransitionWhatsApp.ts';

// Server-owned proof that an administrator chose "notify and re-confirm" in
// an Event/arrival-time change dialog. The marker is written in the SAME
// EventService.update as the statuses reset to pending. Ordinary reassignments
// never write it and must retain the existing new-assignment notification.
const ID=/^[A-Za-z0-9_-]{3,128}$/;
const REV=/^r[1-9][0-9]{0,12}$/;
const SOURCES={date_reconfirm:'assignment_update',arrival_notify:'arrival_time_change'} as const;
type Kind=keyof typeof SOURCES;
type Marker={version:1;kind:Kind;eventServiceId:string;eventId:string;
 revision:string;fingerprint:string;supplierIds:string[]};
export function parseEventChangeReconfirmation(raw:any):Marker|null {
 let data:any=raw;
 try{if(typeof data==='string')data=JSON.parse(data);}catch{return null;}
 if(!data||data.version!==1||!(data.kind in SOURCES)||
  !ID.test(data.eventServiceId||'')||!ID.test(data.eventId||'')||
  !REV.test(data.revision||'')||
  typeof data.fingerprint!=='string'||data.fingerprint.length<3||
  data.fingerprint.length>1200||!Array.isArray(data.supplierIds)||
  data.supplierIds.length<1||data.supplierIds.length>50||
  data.supplierIds.some((id:any)=>typeof id!=='string'||!ID.test(id))||
  new Set(data.supplierIds).size!==data.supplierIds.length)return null;
 return data as Marker;
}
export function planEventChangeReconfirmation(service:any,input:{
 kind:Kind;fingerprint:string;supplierIds:string[];
},at=Date.now()) {
 if(!ID.test(service?.id||'')||!ID.test(service?.event_id||'')||
  !Object.prototype.hasOwnProperty.call(SOURCES,input?.kind)||
  typeof input?.fingerprint!=='string'||input.fingerprint.length<3||
  input.fingerprint.length>1200||!Array.isArray(input.supplierIds)||
  !input.supplierIds.length||input.supplierIds.length>50||
  input.supplierIds.some(id=>!ID.test(id)))throw Error('Invalid reconfirmation transition');
 const supplierIds=[...new Set(input.supplierIds)].sort();
 const old=parseEventChangeReconfirmation(service.supplier_reconfirmation_context);
 if(old&&old.kind===input.kind&&old.eventServiceId===service.id&&
  old.eventId===service.event_id&&old.fingerprint===input.fingerprint&&
  JSON.stringify([...old.supplierIds].sort())===JSON.stringify(supplierIds))
  return {value:JSON.stringify(old),revision:old.revision,reused:true};
 const prior=Number(old?.revision?.slice(1)||0);
 const clock=Math.max(Math.floor(at),prior+1);
 if(!Number.isSafeInteger(clock)||clock<1||clock>9999999999999)
  throw Error('Invalid reconfirmation revision');
 const value:Marker={version:1,kind:input.kind,eventServiceId:service.id,
  eventId:service.event_id,revision:'r'+clock,
  fingerprint:input.fingerprint,supplierIds};
 return {value:JSON.stringify(value),revision:value.revision,reused:false};
}
function parseIds(raw:any):string[]{
 try{const v=typeof raw==='string'?JSON.parse(raw):raw;
  return Array.isArray(v)?v.map(String):[];}catch{return [];}
}
// Invalidate older pending/accepted durable initial-assignment button
// generations when the manager requests a fresh confirmation. Without this,
// an old signed initial-assignment click could resolve the NEW decision.
export function closeSupersededAssignmentIntents(service:any,supplierIds:string[]){
 if(service?.assignment_intent_mode!==ASSIGNMENT_INTENT_MODE)return {};
 const original=readAssignmentIntents(service.assignment_notification_intents||'[]');
 const affected=new Set(supplierIds);
 let changed=false;
 const entries=original.map((item:any)=>{
  if(!affected.has(item.supplier_id)||
    !['requested','queued','accepted'].includes(item.state))return item;
  changed=true;
  return {...item,state:'resolved',resolution:'event_change_requires_reconfirmation'};
 });
 return changed?{assignment_notification_intents:JSON.stringify(entries),
  assignment_intents_pending:entries.some((item:any)=>item.state==='requested')}:{};
}
export function isEventChangeStatusReset(oldRow:any,newRow:any,supplierId:string):boolean{
 const previous=parseEventChangeReconfirmation(oldRow?.supplier_reconfirmation_context);
 const current=parseEventChangeReconfirmation(newRow?.supplier_reconfirmation_context);
 if(!current||oldRow?.supplier_reconfirmation_context===newRow?.supplier_reconfirmation_context||
   previous?.revision===current.revision||!current.supplierIds.includes(supplierId)||
   current.eventServiceId!==newRow?.id||current.eventId!==newRow?.event_id)return false;
 const previousIds=parseIds(oldRow?.supplier_ids);
 const currentIds=parseIds(newRow?.supplier_ids);
 if(!previousIds.includes(supplierId)||!currentIds.includes(supplierId))return false;
 const parseStatus=(row:any)=>{
  try{return typeof row?.supplier_statuses==='string'?JSON.parse(row.supplier_statuses||'{}'):
    row?.supplier_statuses||{};}catch{return {};}
 };
 const before=parseStatus(oldRow)[supplierId];
 const after=parseStatus(newRow)[supplierId];
 return !!before&&before!=='pending'&&after==='pending';
}
export function eligibleEventChangeReconfirmation(service:any,sourceType:string,supplierId:string,revision:string):boolean {
 const marker=parseEventChangeReconfirmation(service?.supplier_reconfirmation_context);
 if(!marker||marker.eventServiceId!==service.id||marker.eventId!==service.event_id||
  SOURCES[marker.kind]!==sourceType||marker.revision!==revision||
  !marker.supplierIds.includes(supplierId)||service.is_external===true||
  !parseIds(service.supplier_ids).includes(supplierId))return false;
 try{
  const map=typeof service.supplier_statuses==='string'?
   JSON.parse(service.supplier_statuses):service.supplier_statuses;
  return !!map&&!Array.isArray(map)&&map[supplierId]==='pending';
 }catch{return false;}
}
export function eventChangeSourceType(kind:Kind):string{return SOURCES[kind];}
// Distinguish the existing arrival cancellation messages from an actionable
// change notice BEFORE worker preparation. Never arm buttons for cancellation.
export function isEventChangeReconfirmationOutbox(job:any):boolean{
 const kind=job?.source_type==='assignment_update'?'date_reconfirm':
   job?.source_type==='arrival_time_change'?'arrival_notify':null;
 return !!kind&&typeof job.idempotency_key==='string'&&
  new RegExp('^assignment-transition-v1:'+kind+':[0-9a-f]{64}$').test(job.idempotency_key);
}

// A reconfirmation outbox is signed ONLY if its deterministic transition
// identity matches the server's still-current choice and exact supplier.
// Outbox rows alone are not authorization; admin-editable snapshots are not
// allowed to opt an arbitrary WhatsApp job into interactive decisions.
export async function checkEventChangeButtonCandidate(service:any,job:any){
 const refused=(reason:string)=>({allowed:false,reason,revision:null as string|null});
 const marker=parseEventChangeReconfirmation(service?.supplier_reconfirmation_context);
 if(!marker||!job||!eligibleEventChangeReconfirmation(service,job.source_type,
   job.supplier_id,marker.revision)||
   job.event_service_id!==service.id||job.source_id!==service.event_id||
   job.message_type!=='text'||job.requested_provider!=='green'||
   typeof job.notification_template_id!=='string'||
   !ID.test(job.notification_template_id)||
   typeof job.chat_id!=='string'||!/^[1-9][0-9]{7,14}@c\.us$/.test(job.chat_id))
  return refused('reconfirmation_origin_invalid');
 let parts:any;
 try{parts=JSON.parse(marker.fingerprint);}catch{return refused('reconfirmation_fingerprint_invalid');}
 if(!Array.isArray(parts)||parts.some(x=>typeof x!=='string'))
  return refused('reconfirmation_fingerprint_invalid');
 let identity:any={kind:marker.kind,eventId:marker.eventId,
  eventServiceId:service.id,supplierId:job.supplier_id,
  templateId:job.notification_template_id,revision:marker.revision};
 if(marker.kind==='date_reconfirm'){
  if(parts.length!==4)return refused('reconfirmation_fingerprint_invalid');
  identity={...identity,oldEventDate:parts[0],oldEventTime:parts[1],
   eventDate:parts[2],eventTime:parts[3]};
 }else{
  if(parts.length!==3||String(service.supplier_arrival_time||'')!==parts[0])
   return refused('reconfirmation_arrival_changed');
  identity={...identity,supplierArrivalTime:parts[0],
   eventDate:parts[1],eventTime:parts[2]};
 }
 if(job.idempotency_key!==await assignmentTransitionWhatsAppKey(identity))
  return refused('reconfirmation_business_key_mismatch');
 return {allowed:true,reason:'exact_reconfirmation_transition',revision:marker.revision};
}
export function reconfirmationMatchesEvent(service:any,event:any,requireResolved=false):boolean{
 const marker=parseEventChangeReconfirmation(service?.supplier_reconfirmation_context);
 if(!marker||!event||event.id!==marker.eventId)return false;
 let p:any;
 try{p=JSON.parse(marker.fingerprint);}catch{return false;}
 if(!Array.isArray(p))return false;
 if(marker.kind==='date_reconfirm')return p.length===4&&
  event.event_date===p[2]&&(event.event_time||'')===p[3]&&
  (!requireResolved||event.date_change_pending_action!==true);
 return p.length===3&&service.supplier_arrival_time===p[0]&&
  event.event_date===p[1]&&(event.event_time||'')===p[2];
}
