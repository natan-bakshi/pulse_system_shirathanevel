import test from 'node:test';
import assert from 'node:assert/strict';
import {
 planLegacySupplierReplyRevisions,withLegacySupplierReplyRevisions,
 legacySupplierReplyRevision
} from '../base44/shared/legacySupplierReplyRevisions.ts';
import {assignmentWhatsAppKey,assignmentWhatsAppContext}
 from '../base44/shared/assignmentWhatsApp.ts';
import {checkLegacyAssignmentButtonCandidate,legacyAssignmentGeneration,
 legacyAssignmentRevisionEligibility,legacyRevisionFromOutboxKey}
 from '../base44/shared/legacyAssignmentButtonScope.ts';
import {persistAuthorizedSupplierStatus}
 from '../base44/shared/supplierStatusPersistence.ts';

const A='supplier-alpha',B='supplier-bravo',SERVICE='service-legacy-scope';
const time=Date.parse('2026-11-01T15:45:00Z');
const initial=()=>({
 id:SERVICE,event_id:'event-test',updated_date:'2026-11-01T15:45:00.000000',
 supplier_ids:'[]',supplier_statuses:'{}',supplier_notes:'{}',declined_suppliers:'[]'
});
function assign(s,ids=[A,B],at=time){
 const patch=withLegacySupplierReplyRevisions(s,{
  supplier_ids:JSON.stringify(ids),
  supplier_statuses:JSON.stringify(Object.fromEntries(ids.map(x=>[x,'pending'])))
 },at);
 return {...s,...patch,updated_date:new Date(at).toISOString().slice(0,-1)+'000'};
}
const originalJob=(s,supplier)=>({
 id:'outbox-'+supplier,source_type:'assignment_new',message_type:'text',
 requested_provider:'green',chat_id:'972501234567@c.us',
 event_service_id:s.id,supplier_id:supplier,
 idempotency_key:assignmentWhatsAppKey(s,supplier)
});
const scope=supplier=>({
 eventServiceId:SERVICE,supplierId:supplier,chatId:'972501234567@c.us'
});
test('new request generates distinct immutable legacy identity for each supplier',()=>{
 const s=assign(initial());
 const map=JSON.parse(s.supplier_assignment_reply_revisions);
 assert.match(map[A],/^r[1-9][0-9]{0,12}$/);
 assert.match(map[B],/^r[1-9][0-9]{0,12}$/);
 assert.notEqual(map[A],map[B]);
 for(const supplier of [A,B]){
  const job=originalJob(s,supplier);
  assert.match(job.idempotency_key,/:[A-Za-z0-9_-]+:l[0-9]+:SUPPLIER_NEW_ASSIGNMENT$/);
  assert.equal(legacyRevisionFromOutboxKey(job),map[supplier]);
  assert.equal(checkLegacyAssignmentButtonCandidate({
   service:s,job,target:scope(supplier)
  }).revision,map[supplier]);
 }
});
test('first WhatsApp approval cannot make a different supplier pending button stale',async()=>{
 const service=assign(initial());
 const pendingB=originalJob(service,B),revB=legacyAssignmentGeneration(service,B);
 const firstKey=assignmentWhatsAppKey(service,A);
 const prevKeyB=assignmentWhatsAppContext(service,B).idempotencyKey;
 const db={
  EventService:{
   get:async()=>structuredClone(service),
   updateMany:async(filter,patch)=>{
    if(Object.entries(filter).some(([k,v])=>(service[k]??null)!==(v??null)))
      return {updated:0};
    Object.assign(service,patch.$set,{updated_date:'2026-11-01T15:47:20.000000'});
    return {updated:1};
   }
  }
 };
 const client={entities:db};
 const first=await persistAuthorizedSupplierStatus(client,{
  eventServiceId:SERVICE,supplierId:A,
  source:'whatsapp',expectedRevision:legacyAssignmentGeneration(service,A),
  newStatus:'confirmed'
 });
 assert.equal(first.status,'confirmed');
 assert.equal(legacySupplierReplyRevision(service,A),null);
 assert.equal(JSON.parse(service.supplier_statuses)[B],'pending');
 assert.equal(legacyAssignmentRevisionEligibility(service,B,revB).allowed,true);
 assert.equal(assignmentWhatsAppKey(service,B),prevKeyB,
  'even the Outbox deduplication key stays stable despite a different supplier approval');
 assert.equal(checkLegacyAssignmentButtonCandidate({
  service,job:pendingB,target:scope(B)
 }).allowed,true,'queued B message can still be prepared after A approves');
 const other=await persistAuthorizedSupplierStatus(client,{
  eventServiceId:SERVICE,supplierId:B,source:'whatsapp',
  expectedRevision:revB,newStatus:'confirmed'
 });
 assert.equal(other.kind,'changed');
 assert.equal(JSON.parse(service.supplier_statuses)[A],'confirmed');
 assert.equal(JSON.parse(service.supplier_statuses)[B],'confirmed');
 assert.notEqual(firstKey,assignmentWhatsAppKey(service,A));
});
test('reopen, cancellation, or replacement invalidates old specific signed action',()=>{
 let s=assign(initial(),[A],time);
 const originalRevision=legacyAssignmentGeneration(s,A);
 const originalKey=assignmentWhatsAppKey(s,A);
 const approved=withLegacySupplierReplyRevisions(s,{
  supplier_statuses:JSON.stringify({[A]:'confirmed'})
 },time);
 s={...s,...approved,updated_date:'2026-11-01T15:50:00.000000'};
 assert.equal(legacyAssignmentRevisionEligibility(s,A,originalRevision).allowed,false);
 assert.match(JSON.parse(s.supplier_assignment_reply_revisions)[A],/^retired:r/);
 const reopened=withLegacySupplierReplyRevisions(s,{
  supplier_statuses:JSON.stringify({[A]:'pending'})
 },time);
 s={...s,...reopened,updated_date:'2026-11-01T15:51:00.000000'};
 assert.equal(legacyAssignmentRevisionEligibility(s,A,originalRevision).allowed,false);
 assert.notEqual(legacyAssignmentGeneration(s,A),originalRevision,
  'same millisecond cannot reuse original generation after reopen');
 assert.notEqual(assignmentWhatsAppKey(s,A),originalKey);
 const prior=legacyAssignmentGeneration(s,A);
 s={...s,...withLegacySupplierReplyRevisions(s,{
  supplier_ids:'[]',supplier_statuses:'{}'
 },time)};
 assert.equal(legacyAssignmentRevisionEligibility(s,A,prior).allowed,false);
 s={...s,...withLegacySupplierReplyRevisions(s,{
  supplier_ids:JSON.stringify([A]),supplier_statuses:JSON.stringify({[A]:'pending'})
 },time)};
 assert.notEqual(legacyAssignmentGeneration(s,A),prior);
});
test('unrelated price, calendar and other supplier edits cannot rotate a pending supplier',()=>{
 const s=assign(initial());
 const revision=legacyAssignmentGeneration(s,B),key=assignmentWhatsAppKey(s,B);
 const other=withLegacySupplierReplyRevisions(s,{price_display_text:'new price'},time+5);
 assert.equal(other.supplier_assignment_reply_revisions,undefined);
 const aChanged=withLegacySupplierReplyRevisions(s,{
  supplier_statuses:JSON.stringify({[A]:'rejected',[B]:'pending'})
 },time+6);
 const next={...s,...aChanged,updated_date:'2026-11-01T16:00:00.000000'};
 assert.equal(legacyAssignmentGeneration(next,B),revision);
 assert.equal(assignmentWhatsAppKey(next,B),key);
});
test('old unversioned existing assignments retain strict legacy full-row protection',()=>{
 const s={...initial(),supplier_ids:JSON.stringify([A]),
  supplier_statuses:JSON.stringify({[A]:'pending'})};
 const job=originalJob(s,A),rev=legacyAssignmentGeneration(s,A);
 assert.ok(job.idempotency_key.includes('2026-11-01T15:45:00.000000'));
 assert.equal(legacyAssignmentRevisionEligibility(s,A,rev).allowed,true);
 const changed={...s,updated_date:'2026-11-01T15:46:00.000000'};
 assert.equal(legacyAssignmentRevisionEligibility(changed,A,rev).allowed,false);
 assert.equal(checkLegacyAssignmentButtonCandidate({
  service:changed,job,target:scope(A)
 }).allowed,false);
});
test('durable V1 key remains isolated from per-supplier legacy map',()=>{
 const s=assign(initial(),[A]);
 s.assignment_intent_mode='durable_v1';
 s.assignment_notification_intents=JSON.stringify([{
  supplier_id:A,revision:4,state:'accepted',
  key:'assignment:'+SERVICE+':'+A+':r4:SUPPLIER_NEW_ASSIGNMENT'
 }]);
 assert.equal(assignmentWhatsAppKey(s,A),
  'assignment:'+SERVICE+':'+A+':r4:SUPPLIER_NEW_ASSIGNMENT');
});
test('invalid revision map cannot fall back to unsafe timestamp acceptance',()=>{
 const s={...assign(initial(),[A]),supplier_assignment_reply_revisions:'{invalid'};
 assert.equal(legacyAssignmentGeneration(s,A),null);
 assert.equal(legacyAssignmentRevisionEligibility(s,A,'r1793547900000').allowed,false);
 assert.throws(()=>planLegacySupplierReplyRevisions(s,{
  supplier_statuses:'{}'
 },time));
});
