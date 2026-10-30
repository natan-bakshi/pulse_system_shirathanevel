// Pure, server-only preflight for a FUTURE assignment side-effect adapter.
// This is not a notification sender and is not a rollout permission.
// The live worker must fetch a FRESH EventService + Event immediately before
// each external action, validate the lease's ownership and call this policy.
// Historical notification templates may require additional snapshots; never
// infer their original content from today's mutable EventService.
import {readAssignmentEffectJournal,type AssignmentEffectTask}
 from './assignmentEffectJournal.ts';

export type EffectPreflightDisposition=
 |{action:'run';reason:'latest_relevant_business_state'}
 |{action:'cancel';reason:'superseded'|'no_longer_applicable'}
 |{action:'review';reason:'invalid_business_state'|'consumer_not_ready'};
const review=(reason:'invalid_business_state'|'consumer_not_ready'):
 EffectPreflightDisposition=>({action:'review',reason});
const cancel=(reason:'superseded'|'no_longer_applicable'):
 EffectPreflightDisposition=>({action:'cancel',reason});
const run=():EffectPreflightDisposition=>
 ({action:'run',reason:'latest_relevant_business_state'});
const statusNames=new Set(['pending','confirmed','rejected','cancelled']);
function decode(raw:any,fallback:any){
 let data:any;
 try{data=typeof raw==='string'?JSON.parse(raw):raw??fallback;}
 catch{return null;}
 return data;
}
export function inspectAssignmentEffectEligibility(
 task:AssignmentEffectTask,service:any,event:any,nowMs=Date.now()
):EffectPreflightDisposition{
 if(!task||!service?.id||typeof task.key!=='string'||
  !task.key.startsWith('assignment-effect:'+service.id+':')||
  !Number.isSafeInteger(nowMs)||!event||event.id!==service.event_id||
  !Number.isSafeInteger(service.assignment_effects_revision)||
  task.revision>service.assignment_effects_revision)
  return review('invalid_business_state');
 const list=decode(service.supplier_ids,[]);
 const map=decode(service.supplier_statuses,{});
 if(!Array.isArray(list)||list.some(x=>typeof x!=='string')||
  new Set(list).size!==list.length||!map||Array.isArray(map)||
  typeof map!=='object')return review('invalid_business_state');
 let journal:AssignmentEffectTask[];
 try{journal=readAssignmentEffectJournal(service.assignment_effects_journal);}
 catch{return review('invalid_business_state');}
 if(!journal.some(x=>x.key===task.key&&x.claimToken===task.claimToken&&
  x.state==='claimed'))return review('invalid_business_state');
 if(journal.some(x=>x.key!==task.key&&x.revision>task.revision&&
  x.subjectId===task.subjectId&&x.consumer===task.consumer))
  return cancel('superseded');
 const newestSupplierChange=journal.some(x=>x.revision>task.revision&&
  x.subjectId===task.subjectId&&x.consumer!=='google_calendar_sync'&&
  x.consumer!=='entity_update_notifications'&&
  x.consumer!=='event_status_readiness');
 const latestServiceVersion=task.revision===service.assignment_effects_revision;
 if(['google_calendar_sync','event_status_readiness'].includes(task.consumer))
  return latestServiceVersion?run():cancel('superseded');
 if(task.consumer==='entity_update_notifications')
  // A list of changed field names is NOT old_data for arbitrary templates;
  // never fabricate historical content and claim template parity.
  return review('consumer_not_ready');
 if(![
  'supplier_assignment_push','supplier_pending_reminder',
  'assignment_removed_notifications','assignment_status_notifications'
 ].includes(task.consumer))return review('consumer_not_ready');
 const assigned=list.includes(task.subjectId);
 const current=map[task.subjectId]||'pending';
 if(!statusNames.has(current))return review('invalid_business_state');
 const closed=['cancelled','completed'].includes(event.status);
 const expiry=Date.parse(String(event.event_date||''));
 if(task.consumer==='supplier_assignment_push'||
  task.consumer==='supplier_pending_reminder'){
  if(newestSupplierChange)return cancel('superseded');
  if(closed||!assigned||current!==task.afterStatus)
   return cancel('no_longer_applicable');
  if(task.consumer==='supplier_pending_reminder'){
   if(task.afterStatus!=='pending')return review('invalid_business_state');
   // End-of-day is conservative for a date with no time information; the
   // real scheduling adapter must use effective supplier arrival time.
   if(!Number.isFinite(expiry))return review('invalid_business_state');
   if(nowMs>expiry+24*60*60*1000)return cancel('no_longer_applicable');
  }
  return run();
 }
 if(task.consumer==='assignment_removed_notifications'){
  // A later re-assignment needs a new business notification decision.
  if(newestSupplierChange||assigned)return review('invalid_business_state');
  return run();
 }
 if(task.consumer==='assignment_status_notifications'){
  // Historical rejection may still need notifying the office; never
  // silently cancel it just because a newer status was written.
  if(newestSupplierChange||!assigned||current!==task.afterStatus)
   return review('invalid_business_state');
  return run();
 }
 return review('consumer_not_ready');
}
