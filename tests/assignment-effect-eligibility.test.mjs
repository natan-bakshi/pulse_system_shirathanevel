import test from 'node:test';
import assert from 'node:assert/strict';
import {planDurableAssignmentEffectJournal,readAssignmentEffectJournal}
 from '../base44/shared/assignmentEffectJournal.ts';
import {inspectAssignmentEffectEligibility}
 from '../base44/shared/assignmentEffectEligibility.ts';

const now=Date.parse('2026-10-30T06:00:00.000Z');
const origin=()=>({
 id:'service-ABC123',event_id:'event-ABC123',
 supplier_ids:'[]',supplier_statuses:'{}',supplier_notes:'{}'
});
const patch=()=>({
 supplier_ids:'["supplier-PEND11"]',
 supplier_statuses:'{"supplier-PEND11":"pending"}',
 supplier_notes:'{}'
});
const event=()=>({
 id:'event-ABC123',status:'closed',event_date:'2026-11-15'
});
function fixture(consumer){
 const before=origin(),p=patch();
 const plan=planDurableAssignmentEffectJournal(before,p,new Date(now).toISOString());
 const rows=readAssignmentEffectJournal(plan.patch.assignment_effects_journal);
 const original=rows.find(x=>x.consumer===consumer);
 assert.ok(original,'missing effect '+consumer);
 const claimed={...original,state:'claimed',claimedAt:new Date(now).toISOString(),
  claimToken:'claim-token-VALID123456789'};
 const updated=rows.map(x=>x.key===original.key?claimed:x);
 const service={...before,...p,...plan.patch,
  assignment_effects_journal:JSON.stringify(updated)};
 return {service,task:claimed,event:event()};
}
test('current pending supplier reminder and Push are eligible before event date',()=>{
 for(const consumer of ['supplier_assignment_push','supplier_pending_reminder']){
  const f=fixture(consumer);
  assert.deepEqual(inspectAssignmentEffectEligibility(f.task,f.service,f.event,now),
   {action:'run',reason:'latest_relevant_business_state'});
 }
});
test('approved or rejected supplier does not receive a stale pending assignment reminder',()=>{
 for(const target of ['confirmed','rejected','cancelled']){
  const f=fixture('supplier_pending_reminder');
  f.service.supplier_statuses=JSON.stringify({'supplier-PEND11':target});
  assert.equal(inspectAssignmentEffectEligibility(f.task,f.service,f.event,now).action,'cancel');
 }
});
test('removed supplier, cancelled event or already ended event never receives an old pending reminder',()=>{
 const f=fixture('supplier_pending_reminder');
 f.service.supplier_ids='[]';
 assert.equal(inspectAssignmentEffectEligibility(f.task,f.service,f.event,now).action,'cancel');
 const g=fixture('supplier_pending_reminder');
 g.event.status='cancelled';
 assert.equal(inspectAssignmentEffectEligibility(g.task,g.service,g.event,now).action,'cancel');
 const h=fixture('supplier_pending_reminder');
 h.event.event_date='2026-10-20';
 assert.equal(inspectAssignmentEffectEligibility(h.task,h.service,h.event,now).action,'cancel');
});
test('reopened generation supersedes old pending reminder even if current status is pending again',()=>{
 const f=fixture('supplier_pending_reminder');
 const second={...f.task,key:f.task.key.replace(':r1:',':r2:'),revision:2,
  state:'planned'};
 delete second.claimToken;delete second.claimedAt;
 f.service.assignment_effects_revision=2;
 const journal=readAssignmentEffectJournal(f.service.assignment_effects_journal);
 f.service.assignment_effects_journal=JSON.stringify([...journal,second]);
 const result=inspectAssignmentEffectEligibility(f.task,f.service,f.event,now);
 assert.deepEqual(result,{action:'cancel',reason:'superseded'});
});
test('generic notification tasks cannot fake historical changed-field values or template payload',()=>{
 const f=fixture('entity_update_notifications');
 assert.deepEqual(inspectAssignmentEffectEligibility(f.task,f.service,f.event,now),
  {action:'review',reason:'consumer_not_ready'});
});
test('calendar sync and event-status recalculation converge to newest revision only',()=>{
 for(const consumer of ['google_calendar_sync','event_status_readiness']){
  const f=fixture(consumer);
  assert.equal(inspectAssignmentEffectEligibility(f.task,f.service,f.event,now).action,'run');
  f.service.assignment_effects_revision=2;
  assert.deepEqual(inspectAssignmentEffectEligibility(f.task,f.service,f.event,now),
   {action:'cancel',reason:'superseded'});
 }
});
test('wrong event, invalid statuses and claims without ownership are never eligible for provider work',()=>{
 const f=fixture('supplier_assignment_push');
 assert.equal(inspectAssignmentEffectEligibility(f.task,f.service,{...f.event,id:'event-OTHER'},now).action,'review');
 f.service.supplier_statuses='{corrupt';
 assert.equal(inspectAssignmentEffectEligibility(f.task,f.service,f.event,now).action,'review');
 f.service.supplier_statuses=patch().supplier_statuses;
 const forgery={...f.task,claimToken:'someone-else'};
 assert.equal(inspectAssignmentEffectEligibility(forgery,f.service,f.event,now).action,'review');
});
test('historical supplier status update is reviewed, not silently dropped after a later status change',()=>{
 const before={...origin(),supplier_ids:'["supplier-PEND11"]',
  supplier_statuses:'{"supplier-PEND11":"pending"}'};
 const next={...patch(),supplier_statuses:'{"supplier-PEND11":"rejected"}'};
 const plan=planDurableAssignmentEffectJournal(before,next,new Date(now).toISOString());
 const rows=readAssignmentEffectJournal(plan.patch.assignment_effects_journal);
 const original=rows.find(x=>x.consumer==='assignment_status_notifications');
 const claimed={...original,state:'claimed',claimedAt:new Date(now).toISOString(),
  claimToken:'claim-token-STATUS12345678'};
 const rows2=rows.map(t=>t.key===claimed.key?claimed:t);
 const service={...before,...next,...plan.patch,
  assignment_effects_journal:JSON.stringify(rows2)};
 service.supplier_statuses='{"supplier-PEND11":"confirmed"}';
 assert.deepEqual(inspectAssignmentEffectEligibility(claimed,service,event(),now),
  {action:'review',reason:'invalid_business_state'});
});
test('unknown or malformed event date means a pending reminder needs manual review, never invented send time',()=>{
 const f=fixture('supplier_pending_reminder');
 f.event.event_date='invalid';
 assert.deepEqual(inspectAssignmentEffectEligibility(f.task,f.service,f.event,now),
  {action:'review',reason:'invalid_business_state'});
});
