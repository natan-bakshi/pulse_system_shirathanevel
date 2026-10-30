import test from 'node:test';
import assert from 'node:assert/strict';
import {
 checkLegacyAssignmentButtonCandidate,legacyAssignmentGeneration,
 legacyAssignmentRevisionEligibility
} from '../base44/shared/legacyAssignmentButtonScope.ts';
import {assignmentWhatsAppKey}
 from '../base44/shared/assignmentWhatsApp.ts';
import {persistAuthorizedSupplierStatus}
 from '../base44/shared/supplierStatusPersistence.ts';

const service=()=>({
 id:'service-123456',event_id:'event-123456',is_external:false,
 updated_date:'2026-10-30T05:52:19.719051',
 supplier_ids:'["supplier-123456"]',
 supplier_statuses:'{"supplier-123456":"pending"}',
 declined_suppliers:'[]'
});
const target=()=>({
 eventServiceId:'service-123456',supplierId:'supplier-123456',
 chatId:'972501234567@c.us'
});
const job=s=>({
 id:'outbox-123456',source_type:'assignment_new',message_type:'text',
 requested_provider:'green',event_service_id:s.id,
 supplier_id:'supplier-123456',chat_id:'972501234567@c.us',
 idempotency_key:assignmentWhatsAppKey(s,'supplier-123456')
});
test('canary reuses existing production Outbox business key, without touching legacy business update',()=>{
 const s=service(),j=job(s);
 const check=checkLegacyAssignmentButtonCandidate({service:s,job:j,target:target()});
 assert.equal(check.allowed,true);
 assert.match(check.revision,/^r[0-9]{13}$/);
 assert.equal(check.revision,legacyAssignmentGeneration(s));
 assert.equal(legacyAssignmentRevisionEligibility(s,'supplier-123456',check.revision).allowed,true);
 assert.equal(assignmentWhatsAppKey(s,'supplier-123456'),
  'assignment:service-123456:supplier-123456:2026-10-30T05:52:19.719000:SUPPLIER_NEW_ASSIGNMENT');
});
test('another supplier, another phone, old Outbox or group recipients cannot join canary',()=>{
 const s=service(),j=job(s);
 for(const patch of [
  {target:{...target(),chatId:'972509999999@c.us'}},
  {target:{...target(),chatId:'972501234567@g.us'}},
  {target:{...target(),supplierId:'supplier-OTHER1'}},
  {job:{...j,idempotency_key:'assignment:old'}},
  {job:{...j,source_type:'invoice'}},
  {job:{...j,requested_provider:'wasender'}}
 ]){
  const result=checkLegacyAssignmentButtonCandidate({
   service:s,job:j,target:target(),...patch
  });
  assert.equal(result.allowed,false,JSON.stringify(patch));
 }
});
test('a newer manager edit immediately invalidates an old button before and during CAS',()=>{
 const s=service(),revision=legacyAssignmentGeneration(s);
 s.updated_date='2026-10-30T05:52:20.000000';
 assert.equal(legacyAssignmentRevisionEligibility(s,'supplier-123456',revision).allowed,false);
 assert.equal(checkLegacyAssignmentButtonCandidate({
  service:s,job:job(service()),target:target()
 }).allowed,false);
});
test('old button remains stale after a manager rejects then reopens supplier pending',()=>{
 const s=service(),revision=legacyAssignmentGeneration(s);
 s.supplier_statuses='{"supplier-123456":"rejected"}';
 assert.equal(legacyAssignmentRevisionEligibility(s,'supplier-123456',revision).allowed,false);
 s.updated_date='2026-10-30T06:03:00.000000';
 s.supplier_statuses='{"supplier-123456":"pending"}';
 assert.equal(legacyAssignmentRevisionEligibility(s,'supplier-123456',revision).allowed,false);
});
test('unverifiable timestamps, corrupt statuses, V2 work and removed suppliers fail closed',()=>{
 const s=service(),j=job(s);
 for(const patch of [
  {updated_date:'not-a-date'}, {updated_date:''},
  {supplier_statuses:'{invalid'},{supplier_ids:'[]'},
  {assignment_intent_mode:'durable_v1'},
  {supplier_statuses:'{"supplier-123456":"rejected"}'}
 ]){
  assert.equal(checkLegacyAssignmentButtonCandidate({
   service:{...s,...patch},job:j,target:target()
  }).allowed,false,JSON.stringify(patch));
 }
});
test('existing supplier dashboard CAS remains independent from any Green provider setting',async()=>{
 const s=service(),writes=[];
 const db={entities:{EventService:{
  get:async()=>structuredClone(s),
  updateMany:async(q,p)=>{writes.push({q,p});return {updated:1}}
 }}};
 const saved=await persistAuthorizedSupplierStatus(db,{
  eventServiceId:s.id,supplierId:'supplier-123456',
  newStatus:'confirmed',source:'dashboard'
 });
 assert.equal(saved.kind,'changed');
 assert.equal(writes.length,1);
 assert.deepEqual(JSON.parse(writes[0].p.$set.supplier_statuses),
  {'supplier-123456':'confirmed'});
 assert.equal(writes[0].p.$set.assignment_intent_mode,undefined);
});
