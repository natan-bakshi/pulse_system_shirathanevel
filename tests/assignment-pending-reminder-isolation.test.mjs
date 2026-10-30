import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {pendingApprovalReminderSupplierIds} from '../base44/shared/assignmentReminderTiming.ts';
import {assignmentWhatsAppContext,assignmentWhatsAppKey,cleanMissingAssignmentTime} from '../base44/shared/assignmentWhatsApp.ts';
import {entityTriggerWhatsAppContext} from '../base44/shared/entityTriggerWhatsApp.ts';
import {isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';
import {toChatId} from '../base44/shared/whatsappSend.ts';
import {isGreenButtonQaFixtureEventPayload,isGreenButtonQaFixtureServicePayload} from '../base44/shared/greenButtonQaFixture.ts';

test('one optional reminder failure does not block assignment notices; repeated data is loaded once',async()=>{
 const src=fs.readFileSync('base44/functions/handleEntityEvents/entry.ts','utf8');
 const compiled=esbuild.transformSync(src,{loader:'ts',format:'cjs',target:'es2022'}).code;
 const ids=['supplier-aaa','supplier-bbb','supplier-ccc'];
 const statuses=Object.fromEntries(ids.map(id=>[id,'pending']));
 const counters={pendingChecks:0,pendingWrites:0,eventGets:0,serviceGets:0,usersLists:0,reminderTemplates:0,waNotices:0};
 const event={id:'event-aaa',event_name:'Family test',family_name:'Test',event_date:'2028-01-15',
   event_time:'10:00',location:'Jerusalem',status:'confirmed'};
 const eventService={id:'service-aaa',event_id:event.id,service_id:'catalog-aaa',supplier_ids:JSON.stringify(ids),
   supplier_statuses:JSON.stringify(statuses),supplier_notes:'{}',updated_date:'2026-10-15T08:00:00Z'};
 const pendingTemplate={type:'SUPPLIER_PENDING_REMINDER',allowed_channels:['push','whatsapp'],
   title_template:'Reply to assignment',body_template:'Please confirm',whatsapp_body_template:'Reply {{supplier_name}}',
   timing_value:24,timing_unit:'hours'};
 const assignmentTemplate={type:'SUPPLIER_NEW_ASSIGNMENT',name:'New supplier assignment',
   trigger_type:'supplier_assignment_create',target_audiences:['supplier'],
   allowed_channels:['whatsapp'],whatsapp_body_template:'Hello {{supplier_name}}'};
 const db={
   PendingPushNotification:{
     filter:async(q)=>{
       counters.pendingChecks++;
       if(q.related_supplier_id===ids[0])throw Error('Synthetic reminder-only backend fault');
       return [];
     },
     create:async()=>{counters.pendingWrites++;return {id:'pending-created'};}
   },
   NotificationTemplate:{
     filter:async(q)=>{
       if(q.type==='SUPPLIER_PENDING_REMINDER'){counters.reminderTemplates++;return [pendingTemplate]}
       return q.trigger_type==='supplier_assignment_create'?[assignmentTemplate]:[];
     }
   },
   Event:{
     get:async()=>{counters.eventGets++;return event},
     filter:async()=>[event]
   },
   Supplier:{get:async(id)=>({id,supplier_name:id,contact_person:id,phone:'0501234567',whatsapp_enabled:true})},
   Service:{get:async()=>{counters.serviceGets++;return {service_name:'Test music'}}},
   User:{list:async()=>{counters.usersLists++;return []}},
   EventService:{filter:async()=>[eventService]},
   InAppNotification:{filter:async()=>[]},
   WhatsAppOutbox:{filter:async()=>[]}
 };
 const client={auth:{me:async()=>({role:'admin',id:'owner-test'})},asServiceRole:{entities:db}};
 let handler;const module={exports:{}};
 vm.runInNewContext(compiled,{
   exports:module.exports,module,console:{log:()=>{},warn:()=>{},error:()=>{}},
   Deno:{serve:fn=>handler=fn,env:{get:()=>''}},Response:{json:(data,options={})=>({body:data,status:options.status||200})},
   require:path=>{
     if(path.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(path.endsWith('eventFields.js'))return {getClientContacts:()=>[],getEventContacts:()=>[]};
     if(path.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
     if(path.endsWith('notificationCore.ts'))return {createNotificationCore:()=>({})};
     if(path.endsWith('whatsappOutbox.ts'))return {readWhatsAppQueueControl:async()=>({enabled:true,interactive_assignment_production_enabled:false})};
     if(path.endsWith('whatsappProviderConfig.ts'))return {resolveWhatsAppProvider:async()=> 'green'};
     if(path.endsWith('supplierPortalLink.ts'))return {
       productionAssignmentPrivateTarget:(_supplier,chat)=>({chatId:chat,reason:'normal_supplier_preference'})
     };
     if(path.endsWith('whatsappSend.ts'))return {
       toChatId,
       sendWhatsAppToChat:async()=>{counters.waNotices++;return {success:true,queued:true,status:'queued',jobId:'test-job'}}
     };
     if(path.endsWith('assignmentWhatsApp.ts'))return {
       assignmentWhatsAppKey,assignmentWhatsAppContext,cleanMissingAssignmentTime
     };
     if(path.endsWith('assignmentReminderTiming.ts'))return {
       shouldScheduleAssignmentReplyReminder:()=>true,pendingApprovalReminderSupplierIds
     };
     if(path.endsWith('entityTriggerWhatsApp.ts'))return {entityTriggerWhatsAppContext};
     if(path.endsWith('whatsappReceipt.ts'))return {isWhatsAppEnqueueConfirmed};
     if(path.endsWith('quietHours.ts'))return {resolveNotificationDelay:()=>({shouldDelay:false})};
     if(path.endsWith('greenButtonQaFixture.ts'))return {isGreenButtonQaFixtureEventPayload,isGreenButtonQaFixtureServicePayload};
     throw Error('Unexpected import '+path);
   }
 });
 const body={
   event:{entity_name:'EventService',type:'update',entity_id:eventService.id},
   data:eventService,old_data:{supplier_ids:'[]',supplier_statuses:'{}'}
 };
 const res=await handler({method:'POST',json:async()=>body});
 assert.equal(res.status,200);
 assert.equal(res.body.reminder_schedule_errors,1);
 assert.equal(res.body.notifications_sent,3,'Every immediate WhatsApp assignment should still be queued');
 assert.equal(counters.waNotices,3);
 assert.equal(counters.pendingChecks,3,'One reminder check per distinct pending supplier');
 assert.equal(counters.pendingWrites,2,'The two healthy suppliers retain reminders');
 assert.equal(counters.reminderTemplates,1,'Template lookups shared across suppliers');
 assert.equal(counters.eventGets,1,'Event record shared across the batch');
 assert.equal(counters.serviceGets,1,'Service record shared across the batch');
 assert.equal(counters.usersLists,1,'Push enabled template loads users only once per batch');
});
