import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summarizeOfficeAssignmentReference,inspectOfficeAssignmentReference}
 from '../base44/shared/whatsappOfficeReferenceLookup.ts';
const base=()=>({
 id:'outbox-ABC123',source_type:'assignment_new',status:'accepted',
 event_service_id:'service-ABC123',supplier_id:'supplier-ABC123',
 provider:'green',requested_provider:'green',provider_message_id:'3EB0-PROVIDER-SECRET',
 idempotency_key:'assignment:service-ABC123:supplier-ABC123:r4:SUPPLIER_NEW_ASSIGNMENT',
 assignment_revision:'r4',interactive_button_bindings_json:'NEVER-SHOW-THIS-SIGNED-SNAPSHOT',
 sender_account_id:'9990001234567',chat_id:'972501234567@c.us',
 message_text:'PRIVATE-WHATSAPP-MESSAGE',client_url:'https://private.invalid/signed'
});
const service=()=>({
 id:'service-ABC123',event_id:'event-ABC123',service_name:'הרכב תזמורת',
 supplier_ids:'["supplier-ABC123"]',supplier_statuses:'{"supplier-ABC123":"pending"}',
 assignment_intent_mode:'durable_v1',
 assignment_notification_intents:JSON.stringify([
  {key:'assignment:service-ABC123:supplier-ABC123:r4:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-ABC123',revision:4,state:'accepted'}
 ]),
 client_notes:'PRIVATE-CUSTOMER-DETAIL',admin_notes:'PRIVATE-ADMIN-NOTES'
});
const event=()=>({
 id:'event-ABC123',event_name:'בר מצווה לדוגמה',event_date:'2027-06-14',
 payer_email:'PRIVATE-PAYER-EMAIL'
});
const supplier=()=>({
 id:'supplier-ABC123',supplier_name:'תזמורת לדוגמה',
 phone:'0501112233',contact_emails:['private-supplier@example.invalid']
});
function fixture(){
 const row=base(),svc=service(),ev=event(),sup=supplier();
 const reads=[],writes=[];
 const client={asServiceRole:{entities:{
  WhatsAppOutbox:{get:async id=>{reads.push('outbox');return id===row.id?row:null;},
   filter:async()=>{throw Error('No scanning');},
   list:async()=>{throw Error('No scanning');},
   updateMany:async()=>{writes.push('outbox');throw Error('Never mutate');}},
  EventService:{get:async id=>{reads.push('service');return id===svc.id?svc:null;}},
  Event:{get:async id=>{reads.push('event');return id===ev.id?ev:null;}},
  Supplier:{get:async id=>{reads.push('supplier');return id===sup.id?sup:null;}}
 }}};
 return {row,svc,ev,sup,client,reads,writes};
}
test('one verified office reference maps to its original event/service/supplier, not latest message',async()=>{
 const f=fixture(),result=await inspectOfficeAssignmentReference(f.client,'outbox-ABC123');
 assert.equal(result.reference,'outbox-ABC123');
 assert.equal(result.eventName,'בר מצווה לדוגמה');
 assert.equal(result.eventDate,'2027-06-14');
 assert.equal(result.serviceName,'הרכב תזמורת');
 assert.equal(result.supplierName,'תזמורת לדוגמה');
 assert.equal(result.supplierStatus,'pending');
 assert.equal(result.originState,'current_revision');
 assert.equal(result.currentRevisionVerified,true);
 assert.equal(result.providerReceiptPresent,true);
 assert.equal(result.providerReceiptIsNotDeliveryProof,true);
 assert.equal(result.referenceOnlyNotAuthorization,true);
 assert.equal(result.statusDoesNotProveButtonClick,true);
 assert.equal(result.noBusinessWrites,true);
 assert.equal(result.noMessagesSent,true);
 assert.deepEqual(f.reads,['outbox','service','supplier','event']);
 assert.equal(f.writes.length,0);
 const output=JSON.stringify(result);
 for(const sensitive of ['PRIVATE-WHATSAPP-MESSAGE','NEVER-SHOW-THIS-SIGNED-SNAPSHOT',
  '3EB0-PROVIDER-SECRET','972501234567','0501112233','PRIVATE-CUSTOMER-DETAIL',
  'PRIVATE-PAYER-EMAIL','PRIVATE-ADMIN-NOTES','9990001234567','private-supplier@example.invalid'])
  assert.equal(output.includes(sensitive),false,sensitive);
});
test('old revision and removed assignment remain historical, never presented as current',()=>{
 const f=fixture();
 f.svc.assignment_notification_intents=JSON.stringify([
  {supplier_id:'supplier-ABC123',revision:4,
   key:'assignment:service-ABC123:supplier-ABC123:r4:SUPPLIER_NEW_ASSIGNMENT',
   state:'accepted'},
  {supplier_id:'supplier-ABC123',revision:5,
   key:'assignment:service-ABC123:supplier-ABC123:r5:SUPPLIER_NEW_ASSIGNMENT',
   state:'requested'}
 ]);
 const old=summarizeOfficeAssignmentReference(f.row,f.svc,f.ev,f.sup);
 assert.equal(old.originState,'superseded_revision');
 assert.equal(old.currentRevisionVerified,false);
 f.svc.supplier_ids='[]';
 const removed=summarizeOfficeAssignmentReference(f.row,f.svc,f.ev,f.sup);
 assert.equal(removed.originState,'supplier_no_longer_assigned');
 assert.equal(removed.supplierStatus,'pending','Historical JSON status is not proof of active assignment');
});
test('legacy, missing event, corrupt journal and invalid status are not falsely marked verified',()=>{
 const f=fixture();
 f.svc.assignment_intent_mode='';
 let result=summarizeOfficeAssignmentReference(f.row,f.svc,f.ev,f.sup);
 assert.equal(result.originState,'legacy_unverified');
 f.svc.assignment_intent_mode='durable_v1';
 f.svc.assignment_notification_intents='{';
 f.svc.supplier_statuses='{';
 result=summarizeOfficeAssignmentReference(f.row,f.svc,null,f.sup);
 assert.equal(result.originState,'corrupt_intent_history');
 assert.equal(result.supplierStatus,'unavailable');
 assert.equal(result.eventName,'');
 assert.equal(result.eventDate,'');
 result=summarizeOfficeAssignmentReference(f.row,null,f.ev,f.sup);
 assert.equal(result.originState,'service_not_found');
 assert.equal(result.serviceName,'');
 assert.equal(result.eventName,'');
});
test('input is an exact reference only, never a search term/phone/SQL/filter',async()=>{
 for(const invalid of ['', 'outbox-ABC123 ', ' outbox-ABC123', 'אסמכתא: outbox-ABC123',
  '972501234567@c.us', 'abc/../other', 'job?', 'job\nquery', 'x'.repeat(129),null,123]){
  const f=fixture();
  await assert.rejects(inspectOfficeAssignmentReference(f.client,invalid),
   e=>e.status===400);
  assert.deepEqual(f.reads,[],'Invalid references never reach DB');
 }
});
test('not-found and unrelated invoice lookups avoid extra reads or any message exposure',async()=>{
 const f=fixture();
 await assert.rejects(inspectOfficeAssignmentReference(f.client,'unknown-123'),
  e=>e.status===404);
 assert.deepEqual(f.reads,['outbox']);
 const other=fixture();
 other.row.source_type='invoice';
 await assert.rejects(inspectOfficeAssignmentReference(other.client,other.row.id),
  e=>e.status===404);
 assert.deepEqual(other.reads,['outbox']);
});
test('dependent GET outage fails closed without partial successful result',async()=>{
 const f=fixture();
 f.client.asServiceRole.entities.Supplier.get=async()=>{throw Error('database unavailable')};
 await assert.rejects(inspectOfficeAssignmentReference(f.client,f.row.id),e=>e.status===503);
 assert.equal(f.writes.length,0);
});
test('UI lookup is collapsed, requires explicit click, and does not run alongside routine status refresh',()=>{
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 assert.match(ui,/onClick=\{\(\)=>run\('officeReferenceLookup',\{reference:officeReference\}\)\}/);
 assert.match(ui,/action==='officeReferenceLookup'/);
 assert.match(ui,/disabled=\{busy\|\|!\/\^\[A-Za-z0-9_-\]/);
 assert.doesNotMatch(ui,/useEffect\(\(\)=>run\('officeReferenceLookup'/);
});
