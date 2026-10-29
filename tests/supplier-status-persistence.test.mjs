import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {persistAuthorizedSupplierStatus,whatsappRevisionEligibility} from '../base44/shared/supplierStatusPersistence.ts';

function fixture(){
 const service={
  id:'service-abc',event_id:'event-123',is_external:false,
  supplier_ids:JSON.stringify(['supplier-aaa','supplier-bbb']),
  supplier_statuses:JSON.stringify({'supplier-aaa':'pending','supplier-bbb':'confirmed'}),
  declined_suppliers:'[]',assignment_intent_mode:'durable_v1',
  assignment_intent_revision:4,
  assignment_notification_intents:JSON.stringify([
   {supplier_id:'supplier-aaa',revision:3,state:'accepted',key:'assignment:service-abc:supplier-aaa:r3:SUPPLIER_NEW_ASSIGNMENT'},
   {supplier_id:'supplier-bbb',revision:4,state:'requested',key:'assignment:service-abc:supplier-bbb:r4:SUPPLIER_NEW_ASSIGNMENT'}
  ])
 };
 const events={reads:0,writes:0};
 let onCAS=null,onWrite=null;
 const equals=(row,query)=>Object.entries(query).every(([k,v])=>(row[k]??null)===(v??null));
 const entity={
  get:async()=>{events.reads++;return structuredClone(service);},
  updateMany:async(query,update)=>{
   if(onCAS){const callback=onCAS;onCAS=null;callback(service);}
   if(!equals(service,query))return {updated:0};
   Object.assign(service,update.$set);events.writes++;
   if(onWrite){const callback=onWrite;onWrite=null;callback();}
   return {updated:1};
  }
 };
 return {service,events,client:{entities:{EventService:entity}},
  mutateOnFirstCAS:fn=>onCAS=fn,afterWrite:fn=>onWrite=fn};
}
const req=(patch={})=>({eventServiceId:'service-abc',supplierId:'supplier-aaa',
 newStatus:'confirmed',source:'dashboard',...patch});
test('dashboard and WhatsApp share CAS writer without modifying other suppliers',async()=>{
 const f=fixture();
 const result=await persistAuthorizedSupplierStatus(f.client,req());
 assert.equal(result.kind,'changed');
 assert.equal(result.eventId,'event-123');
 assert.deepEqual(JSON.parse(f.service.supplier_statuses),{
  'supplier-aaa':'confirmed','supplier-bbb':'confirmed'
 });
 assert.equal(f.events.writes,1);
 const duplicate=await persistAuthorizedSupplierStatus(f.client,req());
 assert.equal(duplicate.kind,'unchanged');
 assert.equal(f.events.writes,1,'unchanged confirmation writes nothing');
});
test('in-app approval retires only that suppliers signed WhatsApp decision and preserves other pending work',async()=>{
 const f=fixture();
 f.service.assignment_intents_pending=true;
 const result=await persistAuthorizedSupplierStatus(f.client,req({
  newStatus:'confirmed',source:'dashboard'
 }));
 assert.equal(result.kind,'changed');
 const entries=JSON.parse(f.service.assignment_notification_intents);
 assert.equal(entries[0].state,'resolved');
 assert.equal(entries[0].resolution,'dashboard_status_changed');
 assert.equal(entries[1].state,'requested','other supplier must not be cancelled');
 assert.equal(f.service.assignment_intents_pending,true);
 assert.equal(f.events.writes,1,'business and signed-intent closure share one CAS');
 assert.equal(whatsappRevisionEligibility(f.service,'supplier-aaa','r3').allowed,false);
 assert.equal(whatsappRevisionEligibility(f.service,'supplier-bbb','r4').allowed,true);
});
test('in-app decline and later in-app reopening both remain possible but cannot revive old WhatsApp buttons',async()=>{
 const f=fixture();
 await persistAuthorizedSupplierStatus(f.client,req({newStatus:'rejected'}));
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-aaa'],'rejected');
 assert.equal(whatsappRevisionEligibility(f.service,'supplier-aaa','r3').allowed,false);
 await persistAuthorizedSupplierStatus(f.client,req({newStatus:'pending'}));
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-aaa'],'pending');
 assert.equal(whatsappRevisionEligibility(f.service,'supplier-aaa','r3').allowed,false);
 await assert.rejects(persistAuthorizedSupplierStatus(f.client,req({
  source:'whatsapp',expectedRevision:'r3',newStatus:'confirmed'
 })),e=>e.code==='assignment_intent_inactive');
 assert.equal(f.events.writes,2,'only the two in-app decisions wrote business state');
});
test('dashboard can change a WhatsApp-confirmed assignment and safely reopen it',async()=>{
 const f=fixture();
 await persistAuthorizedSupplierStatus(f.client,req({
  source:'whatsapp',expectedRevision:'r3',newStatus:'confirmed'
 }));
 await persistAuthorizedSupplierStatus(f.client,req({newStatus:'rejected'}));
 await persistAuthorizedSupplierStatus(f.client,req({newStatus:'pending'}));
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-aaa'],'pending');
 assert.equal(whatsappRevisionEligibility(f.service,'supplier-aaa','r3').allowed,false);
 assert.equal(f.events.writes,3);
});
test('a broken WhatsApp journal does not disable existing in-app status controls',async()=>{
 const f=fixture();
 f.service.assignment_notification_intents='{invalid';
 const changed=await persistAuthorizedSupplierStatus(f.client,req({newStatus:'rejected'}));
 assert.equal(changed.kind,'changed');
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-aaa'],'rejected');
 assert.equal(f.service.assignment_notification_intents,'{invalid');
 assert.equal(f.events.writes,1);
});
test('supplier declines are recorded once and CAS protects concurrent decline history',async()=>{
 const f=fixture();
 f.mutateOnFirstCAS(row=>{row.declined_suppliers=JSON.stringify([{supplier_id:'supplier-bbb',reason:'existing'}]);});
 const result=await persistAuthorizedSupplierStatus(f.client,req({newStatus:'rejected'}));
 assert.equal(result.kind,'changed');
 const history=JSON.parse(f.service.declined_suppliers);
 assert.equal(history.length,2);
 assert.equal(history.filter(x=>x.supplier_id==='supplier-aaa').length,1);
 assert.equal(history[0].supplier_id,'supplier-bbb');
 const again=await persistAuthorizedSupplierStatus(f.client,req({newStatus:'rejected'}));
 assert.equal(again.kind,'unchanged');
 assert.equal(JSON.parse(f.service.declined_suppliers).length,2);
});
test('strict WhatsApp reply only approves current pending supplier intent, even after unrelated global revision',async()=>{
 const f=fixture();
 assert.deepEqual(whatsappRevisionEligibility(f.service,'supplier-aaa','r3'),
  {allowed:true,reason:'current_assignment_revision'});
 assert.equal(whatsappRevisionEligibility(f.service,'supplier-aaa','r4').allowed,false);
 const result=await persistAuthorizedSupplierStatus(f.client,req({
  source:'whatsapp',expectedRevision:'r3'
 }));
 assert.equal(result.kind,'changed');
 assert.equal(f.events.writes,1);
 assert.equal((await persistAuthorizedSupplierStatus(f.client,req({
  source:'whatsapp',expectedRevision:'r3'
 }))).kind,'unchanged');
});
test('reassignment revision invalidates stale WhatsApp replies',async()=>{
 const f=fixture();
 f.service.assignment_notification_intents=JSON.stringify([
  ...JSON.parse(f.service.assignment_notification_intents),
  {supplier_id:'supplier-aaa',revision:5,state:'requested',
   key:'assignment:service-abc:supplier-aaa:r5:SUPPLIER_NEW_ASSIGNMENT'}
 ]);
 await assert.rejects(persistAuthorizedSupplierStatus(f.client,req({
  source:'whatsapp',newStatus:'rejected',expectedRevision:'r3'
 })),e=>e.code==='stale_assignment_revision');
 assert.equal(f.events.writes,0);
 assert.equal((await persistAuthorizedSupplierStatus(f.client,req({
  source:'whatsapp',newStatus:'rejected',expectedRevision:'r5'
 }))).status,'rejected');
});
test('WhatsApp reply rejected if intent cancelled, unavailable, corrupt, external or supplier removed',async()=>{
 const changes=[
  f=>{f.service.assignment_intent_mode='';},
  f=>{f.service.assignment_notification_intents='{';},
  f=>{f.service.assignment_notification_intents=JSON.stringify([
   {supplier_id:'supplier-aaa',revision:3,state:'cancelled',
    key:'assignment:service-abc:supplier-aaa:r3:SUPPLIER_NEW_ASSIGNMENT'}]);},
  f=>{f.service.is_external=true;},
  f=>{f.service.supplier_ids='["supplier-bbb"]';}
 ];
 for(const mutate of changes){
  const f=fixture();mutate(f);
  await assert.rejects(persistAuthorizedSupplierStatus(f.client,req({
   source:'whatsapp',newStatus:'rejected',expectedRevision:'r3'
  })));
  assert.equal(f.events.writes,0);
 }
});
test('dashboard rejection racing with inbound approval cannot be overwritten by stale reply',async()=>{
 const f=fixture();
 f.mutateOnFirstCAS(row=>{
  row.supplier_statuses=JSON.stringify({'supplier-aaa':'rejected','supplier-bbb':'confirmed'});
 });
 await assert.rejects(persistAuthorizedSupplierStatus(f.client,req({
  source:'whatsapp',newStatus:'confirmed',expectedRevision:'r3'
 })),e=>e.code==='stale_or_invalid_supplier_transition');
 assert.equal(f.events.writes,0);
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-aaa'],'rejected');
});
test('malformed supplier status/history never gets overwritten; conflicts do not corrupt JSON',async()=>{
 for(const field of ['supplier_statuses','declined_suppliers']){
  const f=fixture();f.service[field]='not json';
  await assert.rejects(persistAuthorizedSupplierStatus(f.client,req({
   newStatus:field==='declined_suppliers'?'rejected':'confirmed'
  })));
  assert.equal(f.events.writes,0);
  assert.equal(f.service[field],'not json');
 }
});
test('ambiguous persistence AFTER commit is not retried within the CAS helper',async()=>{
 const f=fixture();
 f.afterWrite(()=>{throw Error('CAS response lost after commit');});
 await assert.rejects(persistAuthorizedSupplierStatus(f.client,req({
  source:'whatsapp',newStatus:'confirmed',expectedRevision:'r3'
 })),/response lost/);
 assert.equal(f.events.writes,1,'never try supplier mutation twice after unclear result');
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-aaa'],'confirmed');
});
test('dashboard endpoint binds signed-in supplier and ignores client-forged WhatsApp source',async()=>{
 const source=esbuild.transformSync(fs.readFileSync('base44/functions/updateSupplierStatus/entry.ts','utf8'),{
  loader:'ts',format:'cjs',target:'es2022'
 }).code;
 const state={writes:0,source:null};
 let user={email:'supplier@example.com',phone:'0500000000'};
 let handler=null;
 const client={auth:{me:async()=>user},asServiceRole:{entities:{
  Supplier:{list:async()=>[{id:'supplier-aaa',phone:'0500000000',contact_emails:['supplier@example.com']}]}
 }}};
 vm.runInNewContext(source,{
  module:{exports:{}},exports:{},console:{error:()=>{}},
  Deno:{serve:fn=>handler=fn},
  Response:{json:(body,{status=200}={})=>({body,status})},
  require:name=>{
   if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
   if(name.endsWith('eventReadiness.ts'))return {
    recalculateEventStatus:async()=>({newStatus:'confirmed'})
   };
   if(name.endsWith('supplierStatusPersistence.ts'))return {
    persistAuthorizedSupplierStatus:async(_service,payload)=>{
     state.writes++;state.source=payload.source;
     return {kind:'changed',eventId:'event-123',status:payload.newStatus};
    }
   };
   throw Error('Unexpected import '+name);
  }
 });
 const submitted={eventServiceId:'service-abc',newStatus:'confirmed',source:'whatsapp',
  supplierId:'supplier-other',expectedRevision:'r999'};
 const accepted=await handler({method:'POST',json:async()=>submitted});
 assert.equal(accepted.status,200);assert.equal(accepted.body.status,'confirmed');
 assert.equal(state.source,'dashboard');
 assert.equal(state.writes,1);
 user={email:'other@example.com',phone:'000'};
 const forbidden=await handler({method:'POST',json:async()=>submitted});
 assert.equal(forbidden.status,403);assert.equal(state.writes,1);
 user=null;
 const unauthorized=await handler({method:'POST',json:async()=>submitted});
 assert.equal(unauthorized.status,401);
});
