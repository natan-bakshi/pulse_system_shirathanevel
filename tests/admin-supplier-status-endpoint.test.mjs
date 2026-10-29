import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {persistAuthorizedSupplierStatus,whatsappRevisionEligibility}
 from '../base44/shared/supplierStatusPersistence.ts';

const makeFixture=({rolloutEnabled=true}={})=>{
 const supplierId='supplier-abc',serviceId='service-abc';
 const state={
  id:serviceId,event_id:'event-abc',supplier_ids:JSON.stringify([supplierId]),
  supplier_statuses:JSON.stringify({[supplierId]:'pending'}),
  supplier_notes:JSON.stringify({[supplierId]:'original'}),
  declined_suppliers:'[]',assignment_intent_mode:'durable_v1',
  assignment_intents_pending:false,
  assignment_notification_intents:JSON.stringify([{
   supplier_id:supplierId,revision:1,state:'accepted',
   key:'assignment:service-abc:supplier-abc:r1:SUPPLIER_NEW_ASSIGNMENT'
  }])
 };
 let actor={role:'admin',email:'admin@example.com'};
 const stats={writes:0,eventCalculations:0,providerCalls:0};
 let eventFailure=false;
 let enabled=rolloutEnabled;
 const equals=(row,q)=>Object.entries(q).every(([k,v])=>
  (row[k]??null)===(v??null));
 const client={auth:{me:async()=>actor},asServiceRole:{entities:{
  AppSettings:{filter:async(query)=>{
   assert.equal(query.setting_key,'admin_supplier_status_atomic_rollout_enabled');
   return enabled?[{setting_value:'true'}]:[];
  }},
  EventService:{
   get:async id=>id===serviceId?structuredClone(state):null,
   updateMany:async(q,p)=>{
    if(!equals(state,q))return {updated:0};
    Object.assign(state,p.$set);stats.writes++;return {updated:1};
   }
  },
  WhatsAppOutbox:{create:()=>{stats.providerCalls++;throw Error('provider forbidden')}}
 }}};
 let handler;
 const compiled=esbuild.transformSync(fs.readFileSync(
  'base44/functions/adminUpdateSupplierStatus/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
  }).code;
 vm.runInNewContext(compiled,{
  module:{exports:{}},exports:{},
  Deno:{serve:fn=>{handler=fn}},
  Response:{json:(body,{status=200}={})=>({body,status})},
  console:{error:()=>{}},
  require:name=>{
   if(name.startsWith('npm:@base44/sdk'))
    return {createClientFromRequest:()=>client};
   if(name.endsWith('supplierStatusPersistence.ts'))
    return {persistAuthorizedSupplierStatus};
   if(name.endsWith('eventReadiness.ts'))
    return {recalculateEventStatus:async()=>{
     stats.eventCalculations++;
     if(eventFailure)throw Error('only readiness failed');
     return {newStatus:'in_progress'};
    }};
   throw Error('Unexpected import '+name);
  }
 });
 return {supplierId,serviceId,state,stats,
  setActor:v=>{actor=v;},
  failEvent:()=>{eventFailure=true;},
  setRollout:v=>{enabled=v;}, 
  call:(b,method='POST')=>handler({method,json:async()=>b}),
  req:(patch={})=>({
   eventServiceId:serviceId,supplierId,newStatus:'confirmed',
   expectedStatus:'pending',...patch
  })};
};

test('admin approval through the existing Pulse interface closes old signed WhatsApp decisions atomically',async()=>{
 const f=makeFixture();
 const r=await f.call(f.req());
 assert.equal(r.status,200);assert.equal(r.body.success,true);
 assert.equal(f.stats.writes,1);assert.equal(f.stats.eventCalculations,1);
 assert.equal(JSON.parse(f.state.supplier_statuses)[f.supplierId],'confirmed');
 assert.equal(JSON.parse(f.state.assignment_notification_intents)[0].state,'resolved');
 assert.equal(whatsappRevisionEligibility(f.state,f.supplierId,'r1').allowed,false);
 assert.equal(f.stats.providerCalls,0);
});
test('admin can decline from Pulse without pretending a supplier clicked WhatsApp',async()=>{
 const f=makeFixture();
 const r=await f.call(f.req({newStatus:'rejected'}));
 assert.equal(r.status,200);
 assert.equal(JSON.parse(f.state.declined_suppliers)[0].declined_by_supplier,false);
 assert.equal(f.stats.writes,1);
});
test('existing administrator can update an assignment note without changing supplier status or cancelling a pending button',async()=>{
 const f=makeFixture();
 const r=await f.call(f.req({
  newStatus:'pending',supplierNote:'updated via dashboard'
 }));
 assert.equal(r.status,200);
 assert.equal(JSON.parse(f.state.supplier_notes)[f.supplierId],'updated via dashboard');
 assert.equal(JSON.parse(f.state.assignment_notification_intents)[0].state,'accepted');
 assert.equal(JSON.parse(f.state.supplier_statuses)[f.supplierId],'pending');
 assert.equal(f.stats.writes,1);
});
test('stale in-app editor loses to an earlier WhatsApp or dashboard supplier decision',async()=>{
 const f=makeFixture();
 f.state.supplier_statuses=JSON.stringify({[f.supplierId]:'rejected'});
 const r=await f.call(f.req());
 assert.equal(r.status,409);
 assert.equal(f.stats.writes,0);
 assert.equal(JSON.parse(f.state.supplier_statuses)[f.supplierId],'rejected');
});
test('admin write is blocked for unauthenticated or supplier role, and cannot be forged with source in request',async()=>{
 const f=makeFixture();
 f.setActor(null);
 assert.equal((await f.call(f.req())).status,401);
 f.setActor({role:'supplier'});
 assert.equal((await f.call(f.req())).status,403);
 f.setActor({role:'admin'});
 assert.equal((await f.call(f.req({supplierNote:123}))).status,400);
 assert.equal(f.stats.writes,0);
 const ok=await f.call({...f.req(),source:'whatsapp',expectedRevision:'r1'});
 assert.equal(ok.status,200);
 assert.equal(JSON.parse(f.state.assignment_notification_intents)[0].state,'resolved');
});
test('after committed admin status CAS, failed event recalculation reports saved without another business write',async()=>{
 const f=makeFixture();f.failEvent();
 const r=await f.call(f.req());
 assert.equal(r.status,200);
 assert.equal(r.body.saved,true);
 assert.equal(r.body.eventStatusUpdated,false);
 assert.equal(f.stats.writes,1);assert.equal(f.stats.eventCalculations,1);
});
test('no settings flag means staged admin CAS endpoint performs zero writes',async()=>{
 const f=makeFixture({rolloutEnabled:false});
 const denied=await f.call(f.req());
 assert.equal(denied.status,423);
 assert.equal(f.stats.writes,0);
 assert.equal(f.stats.providerCalls,0);
});
test('existing admin EventService update workflows are preserved while CAS migration remains staged',()=>{
 const event=fs.readFileSync('src/pages/EventDetails.jsx','utf8');
 const board=fs.readFileSync('src/components/events/EventsBoard.jsx','utf8');
 const supplier=fs.readFileSync('src/pages/SupplierDashboard.jsx','utf8');
 assert.match(event,/base44\.entities\.EventService\.update\(eventServiceId, updateData\)/);
 assert.match(board,/base44\.entities\.EventService\.update\(editingAssignment\.eventServiceId/);
 assert.match(board,/await refreshEventStatus\(eventService\.event_id\)/);
 assert.doesNotMatch(event,/functions\.invoke\('adminUpdateSupplierStatus'/);
 assert.doesNotMatch(board,/functions\.invoke\('adminUpdateSupplierStatus'/);
 assert.match(supplier,/base44\.functions\.invoke\('updateSupplierStatus'/);
 assert.match(supplier,/handleStatusChange\(event\.eventServiceId, 'confirmed'\)/);
 assert.match(supplier,/handleStatusChange\(event\.eventServiceId, 'rejected'\)/);
});
