import test from 'node:test';
import assert from 'node:assert/strict';
import {
 greenButtonQaScopedV2Enabled,greenButtonQaScopedServiceMatches,
 greenButtonQaScopedJournalMatches
} from '../base44/shared/greenButtonQaScopedV2.ts';
import {GREEN_BUTTON_QA_SERVICE_NAME} from '../base44/shared/greenButtonQaFixture.ts';
import {
 sweepPendingSupplierAssignmentIntents,processSupplierAssignmentIntents
} from '../base44/shared/assignmentIntentReconciler.ts';
const SERVICE='qa-eventservice-123',EVENT='qa-event-123',SUPPLIER='qa-supplier-123';
const chat='972501234567@c.us';
const values={
 GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:'enabled',
 GREEN_BUTTONS_QA_SEND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_EVENT_ID:EVENT,
 GREEN_BUTTONS_QA_EVENT_SERVICE_ID:SERVICE,
 GREEN_BUTTONS_QA_SUPPLIER_ID:SUPPLIER,
 GREEN_BUTTONS_QA_ALLOWED_CHAT:chat
};
const env=k=>values[k]||'';
const service={id:SERVICE,event_id:EVENT,service_name:GREEN_BUTTON_QA_SERVICE_NAME,
 assignment_intents_pending:true,assignment_intent_mode:'durable_v1'};
const journal=[{supplier_id:SUPPLIER,qa_buttons_required:true}];
test('scoped QA gate is exact ID/phone/flag and cannot activate global V2 for other services',()=>{
 assert.equal(greenButtonQaScopedV2Enabled(env,SERVICE),true);
 assert.equal(greenButtonQaScopedV2Enabled(env,'customer-service-999'),false);
 assert.equal(greenButtonQaScopedServiceMatches(service,env),true);
 assert.equal(greenButtonQaScopedJournalMatches(service,journal,env),true);
 for(const [key,bad] of [
  ['GREEN_BUTTONS_QA_SCOPED_V2_ENABLED',''],
  ['GREEN_BUTTONS_QA_EVENT_ID','event-other'],
  ['GREEN_BUTTONS_QA_EVENT_SERVICE_ID','service-other'],
  ['GREEN_BUTTONS_QA_SUPPLIER_ID',''],
  ['GREEN_BUTTONS_QA_ALLOWED_CHAT','12345@g.us']
 ]){
  const invalid=k=>k===key?bad:env(k);
  assert.equal(greenButtonQaScopedServiceMatches(service,invalid),false);
 }
 assert.equal(greenButtonQaScopedJournalMatches(service,[],env),false);
 assert.equal(greenButtonQaScopedJournalMatches(service,[{...journal[0],qa_buttons_required:false}],env),false);
 assert.equal(greenButtonQaScopedJournalMatches(service,[...journal,...journal],env),false);
 assert.equal(greenButtonQaScopedJournalMatches(service,[{...journal[0],supplier_id:'another'}],env),false);
});
test('old signed QA service can be inbound-allowlisted but NEVER enters the NEW outbound scoped V2 island',()=>{
 const old='qa-previous-service-123';
 const secondEnv=k=>k==='GREEN_BUTTONS_QA_PREVIOUS_EVENT_SERVICE_ID'?old:
  k==='GREEN_BUTTONS_QA_EVENT_SERVICE_ID'?'qa-next-service-123':env(k);
 assert.equal(greenButtonQaScopedV2Enabled(secondEnv,'qa-next-service-123'),true);
 assert.equal(greenButtonQaScopedV2Enabled(secondEnv,old),false,
  'inbound historical allowlist cannot create an outgoing V2 intent');
 assert.equal(greenButtonQaScopedServiceMatches({...service,id:old},secondEnv),false);
 assert.equal(greenButtonQaScopedJournalMatches({...service,id:old},journal,secondEnv),false);
 assert.equal(greenButtonQaScopedServiceMatches({...service,id:'qa-next-service-123'},secondEnv),true);
});
test('global V2 off: only exact QA service can enter reconciler, with no DB scan',async()=>{
 let gets=0,queries=0;
 const client={asServiceRole:{entities:{
  AppSettings:{filter:async()=>[]},
  EventService:{
   get:async()=>{gets++;return service;},
   filter:async()=>{queries++;throw Error('No broad EventService scan allowed');}
  }
 }}};
 const result=await processSupplierAssignmentIntents(client,'some-customer-service',{
  qaEnv:env
 });
 assert.equal(result.reason,'feature_disabled');
 assert.equal(gets,0);
 assert.equal(queries,0);
});
test('idle pre-provisioning scoped V2 incurs ZERO extra EventService reads per watchdog',async()=>{
 let settings=0,reads=0;
 const client={asServiceRole:{entities:{
  AppSettings:{filter:async()=>{settings++;return[]}},
  EventService:{get:async()=>{reads++;throw Error('Idle QA read forbidden')}}
 }}};
 const envIdle=k=>k==='GREEN_BUTTONS_QA_SEND_ENABLED'||
  k==='GREEN_BUTTONS_QA_CREATE_ENABLED'?'':env(k);
 const response=await sweepPendingSupplierAssignmentIntents(client,{qaEnv:envIdle});
 assert.equal(response.success,true);
 assert.equal(response.reason,'qa_transport_not_armed');
 assert.equal(response.scanned,0);
 assert.equal(settings,1,'existing global V2 flag read only');
 assert.equal(reads,0,'no per-five-minute QA read while waiting for owner');
});
test('existing watchdog QA fallback performs ONE exact GET only while scoped gate is active',async()=>{
 const calls={settings:0,gets:0,scans:0,worker:0};
 let saved={...service,assignment_intents_pending:false};
 const client={asServiceRole:{entities:{
  AppSettings:{filter:async()=>{calls.settings++;return []}},
  EventService:{
   get:async id=>{assert.equal(id,SERVICE);calls.gets++;return saved;},
   filter:async()=>{calls.scans++;throw Error('No broad scans')}
  }
 }}};
 const first=await sweepPendingSupplierAssignmentIntents(client,{qaEnv:env,
  reconcile:async()=>{calls.worker++;throw Error('Should not reconcile');}});
 assert.equal(first.reason,'nothing_pending');
 assert.deepEqual(calls,{settings:1,gets:1,scans:0,worker:0});
 saved={...service,assignment_intents_pending:true};
 const second=await sweepPendingSupplierAssignmentIntents(client,{qaEnv:env,
  reconcile:async()=>{calls.worker++;return{success:true,reason:'reconciled',processed:1,blocked:0}}});
 assert.equal(second.reason,'reconciled');
 assert.equal(second.scanned,1);
 assert.equal(second.recovered,1);
 assert.deepEqual(calls,{settings:2,gets:2,scans:0,worker:1});
 const off=k=>k==='GREEN_BUTTONS_QA_SCOPED_V2_ENABLED'?'':env(k);
 const disabled=await sweepPendingSupplierAssignmentIntents(client,{qaEnv:off});
 assert.equal(disabled.reason,'feature_disabled');
 assert.deepEqual(calls,{settings:3,gets:2,scans:0,worker:1});
});
