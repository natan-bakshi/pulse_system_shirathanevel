import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {assignmentWhatsAppContext,assignmentWhatsAppKey,cleanMissingAssignmentTime} from '../base44/shared/assignmentWhatsApp.ts';
import {entityTriggerWhatsAppContext} from '../base44/shared/entityTriggerWhatsApp.ts';
import {isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';
import {pendingApprovalReminderSupplierIds} from '../base44/shared/assignmentReminderTiming.ts';
import {toChatId} from '../base44/shared/whatsappSend.ts';

const src=fs.readFileSync('base44/functions/handleEntityEvents/entry.ts','utf8');
const compiled=esbuild.transformSync(src,{loader:'ts',format:'cjs',target:'es2022'}).code;
const supplier='supplier-save-1',eventId='event-save-1',serviceId='svc-save-1';
function fixture(){
 const event={id:eventId,event_name:'QA family',family_name:'QA',event_date:'2027-07-15',
   event_time:'10:00',location:'QA city',status:'confirmed'};
 const outbox=[],requests=[];
 const template={type:'SUPPLIER_NEW_ASSIGNMENT',name:'New assignment',is_active:true,
   trigger_type:'supplier_assignment_create',target_audiences:['supplier'],
   allowed_channels:['whatsapp'],whatsapp_body_template:'Assignment {{supplier_name}}'};
 const db={
   AppSettings:{filter:async()=>[]},
   PendingPushNotification:{filter:async()=>[],create:async()=>({id:'pending-only'})},
   NotificationTemplate:{filter:async q=>q.trigger_type==='supplier_assignment_create'?[template]:[]},
   Event:{get:async()=>event,filter:async()=>[event]},
   EventService:{filter:async()=>[]},
   Supplier:{get:async id=>({id,supplier_name:'Synthetic supplier',phone:'0501234567',
     preferred_channel:'phone',whatsapp_enabled:true})},
   Service:{get:async()=>({service_name:'QA service'})},
   User:{list:async()=>[]},
   InAppNotification:{filter:async()=>[]},
   WhatsAppOutbox:{filter:async()=>[]}
 };
 const client={auth:{me:async()=>({id:'qa-admin',role:'admin'})},
   asServiceRole:{entities:db}};
 let handler;
 vm.runInNewContext(compiled,{
   exports:{},module:{exports:{}},console:{log:()=>{},error:()=>{},warn:()=>{}},
   Deno:{serve:fn=>handler=fn},
   Response:{json:(body,{status=200}={})=>({body,status})},
   require:name=>{
     if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(name.endsWith('eventFields.js'))return {getClientContacts:()=>[],getEventContacts:()=>[]};
     if(name.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
     if(name.endsWith('notificationCore.ts'))return {createNotificationCore:()=>({})};
     if(name.endsWith('whatsappSend.ts'))return {toChatId,sendWhatsAppToChat:async(chat,text,c,ctx)=>{
       requests.push({chat,text,ctx});return {success:true,queued:true,status:'queued',jobId:'synthetic-'+requests.length};
     }};
     if(name.endsWith('assignmentWhatsApp.ts'))return {
       assignmentWhatsAppKey,assignmentWhatsAppContext,cleanMissingAssignmentTime
     };
     if(name.endsWith('assignmentReminderTiming.ts'))return {
       pendingApprovalReminderSupplierIds,shouldScheduleAssignmentReplyReminder:()=>false
     };
     if(name.endsWith('entityTriggerWhatsApp.ts'))return {entityTriggerWhatsAppContext};
     if(name.endsWith('whatsappReceipt.ts'))return {isWhatsAppEnqueueConfirmed};
     if(name.endsWith('quietHours.ts'))return {resolveNotificationDelay:()=>({shouldDelay:false})};
     throw Error('Unexpected dependency: '+name);
   }
 });
 async function update({before=[],after=[],beforeStatus={},afterStatus={},updated='2026-10-20T10:00:00.100000'}={}){
   const data={id:serviceId,event_id:eventId,service_id:'catalog-QA',supplier_ids:JSON.stringify(after),
     supplier_statuses:JSON.stringify(afterStatus),supplier_notes:'{}',
     updated_date:updated};
   const old={id:serviceId,event_id:eventId,supplier_ids:JSON.stringify(before),
     supplier_statuses:JSON.stringify(beforeStatus),supplier_notes:'{}',
     updated_date:'2026-10-20T09:59:00.000000'};
   const payload={event:{entity_name:'EventService',type:'update',entity_id:serviceId},data,old_data:old};
   return await handler({method:'POST',json:async()=>payload});
 }
 return {update,requests,outbox};
}
test('resaving unchanged supplier IDs/status does not enqueue a second assignment despite new updated_date',async()=>{
 const x=fixture();
 const oldId=[supplier],status={[supplier]:'pending'};
 const first=await x.update({before:[],after:oldId,afterStatus:status});
 assert.equal(first.status,200);
 assert.equal(x.requests.length,1);
 const repeated=await x.update({before:oldId,after:oldId,beforeStatus:status,afterStatus:status,
   updated:'2026-10-20T10:01:33.411000'});
 assert.equal(repeated.status,200);
 assert.equal(repeated.body.notifications_sent,0);
 assert.equal(x.requests.length,1,'A later unrelated save cannot generate a second new-assignment WhatsApp');
});
test('confirming an existing pending supplier never repeats the initial assignment request',async()=>{
 const x=fixture(),before=[supplier];
 const r=await x.update({before,after:before,beforeStatus:{[supplier]:'pending'},
   afterStatus:{[supplier]:'confirmed'}});
 assert.equal(r.status,200);
 assert.equal(x.requests.length,0);
});
test('a genuine confirmed-to-pending reassignment is eligible for ONE new approval request',async()=>{
 const x=fixture(),before=[supplier];
 const reopened=await x.update({before,after:before,beforeStatus:{[supplier]:'confirmed'},
   afterStatus:{[supplier]:'pending'}});
 assert.equal(reopened.status,200);
 assert.equal(reopened.body.notifications_sent,1);
 assert.equal(x.requests.length,1);
 const repeat=await x.update({before,after:before,beforeStatus:{[supplier]:'pending'},
   afterStatus:{[supplier]:'pending'},updated:'2026-10-20T10:01:33.411000'});
 assert.equal(repeat.body.notifications_sent,0);
 assert.equal(x.requests.length,1);
});
test('adding a different supplier sends only to that supplier',async()=>{
 const x=fixture(),another='supplier-save-2';
 const r=await x.update({before:[supplier],after:[supplier,another],
   beforeStatus:{[supplier]:'pending'},afterStatus:{[supplier]:'pending',[another]:'pending'}});
 assert.equal(r.status,200);
 assert.equal(x.requests.length,1);
 assert.equal(x.requests[0].ctx.supplierId,another);
});
