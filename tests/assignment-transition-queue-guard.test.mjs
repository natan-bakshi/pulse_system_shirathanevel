import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {assignmentTransitionWhatsAppKey} from '../base44/shared/assignmentTransitionWhatsApp.ts';

function testHarness(functionName,{mode='notify',failureSupplier='supplier-b',actor={role:'admin'}}={}){
 const event={id:'event-demo',event_date:'2026-11-21',event_time:'11:00',
   previous_event_date:'2026-11-20',previous_event_time:'09:00',
   date_change_pending_action:true,status:'confirmed',family_name:'Demo'};
 const service={id:'es-demo',event_id:event.id,service_id:'service-demo',
   supplier_ids:JSON.stringify(['supplier-a','supplier-b']),
   supplier_statuses:JSON.stringify({'supplier-a':'approved','supplier-b':'approved'}),
   supplier_notes:'{}',supplier_arrival_time:functionName==='confirmReassignAfterDateChange'?'':'10:15'};
 const suppliers={
   'supplier-a':{id:'supplier-a',phone:'0501111111',contact_emails:[],whatsapp_enabled:true,supplier_name:'Supplier A'},
   'supplier-b':{id:'supplier-b',phone:'0502222222',contact_emails:[],whatsapp_enabled:true,supplier_name:'Supplier B'}
 };
 const sends=[],createdKeys=new Set(),eventsUpdated=[],servicesUpdated=[],sideEffects=[];
 let failSupplier=failureSupplier;
 const db={
  Event:{get:async()=>event,update:async(id,patch)=>{assert.equal(id,event.id);eventsUpdated.push({...patch});Object.assign(event,patch);return event;}},
  EventService:{
    get:async()=>service,filter:async()=>[service],
    update:async(id,patch)=>{assert.equal(id,service.id);servicesUpdated.push({...patch});Object.assign(service,patch);return service;}
  },
  Service:{get:async()=>({id:'service-demo',service_name:'Sample band'})},
  Supplier:{get:async id=>suppliers[id]||null},
  NotificationTemplate:{filter:async query=>[{
    id:'template-one',type:query.trigger_type==='supplier_assignment_delete'?'SUPPLIER_CANCEL':'SUPPLIER_CHANGE',
    allowed_channels:['whatsapp'],target_audiences:['supplier'],
    title_template:'Update',body_template:'Update text',whatsapp_body_template:'Message {{supplier_name}}'
  }]},
  User:{filter:async()=>[]}
 };
 const client={auth:{me:async()=>actor},asServiceRole:{entities:db}};
 const code=esbuild.transformSync(fs.readFileSync('base44/functions/'+functionName+'/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
 }).code;
 let handler;
 vm.runInNewContext(code,{
  exports:{},module:{exports:{}},Deno:{serve:fn=>handler=fn},
  Response:{json:(body,{status=200}={})=>({body,status})},
  console:{log:()=>{},warn:()=>{},error:()=>{}},
  require:name=>{
   if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
   if(name.endsWith('eventFields.js'))return {getClientContacts:()=>[]};
   if(name.endsWith('eventReadiness.ts'))return {recalculateEventStatus:async()=>sideEffects.push('recalculate')};
   if(name.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
   if(name.endsWith('eventName.ts'))return {getEventDisplayName:()=>''};
   if(name.endsWith('notificationCore.ts'))return {createNotificationCore:async()=>{
     sideEffects.push('notification');return {ok:true};
   }};
   if(name.endsWith('assignmentTransitionWhatsApp.ts'))return {
    enqueueAssignmentTransitionWhatsApp:async(_client,phone,_message,identity,sourceType)=>{
      const key=await assignmentTransitionWhatsAppKey(identity);
      sends.push({key,identity,sourceType,phone});
      if(identity.supplierId===failSupplier)throw Object.assign(new Error('Synthetic Outbox create failure'),{outboxStatus:'unverified'});
      const exists=createdKeys.has(key);
      createdKeys.add(key);
      return {status:'queued',jobId:'job-'+identity.supplierId,deduplicated:exists};
    }
   };
   throw Error('Unexpected import '+name);
  }
 });
 const call=async()=>handler({method:'POST',json:async()=>functionName==='handleSupplierArrivalTimeChange'
   ?{event_service_id:service.id,mode}:{event_id:event.id}});
 return {call,event,service,sends,createdKeys,eventsUpdated,servicesUpdated,sideEffects,
   failOff:()=>{failSupplier=''},setMode:next=>{mode=next}};
}
test('same business transition has same key across retry, different supplier/time/operation have distinct keys',async()=>{
 const base={kind:'arrival_notify',eventId:'e1',eventServiceId:'svc1',
   supplierId:'sup1',templateId:'t1',eventDate:'2026-11-20',eventTime:'10:00',supplierArrivalTime:'08:30'};
 const key=await assignmentTransitionWhatsAppKey(base);
 assert.equal(key,await assignmentTransitionWhatsAppKey({...base}));
 assert.notEqual(key,await assignmentTransitionWhatsAppKey({...base,supplierId:'sup2'}));
 assert.notEqual(key,await assignmentTransitionWhatsAppKey({...base,supplierArrivalTime:'09:15'}));
 assert.notEqual(key,await assignmentTransitionWhatsAppKey({...base,kind:'arrival_cancel'}));
 assert.notEqual(key,await assignmentTransitionWhatsAppKey({...base,templateId:'t2'}));
 assert.ok(key.length<140);
 await assert.rejects(assignmentTransitionWhatsAppKey({...base,supplierId:''}),/incomplete/);
});
test('event cancellation failure cannot clear assignments or the pending event-change flag',async()=>{
 const x=testHarness('cancelAssignmentsAfterDateChange');
 const a=await x.call();
 assert.equal(a.status,409);assert.equal(a.body.success,false);
 assert.equal(a.body.recovery_required,true);
 assert.equal(a.body.whatsapp_confirmed,1);
 assert.equal(a.body.whatsapp_failures,1);
 assert.equal(x.servicesUpdated.length,0);
 assert.equal(x.eventsUpdated.length,0);
 assert.equal(x.event.date_change_pending_action,true);
 assert.equal(x.createdKeys.size,1);
 x.failOff();
 const b=await x.call();
 assert.equal(b.status,200);assert.equal(b.body.success,true);
 assert.equal(x.createdKeys.size,2,'Retry must not create a second Outbox job for supplier A');
 assert.equal(x.sends[0].key,x.sends[2].key);
 assert.deepEqual(JSON.parse(x.service.supplier_ids),[]);
 assert.equal(x.event.date_change_pending_action,false);
});
test('date re-confirmation failure keeps recovery flag and stable idempotency keys',async()=>{
 const x=testHarness('confirmReassignAfterDateChange');
 const a=await x.call();
 assert.equal(a.status,409);assert.equal(a.body.recovery_required,true);
 assert.equal(x.event.date_change_pending_action,true);
 assert.equal(JSON.parse(x.service.supplier_statuses)['supplier-a'],'pending');
 assert.equal(x.createdKeys.size,1);
 x.failOff();
 const b=await x.call();
 assert.equal(b.status,200);
 assert.equal(x.event.date_change_pending_action,false);
 assert.equal(x.createdKeys.size,2);
 assert.equal(x.sends[0].key,x.sends[2].key);
});
test('arrival-time cancellation failure leaves assigned suppliers in service',async()=>{
 const x=testHarness('handleSupplierArrivalTimeChange',{mode:'cancel'});
 const a=await x.call();
 assert.equal(a.status,409);assert.equal(a.body.mode,'cancel');
 assert.deepEqual(JSON.parse(x.service.supplier_ids),['supplier-a','supplier-b']);
 assert.equal(x.event.date_change_pending_action,true);
 x.failOff();
 const b=await x.call();
 assert.equal(b.status,200);
 assert.deepEqual(JSON.parse(x.service.supplier_ids),[]);
 assert.equal(x.createdKeys.size,2);
 assert.equal(x.sends[0].key,x.sends[2].key);
});
test('arrival-time notify partial failure reports incomplete and can be safely repeated',async()=>{
 const x=testHarness('handleSupplierArrivalTimeChange',{mode:'notify'});
 const a=await x.call();
 assert.equal(a.status,409);assert.equal(a.body.whatsapp_failures,1);
 assert.equal(JSON.parse(x.service.supplier_statuses)['supplier-b'],'pending');
 assert.equal(x.createdKeys.size,1);
 x.failOff();
 const b=await x.call();
 assert.equal(b.status,200);assert.equal(b.body.mode,'notify');
 assert.equal(x.createdKeys.size,2);
});
test('unauthorized supplier cannot execute change/cancel workflows',async()=>{
 for(const path of ['handleSupplierArrivalTimeChange','cancelAssignmentsAfterDateChange','confirmReassignAfterDateChange']){
   const x=testHarness(path,{actor:{role:'supplier'}});
   const result=await x.call();
   assert.equal(result.status,403);
   assert.equal(x.sends.length,0);
   assert.equal(x.servicesUpdated.length,0);
 }
});
