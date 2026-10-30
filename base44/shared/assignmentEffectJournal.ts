// Durable business-effect task plan for a future assignment CAS migration.
// All tasks are planned in the SAME EventService business patch; no sends,
// Push, calendar calls, extra entity updates or retries happen in this file.
// It deliberately does NOT implement delivery or authorize the V2 gate.
import {planAssignmentEffectParity,type AssignmentEffectParity}
 from './assignmentEffectParity.ts';

const ID=/^[A-Za-z0-9_-]{3,100}$/;
const KEY=/^assignment-effect:[A-Za-z0-9_-]{3,100}:r[1-9][0-9]{0,15}:[a-z_]{4,64}:[A-Za-z0-9_-]{3,100}$/;
const MAX_TASKS=240;
const MAX_BYTES=120000;
const TASK_STATES=new Set(['planned','claimed','completed','unknown','manual_review','cancelled']);
const CONSUMERS=new Set([
 'event_status_readiness','entity_update_notifications',
 'supplier_assignment_push','supplier_pending_reminder',
 'assignment_removed_notifications','assignment_status_notifications',
 'google_calendar_sync'
]);
const invalid=(reason:string):never=>{throw Error('Invalid assignment effect journal: '+reason);};
export type AssignmentEffectTask={
 key:string;revision:number;consumer:string;subjectId:string;
 state:'planned'|'claimed'|'completed'|'unknown'|'manual_review'|'cancelled';
 createdAt:string;effectKind:string;
 // Set only after an atomic CAS claim. Never reset for blind retry.
 claimToken?:string;claimedAt?:string;finishedAt?:string;resultCode?:string
};
export function readAssignmentEffectJournal(raw:unknown):AssignmentEffectTask[]{
 if(raw===null||raw===undefined||raw==='')return [];
 if(typeof raw!=='string'||raw.length>MAX_BYTES)invalid('size');
 let decoded:any;
 try{decoded=JSON.parse(raw);}catch{invalid('json');}
 if(!Array.isArray(decoded)||decoded.length>MAX_TASKS)invalid('shape');
 const seen=new Set<string>(),out:AssignmentEffectTask[]=[];
 const fields=new Set(['key','revision','consumer','subjectId','state','createdAt','effectKind',
  'claimToken','claimedAt','finishedAt','resultCode']);
 for(const item of decoded){
  if(!item||typeof item!=='object'||Array.isArray(item)||
   Object.keys(item).some(key=>!fields.has(key))||
   !KEY.test(item.key||'')||
   !Number.isSafeInteger(item.revision)||item.revision<1||
   !CONSUMERS.has(item.consumer)||!ID.test(item.subjectId||'')||
   !TASK_STATES.has(item.state)||typeof item.effectKind!=='string'||
   !/^[a-z_]{4,64}$/.test(item.effectKind)||
   !Number.isFinite(Date.parse(item.createdAt||''))||
   seen.has(item.key))invalid('task');
  const expectedTail=':r'+item.revision+':'+item.consumer+':'+item.subjectId;
  if(!item.key.endsWith(expectedTail))invalid('identity_mismatch');
  const hasClaim=item.claimToken!==undefined||item.claimedAt!==undefined;
  const hasFinal=item.finishedAt!==undefined||item.resultCode!==undefined;
  const isIso=(x:unknown)=>typeof x==='string'&&
   Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
  if(item.state==='planned'){
   if(hasClaim||hasFinal)invalid('planned_task_has_claim_or_result');
  }else{
   if(!hasClaim||!isIso(item.claimedAt)||
    typeof item.claimToken!=='string'||
    !/^[A-Za-z0-9_-]{12,100}$/.test(item.claimToken))invalid('missing_claim');
   if(item.state==='claimed'){
    if(hasFinal)invalid('claimed_task_finalized');
   }else if(!isIso(item.finishedAt)||
    typeof item.resultCode!=='string'||
    !/^[a-z_]{3,64}$/.test(item.resultCode))invalid('missing_terminal_result');
  }
  seen.add(item.key);out.push(item as AssignmentEffectTask);
 }
 return out;
}
export function planDurableAssignmentEffectJournal(
 service:any,patch:any,stamp:string,
 parity:AssignmentEffectParity=planAssignmentEffectParity(service,patch)
){
 if(!service||!ID.test(String(service.id||''))||
  !Number.isFinite(Date.parse(stamp)))invalid('origin');
 const current=readAssignmentEffectJournal(service.assignment_effects_journal);
 if(current.some(task=>!task.key.startsWith('assignment-effect:'+service.id+':')))
  invalid('foreign_origin');
 const revision=Number(service.assignment_effects_revision||0);
 if(!Number.isSafeInteger(revision)||revision<0||
  revision>=Number.MAX_SAFE_INTEGER-1)invalid('revision');
 if(current.some(task=>task.revision>revision))invalid('future_revision');
 if(!parity.required)
  return {patch:{},tasks:[],revision,hasNewTasks:false,requiredConsumers:[]};
 const next=revision+1;
 const draft:Omit<AssignmentEffectTask,'key'|'revision'|'state'|'createdAt'>[]=[];
 // Every side effect has a stable business generation and target.
 const put=(consumer:string,subjectId:string,effectKind:string)=>{
  if(!CONSUMERS.has(consumer)||!ID.test(subjectId))invalid('unexpected_consumer_or_subject');
  if(!draft.some(x=>x.consumer===consumer&&x.subjectId===subjectId))
   draft.push({consumer,subjectId,effectKind});
 };
 for(const e of parity.effects){
  if(!e.supplierId)continue;
  switch(e.kind){
   case 'supplier_assigned':
   case 'supplier_reopened':
    put('supplier_assignment_push',e.supplierId,e.kind);
    if(e.afterStatus==='pending')
     put('supplier_pending_reminder',e.supplierId,e.kind);
    break;
   case 'supplier_removed':
    put('assignment_removed_notifications',e.supplierId,e.kind);break;
   case 'supplier_status_changed':
    put('assignment_status_notifications',e.supplierId,e.kind);break;
  }
 }
 // One service event drives generic notifications and calendar/readiness.
 // Their downstream handler must fan out idempotently per actual recipient,
 // and UNKNOWN after a remote side effect must never be auto-replayed.
 for(const consumer of parity.requiredConsumers){
  if(['entity_update_notifications','google_calendar_sync',
   'event_status_readiness'].includes(consumer))
   put(consumer,service.id,'service_change');
 }
 const tasks=draft.sort((a,b)=>a.consumer.localeCompare(b.consumer)||
  a.subjectId.localeCompare(b.subjectId)).map(({consumer,subjectId,effectKind})=>({
   key:'assignment-effect:'+service.id+':r'+next+':'+consumer+':'+subjectId,
   revision:next,consumer,subjectId,effectKind,state:'planned' as const,
   createdAt:new Date(stamp).toISOString()
  }));
 if(!tasks.length||current.length+tasks.length>MAX_TASKS)invalid('capacity');
 const encoded=JSON.stringify([...current,...tasks]);
 if(encoded.length>MAX_BYTES)invalid('serialized_capacity');
 // Caller must merge into the already atomic EventService $set patch; no
 // second write is sufficient to guarantee these tasks are never lost.
 return {
  patch:{
   assignment_effects_journal:encoded,
   assignment_effects_revision:next,
   assignment_effects_pending:true
  },tasks,revision:next,hasNewTasks:true,
  requiredConsumers:parity.requiredConsumers
 };
}
