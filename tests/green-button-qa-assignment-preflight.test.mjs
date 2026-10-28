import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGreenButtonQaAssignmentReadOnly}
 from '../base44/shared/greenButtonQaAssignmentPreflight.ts';
const SERVICE='service-abc',SUPPLIER='supplier-abc',CHAT='972501234567@c.us';
const KEY='assignment:service-abc:supplier-abc:r7:SUPPLIER_NEW_ASSIGNMENT';
const opts={eventServiceId:SERVICE,supplierId:SUPPLIER,chatId:CHAT};
function fixture(){
 const counts={service:0,supplier:0,outbox:0,writes:0,green:0};
 const service={id:SERVICE,is_external:false,event_id:'event-abc',
  supplier_ids:JSON.stringify([SUPPLIER]),
  supplier_statuses:JSON.stringify({[SUPPLIER]:'pending'}),
  assignment_intent_mode:'durable_v1',
  assignment_notification_intents:JSON.stringify([{
   supplier_id:SUPPLIER,key:KEY,revision:7,state:'queued',
   qa_buttons_required:true
  }])
 };
 const supplier={id:SUPPLIER,phone:'050-123-4567',is_active:true,
  whatsapp_enabled:true,preferred_channel:'phone',
  contact_person:'PRIVATE_SUPPLIER_NAME'};
 const job={id:'outbox-abc',idempotency_key:KEY,source_type:'assignment_new',
  event_service_id:SERVICE,supplier_id:SUPPLIER,chat_id:CHAT,
  requested_provider:'green',status:'queued',interactive_qa_required:true,
  attempt_count:0,
  send_started_at:'',provider_message_id:'',message_text:'PRIVATE_EVENT_MESSAGE'};
 let jobs=[job];
 const client={asServiceRole:{entities:{
  EventService:{get:async()=>{counts.service++;return service;}},
  Supplier:{get:async()=>{counts.supplier++;return supplier;}},
  WhatsAppOutbox:{filter:async(query,sort,limit,_offset,fields)=>{
   counts.outbox++;
   assert.equal(query.idempotency_key,KEY);
   assert.equal(limit,2);
   assert.equal(sort,'-created_date');
   assert.ok(!fields.includes('message_text'));
   return jobs.filter(j=>j.idempotency_key===query.idempotency_key)
    .slice(0,limit);
  }}
 }}};
 return {client,service,supplier,job,counts,setJobs:j=>{jobs=j}};
}
test('no configured QA target => zero database and zero provider calls',async()=>{
 const f=fixture();
 const result=await inspectGreenButtonQaAssignmentReadOnly(
  f.client,{eventServiceId:'',supplierId:SUPPLIER,chatId:CHAT});
 assert.equal(result.ready,false);
 assert.equal(result.databaseReads,0);
 assert.deepEqual(f.counts,{service:0,supplier:0,outbox:0,writes:0,green:0});
});
test('only exact pending service+supplier+chat with one unsent durable job passes',async()=>{
 const f=fixture();
 const result=await inspectGreenButtonQaAssignmentReadOnly(f.client,opts);
 assert.equal(result.ready,true);
 assert.equal(result.matchingQueueCount,'one');
 assert.equal(result.databaseReads,3);
 assert.equal(result.checks.every(c=>c.ready),true);
 assert.deepEqual(f.counts,{service:1,supplier:1,outbox:1,writes:0,green:0});
 const serialized=JSON.stringify(result);
 for(const secret of [SERVICE,SUPPLIER,CHAT,KEY,
  'PRIVATE_SUPPLIER_NAME','PRIVATE_EVENT_MESSAGE','050-123-4567'])
  assert.equal(serialized.includes(secret),false,'no PII '+secret);
});
test('group-preferred supplier is ready only after the same service has a pinned QA intent',async()=>{
 const f=fixture();
 f.supplier.preferred_channel='group';
 const journalBefore=JSON.parse(f.service.assignment_notification_intents);
 journalBefore[0].qa_buttons_required=false;
 f.service.assignment_notification_intents=JSON.stringify(journalBefore);
 const before=await inspectGreenButtonQaAssignmentReadOnly(f.client,opts);
 assert.equal(before.ready,false);
 assert.equal(f.counts.outbox,0);
 const journal=JSON.parse(f.service.assignment_notification_intents);
 journal[0].qa_buttons_required=true;
 f.service.assignment_notification_intents=JSON.stringify(journal);
 const after=await inspectGreenButtonQaAssignmentReadOnly(f.client,opts);
 assert.equal(after.ready,true);
 assert.equal(after.matchingQueueCount,'one');
 assert.equal(f.counts.outbox,1);
 assert.equal(f.supplier.preferred_channel,'group');
});
test('wrong phone or disabled supplier fails before querying WhatsAppOutbox',async()=>{
 for(const change of [
  {phone:'0509999999'},
  {whatsapp_enabled:false}
 ]){
  const f=fixture();
  Object.assign(f.supplier,change);
  const r=await inspectGreenButtonQaAssignmentReadOnly(f.client,opts);
  assert.equal(r.ready,false);
  assert.equal(f.counts.outbox,0);
  assert.equal(f.counts.writes,0);
 }
});
test('a plain unmarked Outbox row is never considered safe for an interactive pilot',async()=>{
 const f=fixture();
 f.job.interactive_qa_required=false;
 const r=await inspectGreenButtonQaAssignmentReadOnly(f.client,opts);
 assert.equal(r.ready,false);
 assert.equal(r.matchingQueueCount,'one');
 assert.equal(r.checks.find(c=>c.code==='qa_single_fresh_queued_assignment').ready,false);
 assert.equal(f.counts.writes,0);
 assert.equal(f.counts.green,0);
});
test('no durable QA marker blocks preflight even when an Outbox job falsely claims QA',async()=>{
 const f=fixture();
 const journal=JSON.parse(f.service.assignment_notification_intents);
 delete journal[0].qa_buttons_required;
 f.service.assignment_notification_intents=JSON.stringify(journal);
 const r=await inspectGreenButtonQaAssignmentReadOnly(f.client,opts);
 assert.equal(r.ready,false);
 assert.equal(f.counts.outbox,0);
 assert.equal(r.checks.find(c=>c.code==='qa_durable_v2_intent_valid').ready,false);
});
test('reopened status, missing assignment, missing journal or malformed intent cannot launch',async()=>{
 for(const mutate of [
  f=>{f.service.supplier_statuses=JSON.stringify({[SUPPLIER]:'rejected'})},
  f=>{f.service.supplier_ids='[]'},
  f=>{f.service.assignment_intent_mode='legacy'},
  f=>{f.service.assignment_notification_intents='{broken'},
  f=>{f.service.is_external=true}
 ]){
  const f=fixture();mutate(f);
  const r=await inspectGreenButtonQaAssignmentReadOnly(f.client,opts);
  assert.equal(r.ready,false);
  assert.equal(f.counts.outbox,0);
 }
});
test('accepted or already attempted job is not classified as fresh and never retried',async()=>{
 for(const patch of [
  {status:'accepted',provider_message_id:'3EB0ALREADYACCEPTED'},
  {status:'unknown',attempt_count:1},
  {status:'queued',attempt_count:1},
  {status:'sending',send_started_at:new Date().toISOString()}
 ]){
  const f=fixture();Object.assign(f.job,patch);
  const r=await inspectGreenButtonQaAssignmentReadOnly(f.client,opts);
  assert.equal(r.ready,false);
  assert.equal(r.previouslyAttempted,true);
  assert.equal(f.counts.writes,0);
  assert.equal(f.counts.green,0);
 }
});
test('duplicate exact-key outbox records require reconciliation, not a send',async()=>{
 const f=fixture();
 f.setJobs([f.job,{...f.job,id:'outbox-duplicate'}]);
 const r=await inspectGreenButtonQaAssignmentReadOnly(f.client,opts);
 assert.equal(r.ready,false);
 assert.equal(r.matchingQueueCount,'ambiguous');
 assert.equal(r.databaseReads,3);
 assert.equal(f.counts.writes,0);
});
