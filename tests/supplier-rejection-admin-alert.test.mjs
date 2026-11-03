import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {notifyManagersOfSupplierRejection} from '../base44/shared/supplierRejectionAlert.ts';

const EID='event-12345', ESID='service-12345', SID='supplier-12345';
const ADMINS=[
 {id:'admin-001',role:'admin',email:'one@example.com',phone:'0501234567',whatsapp_enabled:true},
 {id:'admin-002',role:'admin',email:'two@example.com',phone:'0508765432',whatsapp_enabled:true},
 {id:'admin-003',role:'admin',email:'three@example.com',phone:'0509999999',whatsapp_enabled:true}
];
function template(patch={}) {
 return {
  id:'template-12345',type:'ADMIN_ASSIGNMENT_REJECTED',
  is_active:true,target_audiences:['admin'],
  admin_recipient_ids:['admin-001','admin-002'],
  allowed_channels:['whatsapp'],
  title_template:'נדחה: {{event_name}}',
  body_template:'{{supplier_name}} דחה {{service_name}} באירוע {{event_name}} ({{event_date}})',
  whatsapp_body_template:'*דחייה* {{supplier_name}} / {{service_name}} / {{family_name}} / {{event_date}}',
  dynamic_url_type:'event_page',
  event_filter_condition:JSON.stringify([{field:'assignment_status',operator:'equals',value:'rejected'}]),
  ...patch
 };
}
function setup({tpl=template(),admins=ADMINS}={}) {
 const writes=[],messages=[];
 const service={id:ESID,event_id:EID,service_name:'נגינה'};
 const event={id:EID,event_name:'בר מצווה מיוחדת',family_name:'ישראל',event_date:'2026-11-04',location:'ירושלים'};
 const supplier={id:SID,supplier_name:'משה הספק'};
 const db={
  NotificationTemplate:{filter:async()=>tpl&&tpl.is_active?[tpl]:[]},
  Event:{get:async()=>event},EventService:{get:async()=>service},
  Supplier:{get:async()=>supplier},User:{filter:async()=>admins},
  Service:{get:async()=>null}
 };
 const client={asServiceRole:{entities:db}};
 const dependencies={
  decisionNonce:'fixed-test-nonce',
  now:new Date('2026-11-03T10:30:00Z'),
  createInApp:async(_client,payload)=>{
   writes.push(payload);
   return {ok:true,body:{notification_id:'inapp-'+payload.target_user_id}};
  },
  sendWhatsApp:async(chat,message,_client,ctx)=>{
   messages.push({chat,message,ctx});
   return {success:true,queued:true,status:'queued',jobId:'outbox-'+messages.length};
  }
 };
 return {client,dependencies,writes,messages,event,service,supplier};
}
const req={eventId:EID,eventServiceId:ESID,supplierId:SID};
test('supplier rejected alert honors existing WhatsApp-only template and exactly targeted admins',async()=>{
 const f=setup();
 const res=await notifyManagersOfSupplierRejection(f.client,req,f.dependencies);
 assert.equal(res.enabled,true);assert.equal(res.targeted,2);
 assert.equal(res.inAppCreated,2);assert.equal(res.whatsappQueued,2);
 assert.equal(res.failures,0);
 assert.deepEqual(f.writes.map(x=>x.target_user_id).sort(),['admin-001','admin-002']);
 assert.equal(f.writes[0].template_type,'ADMIN_ASSIGNMENT_REJECTED');
 assert.equal(f.writes[0].send_push,false,'Do not override WhatsApp-only admin setting');
 assert.equal(f.writes[0].link,'https://pulse-system.base44.app/EventDetails?id='+EID);
 assert.match(f.writes[0].message,/משה הספק דחה נגינה/);
 assert.equal(f.messages.length,2);
 assert.match(f.messages[0].message,/משה הספק \/ נגינה \/ ישראל/);
 assert.match(f.messages[0].message,/04\/11\/2026/);
 assert.equal(f.messages[0].ctx.eventServiceId,ESID);
 assert.equal(f.messages[0].ctx.supplierId,undefined,
  'Admin alerts must not append a supplier-only calendar link');
 assert.notEqual(f.messages[0].ctx.idempotencyKey,f.messages[1].ctx.idempotencyKey);
 assert.equal(f.messages[0].ctx.sourceType,'notification');
 assert.ok(f.messages.every(x=>x.ctx.idempotencyKey.startsWith('supplier-rejection-alert-v1:')));
});
test('shared WhatsApp number receives one message but both admins keep their in-app alerts',async()=>{
 const admins=ADMINS.map((u,i)=>i===1?{...u,phone:ADMINS[0].phone}:u);
 const f=setup({admins});
 const res=await notifyManagersOfSupplierRejection(f.client,req,f.dependencies);
 assert.equal(res.inAppCreated,2);
 assert.equal(res.whatsappQueued,1);
 assert.equal(f.messages.length,1);
});
test('disabled template, no admin audience, or disabled channels cannot enqueue',async()=>{
 for(const tpl of [null,template({target_audiences:['supplier']}),template({allowed_channels:[]})]){
  const f=setup({tpl});
  const res=await notifyManagersOfSupplierRejection(f.client,req,f.dependencies);
  assert.equal(res.enabled,false);
  assert.equal(f.writes.length,0);assert.equal(f.messages.length,0);
 }
});
test('template status condition gates delivery and push-only channel does not send WhatsApp',async()=>{
 const f=setup({tpl:template({
  event_filter_condition:JSON.stringify([{field:'assignment_status',operator:'equals',value:'confirmed'}])
 })});
 const rejected=await notifyManagersOfSupplierRejection(f.client,req,f.dependencies);
 assert.equal(rejected.enabled,false);assert.equal(f.writes.length,0);
 const g=setup({tpl:template({allowed_channels:['push']})});
 const push=await notifyManagersOfSupplierRejection(g.client,req,g.dependencies);
 assert.equal(push.targeted,2);assert.equal(push.inAppCreated,2);
 assert.ok(g.writes.every(x=>x.send_push===true));
 assert.equal(g.messages.length,0);
});
test('recipient opt-out or invalid phone skips WhatsApp only, preserving others',async()=>{
 const admins=ADMINS.map((u,i)=>i===0?{...u,whatsapp_enabled:false}:u);
 const f=setup({admins});
 const res=await notifyManagersOfSupplierRejection(f.client,req,f.dependencies);
 assert.equal(res.inAppCreated,2);assert.equal(res.whatsappQueued,1);
 assert.equal(f.messages.length,1);
});
test('failed WhatsApp enqueue cannot block other admin or duplicate by re-sending',async()=>{
 const f=setup();let calls=0;
 f.dependencies.sendWhatsApp=async()=>{
  calls++;
  if(calls===1)throw Error('Uncertain queue response');
  return {success:true,status:'queued',queued:true,jobId:'outbox-2'};
 };
 const res=await notifyManagersOfSupplierRejection(f.client,req,f.dependencies);
 assert.equal(calls,2);assert.equal(res.inAppCreated,2);
 assert.equal(res.whatsappQueued,1);assert.equal(res.failures,1);
});
test('quiet-hours preference is preserved in WhatsApp Outbox availability without extra jobs',async()=>{
 const f=setup();
 f.dependencies.now=new Date('2026-11-03T21:45:00Z');
 const result=await notifyManagersOfSupplierRejection(f.client,req,f.dependencies);
 assert.equal(result.whatsappQueued,2);
 assert.ok(f.messages.every(x=>Date.parse(x.ctx.availableAt)>f.dependencies.now.getTime()));
});
test('untrusted or mismatched event identity never sends a notification',async()=>{
 const f=setup();
 f.service.event_id='event-other';
 await assert.rejects(notifyManagersOfSupplierRejection(f.client,req,f.dependencies),/context unavailable/);
 assert.equal(f.writes.length,0);assert.equal(f.messages.length,0);
});
test('dashboard endpoint dispatches only committed supplier rejection, including confirmed->rejected',async()=>{
 const source=esbuild.transformSync(fs.readFileSync(
  'base44/functions/updateSupplierStatus/entry.ts','utf8'),
  {loader:'ts',format:'cjs',target:'es2022'}).code;
 let handler;
 let status='pending',writes=0,rejectionAlerts=0,alertThrows=false,calendarWakes=0;
 const args=[];
 const client={
  auth:{me:async()=>({id:'user-supplier',email:'supplier@example.com',phone:'0500000000'})},
  asServiceRole:{entities:{Supplier:{list:async()=>[{
    id:SID,contact_emails:['supplier@example.com'],phone:'0500000000'
  }]}}}
 };
 vm.runInNewContext(source,{
  module:{exports:{}},exports:{},console:{warn:()=>{},error:()=>{}},
  Deno:{serve:fn=>handler=fn},
  Response:{json:(body,{status=200}={})=>({body,status})},
  require:name=>{
   if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
   if(name.endsWith('eventReadiness.ts'))return {
    recalculateEventStatus:async()=>({newStatus:'confirmed'})
   };
   if(name.endsWith('calendarSyncStatusWake.ts'))return {
    wakeExistingCalendarSyncAfterSupplierDecision:async()=>{
      calendarWakes++;return {requested:true};
    }
   };
   if(name.endsWith('supplierStatusPersistence.ts'))return {
    persistAuthorizedSupplierStatus:async(_c,input)=>{
     writes++;args.push(input);
     if(status===input.newStatus)return {kind:'unchanged',eventId:EID,status};
     status=input.newStatus;return {kind:'changed',eventId:EID,status};
    }
   };
   if(name.endsWith('supplierRejectionAlert.ts'))return {
    notifyManagersOfSupplierRejection:async(_c,input)=>{
     assert.equal(input.supplierId,SID);
     rejectionAlerts++;
     if(alertThrows)throw Error('Alert queue unavailable');
     return {failures:0};
    }
   };
   throw Error('Unexpected import '+name);
  }
 });
 const call=async(newStatus,extra={})=>handler({
  method:'POST',json:async()=>({eventServiceId:ESID,newStatus,...extra})
 });
 const first=await call('rejected',{source:'admin',supplierId:'admin-forged'});
 assert.equal(first.status,200);assert.equal(rejectionAlerts,1);
 assert.equal(args[0].source,'dashboard');assert.equal(args[0].supplierId,SID);
 const duplicate=await call('rejected');
 assert.equal(duplicate.status,200);assert.equal(rejectionAlerts,1);
 await call('confirmed');assert.equal(rejectionAlerts,1);
 await call('rejected');assert.equal(rejectionAlerts,2);
 alertThrows=true;
 await call('pending');
 const committed=await call('rejected');
 assert.equal(committed.status,200,'A committed rejection must not become an HTTP failure');
 assert.equal(rejectionAlerts,3);
 assert.equal(status,'rejected');
 assert.equal(writes,6);
 assert.equal(calendarWakes,5,'Only real status changes request calendar sync');
});

test('legacy EventService workflow never mistakes historical supplier-decline flag for a new rejection',async()=>{
 const source=esbuild.transformSync(fs.readFileSync(
  'base44/functions/onAssignmentChange/entry.ts','utf8'),
  {loader:'ts',format:'cjs',target:'es2022'}).code;
 const previous={id:ESID,event_id:EID,service_id:'catalog-1234',
  supplier_ids:JSON.stringify([SID]),supplier_statuses:JSON.stringify({[SID]:'pending'}),
  declined_suppliers:JSON.stringify([{supplier_id:SID,declined_by_supplier:true}])};
 let calls=0,handler;
 const client={auth:{me:async()=>({role:'admin'})},asServiceRole:{entities:{
  Event:{filter:async()=>[{id:EID,event_name:'Test event',event_date:'2026-11-04'}]},
  Service:{list:async()=>[{id:'catalog-1234',service_name:'נגינה'}]},
  Supplier:{list:async()=>[{id:SID,supplier_name:'Supplier'}]},
  User:{list:async()=>[{id:'admin-001',role:'admin',email:'admin@example.com'}]},
  NotificationTemplate:{filter:async()=>[template()]}
 }}};
 vm.runInNewContext(source,{
  module:{exports:{}},exports:{},console:{log:()=>{},warn:()=>{},error:()=>{}},
  Deno:{serve:fn=>handler=fn},
  Response:{json:(body,{status=200}={})=>({body,status})},
  require:name=>{
   if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
   if(name.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
   if(name.endsWith('greenButtonQaFixture.ts'))return {
    isGreenButtonQaFixtureServicePayload:()=>false
   };
   if(name.endsWith('notificationCore.ts'))return {
    createNotificationCore:async()=>{calls++;return {ok:true};}
   };
   if(name.endsWith('eventChangeReconfirmation.ts'))return {
    isEventChangeStatusReset:()=>false
   };
   throw Error('Unexpected import '+name);
  }
 });
 const run=async(before,after)=>handler({json:async()=>({
  event:{type:'update',entity_id:ESID},data:after,old_data:before
 })});
 const adminAfter={...previous,supplier_statuses:JSON.stringify({[SID]:'rejected'})};
 const falseAlert=await run(previous,adminAfter);
 assert.equal(falseAlert.status,200);
 assert.equal(calls,0,'The previously stored supplier flag must not notify for admin rejection');
 const newRecord={...previous,declined_suppliers:'[]'};
 const supplierAfter={...adminAfter};
 const trueAlert=await run(newRecord,supplierAfter);
 assert.equal(trueAlert.status,200);
 assert.equal(calls,1,'A new supplier-originated rejection remains recognizable');
});
