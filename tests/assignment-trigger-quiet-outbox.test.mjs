import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {assignmentWhatsAppKey,assignmentWhatsAppContext,cleanMissingAssignmentTime} from '../base44/shared/assignmentWhatsApp.ts';
import {planAssignmentTransition} from '../base44/shared/assignmentIntent.ts';
import {entityTriggerWhatsAppContext} from '../base44/shared/entityTriggerWhatsApp.ts';
import {isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';

// Execute only the actual trigger's internal send path in isolation, without
// triggering a real Base44 workflow, inserting Pending rows, or contacting WhatsApp.
test('assignment trigger uses the same Outbox key while quiet, never a second Pending notification',async()=>{
 const src=fs.readFileSync('base44/functions/handleEntityEvents/entry.ts','utf8');
 const compiled=esbuild.transformSync(src,{loader:'ts',format:'cjs',target:'es2022'}).code;
 const module={exports:{}};
 const queued=[];
 let pendingCreated=0;
 const delay={shouldDelay:true,scheduledFor:new Date('2026-11-15T22:00:00.000Z')};
 const client={asServiceRole:{entities:{
   Service:{get:async()=>({service_name:'להקה'})},
   PendingPushNotification:{create:async()=>{pendingCreated++;throw Error('Assignment must not schedule a second PendingPushNotification');}}
 }}};
 vm.runInNewContext(compiled+'\nmodule.exports.__testTriggerWhatsApp=triggerWhatsApp;',{
   exports:module.exports,module,console:{log:()=>{},error:()=>{},warn:()=>{}},
   Deno:{serve:()=>{}},Response:{json:(x)=>x},
   require:path=>{
     if(path.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(path.endsWith('eventFields.js'))return {getClientContacts:()=>[],getEventContacts:()=>[]};
     if(path.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
     if(path.endsWith('notificationCore.ts'))return {createNotificationCore:()=>({})};
     if(path.endsWith('whatsappSend.ts'))return {
       sendWhatsAppToChat:async(chatId,message,_client,ctx)=>{
         queued.push({chatId,message,ctx});return {success:true,queued:true,status:'queued',jobId:'mock1'};
       }
     };
     if(path.endsWith('assignmentWhatsApp.ts'))return {
       assignmentWhatsAppKey,assignmentWhatsAppContext,cleanMissingAssignmentTime
     };
     if(path.endsWith('assignmentReminderTiming.ts'))return {shouldScheduleAssignmentReplyReminder:()=>true};
     if(path.endsWith('entityTriggerWhatsApp.ts'))return {entityTriggerWhatsAppContext};
     if(path.endsWith('whatsappReceipt.ts'))return {isWhatsAppEnqueueConfirmed};
     if(path.endsWith('quietHours.ts'))return {resolveNotificationDelay:()=>delay};
     throw Error('Unexpected dependency '+path);
   }
 });
 const event={id:'event123',event_name:'משפחת בדיקה',family_name:'בדיקה',
   event_date:'2026-11-16',event_time:'',location:'ירושלים'};
 const service={id:'service123',event_id:event.id,service_id:'catalog123',
   updated_date:'2026-10-15T08:00:00Z',supplier_arrival_time:'',supplier_notes:'{}'};
 const supplier={id:'supplier123',contact_person:'בדיקת ספק',supplier_name:'בדיקת ספק',
   phone:'0501234567',preferred_channel:'phone'};
 const template={type:'SUPPLIER_NEW_ASSIGNMENT',
   whatsapp_body_template:'שלום {{supplier_name}}, אירוע בתאריך {{event_date}} בשעה {{event_time}}.'};
 await module.exports.__testTriggerWhatsApp(client,template,supplier.phone,event,supplier,service,null,true);
 assert.equal(queued.length,1);
 assert.equal(pendingCreated,0);
 assert.equal(queued[0].ctx.sourceType,'assignment_new');
 assert.equal(queued[0].ctx.idempotencyKey,assignmentWhatsAppKey(service,supplier.id));
 assert.equal(queued[0].ctx.availableAt,delay.scheduledFor.toISOString());
 assert.doesNotMatch(queued[0].message,/בשעה\s*\./);
 // The CURRENT entity-trigger producer must use the identical, persisted
 // transition key when a future V2 EventService record is used.
 const transition=planAssignmentTransition({...service,supplier_ids:'[]',supplier_statuses:'{}'},
   {supplierIds:[supplier.id],supplierStatuses:{[supplier.id]:'pending'},supplierNotes:{}},
   '2026-10-15T08:01:00Z');
 Object.assign(service,transition.patch);
 service.updated_date='2026-10-15T08:03:00Z'; // unrelated edits must not change key.
 await module.exports.__testTriggerWhatsApp(client,template,supplier.phone,event,supplier,service,null,true);
 assert.equal(queued.length,2);
 assert.equal(queued[1].ctx.idempotencyKey,transition.intents[0].key);
 assert.equal(queued[1].ctx.idempotencyKey,assignmentWhatsAppKey(service,supplier.id));
 assert.equal(queued[1].ctx.availableAt,delay.scheduledFor.toISOString());
});
