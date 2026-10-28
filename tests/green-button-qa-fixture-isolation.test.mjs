import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {
 GREEN_BUTTON_QA_EVENT_NAME,GREEN_BUTTON_QA_FAMILY_NAME,
 GREEN_BUTTON_QA_SERVICE_NAME,isGreenButtonQaFixtureEvent,
 isGreenButtonQaFixtureEventPayload,isGreenButtonQaFixtureServicePayload
} from '../base44/shared/greenButtonQaFixture.ts';
const EVENT='event-qa-fixture-123',SERVICE='eventservice-qa-fixture-123';
const envValues={
 GREEN_BUTTONS_QA_EVENT_ID:EVENT,
 GREEN_BUTTONS_QA_EVENT_SERVICE_ID:SERVICE
};
const env=k=>envValues[k]||'';
const record={id:EVENT,event_name:GREEN_BUTTON_QA_EVENT_NAME,
 family_name:GREEN_BUTTON_QA_FAMILY_NAME,event_type:'other',status:'quote',
 event_date:'2026-11-30',whatsapp_buttons_qa_fixture:true};
const svc={id:SERVICE,event_id:EVENT,service_name:GREEN_BUTTON_QA_SERVICE_NAME,
 service_id:'catalog-qa-fixture-123',is_external:false,
 supplier_ids:'[]',supplier_statuses:'{}'};
test('fixture marker must match all fields, while ordinary business data never qualifies',()=>{
 assert.equal(isGreenButtonQaFixtureEvent(record),true);
 for(const patch of [
  {whatsapp_buttons_qa_fixture:false},
  {whatsapp_buttons_qa_fixture:'true'},
  {event_name:'Customer Bar Mitzvah'},
  {family_name:'Customer'},
  {event_type:'bar_mitzvah'}
 ]){
  assert.equal(isGreenButtonQaFixtureEvent({...record,...patch}),false);
 }
 assert.equal(isGreenButtonQaFixtureEventPayload(record,()=>''),true,
  'create fires before event ID can be pinned to a secret');
 assert.equal(isGreenButtonQaFixtureEventPayload({id:EVENT},env),true);
 assert.equal(isGreenButtonQaFixtureEventPayload({id:'other-event'},env),false);
 assert.equal(isGreenButtonQaFixtureServicePayload(svc,env),true);
 assert.equal(isGreenButtonQaFixtureServicePayload({
  id:'some-unrelated-service',event_id:'event-customer',
  service_name:GREEN_BUTTON_QA_SERVICE_NAME
 },env),false);
 assert.equal(isGreenButtonQaFixtureServicePayload({
  id:'some-unrelated-service',event_id:EVENT,service_name:'Real service'
 },env),false);
 assert.equal(isGreenButtonQaFixtureServicePayload(svc,()=>''),false,
  'no QA-service secret = no bypass on creation');
});
const fixtureModule={
 GREEN_BUTTON_QA_EVENT_NAME,GREEN_BUTTON_QA_FAMILY_NAME,
 GREEN_BUTTON_QA_SERVICE_NAME,isGreenButtonQaFixtureEvent,
 isGreenButtonQaFixtureEventPayload,isGreenButtonQaFixtureServicePayload
};
async function invoke(path,payload,{allowEventRead=false}={}){
 const counts={eventReads:0,extraReads:0,creates:0,updates:0,
  connectorCalls:0,providerSends:0};
 const db={
  Event:{
   get:async()=>{counts.eventReads++;return record;},
   filter:async()=>{counts.extraReads++;throw Error('Unexpected Event.filter');}
  }
 };
 const forbidden=new Proxy({},{
  get:(_t,k)=>async()=>{
   if(/create|update|delete/i.test(String(k)))counts.updates++;
   else counts.extraReads++;
   throw Error('Unexpected database access: '+String(k));
  }
 });
 const entities=new Proxy(db,{get:(target,key)=>target[key]||forbidden});
 const sdk={auth:{me:async()=>({role:'admin'})},
  asServiceRole:{entities,connectors:{getConnection:async()=>{
   counts.connectorCalls++;throw Error('No Google connector in QA');
  }}}
 };
 const source=fs.readFileSync(path,'utf8');
 const code=esbuild.transformSync(source,{
  loader:'ts',format:'cjs',target:'es2022'
 }).code;
 let handler;
 vm.runInNewContext(code,{
  exports:{},module:{exports:{}},
  Deno:{serve:fn=>handler=fn,env:{get:env}},
  Response:{json:(body,{status=200}={})=>({status,body})},
  console:{log:()=>{},warn:()=>{},error:()=>{}},
  require:specifier=>{
   if(specifier.startsWith('npm:@base44/sdk'))return {
    createClientFromRequest:()=>sdk
   };
   if(specifier.endsWith('/greenButtonQaFixture.ts'))return fixtureModule;
   if(specifier.endsWith('/identitySync.ts'))return{
    SYNC_ENTITIES:['Supplier','Event'],isValidEntityId:()=>true,
    syncEntityRecordToUsers:async()=>{counts.updates++;throw Error('No User writes');}
   };
   return new Proxy({}, {get:()=>()=>{counts.providerSends++;
    throw Error('Unexpected dependency during QA guard');}});
  }
 });
 assert.equal(typeof handler,'function',path);
 const response=await handler({
  method:'POST',json:async()=>payload
 });
 assert.equal(response.status,200,JSON.stringify({path,response}));
 assert.equal(response.body.skipped,true,JSON.stringify({path,response}));
 assert.match(response.body.reason,/qa_fixture/);
 assert.equal(counts.extraReads,0,path+' cannot read unrelated DB');
 assert.equal(counts.updates,0,path+' cannot write DB');
 assert.equal(counts.connectorCalls,0,path+' cannot invoke Google');
 assert.equal(counts.providerSends,0,path+' cannot notify provider');
 assert.equal(counts.eventReads,allowEventRead?1:0,path+' limited Event.get');
}
const eventPayload={event:{entity_name:'Event',type:'create',entity_id:EVENT},
 data:record};
const servicePayload={event:{entity_name:'EventService',type:'create',
 entity_id:SERVICE},data:svc};
test('event-create: entity notifications and Google Calendar abort before any provider or DB request',async()=>{
 await invoke('base44/functions/handleEntityEvents/entry.ts',eventPayload);
 await invoke('base44/functions/syncEventToGoogleCalendars/entry.ts',eventPayload);
});
test('EventService create and assignment update: no duplicate Push/Email, no Calendar connector',async()=>{
 for(const eventType of ['create','update']){
  const payload={event:{entity_name:'EventService',type:eventType,
   entity_id:SERVICE},data:svc,old_data:eventType==='update'?{
    ...svc,supplier_ids:'[]'
   }:undefined};
  await invoke('base44/functions/handleEntityEvents/entry.ts',payload);
  await invoke('base44/functions/syncEventToGoogleCalendars/entry.ts',payload);
  await invoke('base44/functions/onAssignmentChange/entry.ts',payload);
 }
});
test('one Event.get then no recurring quote, lifecycle, identity or user sync work',async()=>{
 await invoke('base44/functions/scheduleQuoteFollowup/entry.ts',eventPayload,
  {allowEventRead:true});
 await invoke('base44/functions/scheduleEventLifecycleNotifications/entry.ts',
  eventPayload,{allowEventRead:true});
 await invoke('base44/functions/syncSupplierPhonesToUsers/entry.ts',eventPayload,
  {allowEventRead:true});
 await invoke('base44/functions/syncEntityToUser/entry.ts',eventPayload,
  {allowEventRead:true});
});
test('only dedicated Event entity schema gains a QA boolean, off by default',()=>{
 const schema=JSON.parse(fs.readFileSync('base44/entities/Event.jsonc','utf8'));
 assert.equal(schema.properties.whatsapp_buttons_qa_fixture.type,'boolean');
 assert.equal(schema.properties.whatsapp_buttons_qa_fixture.default,false);
 assert.deepEqual(schema.required,['event_name','event_date','family_name']);
});
