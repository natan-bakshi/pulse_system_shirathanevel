import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';

test('event-reminder fan-out does not mark scheduled source as sent after partial WhatsApp enqueue failure',async()=>{
 const text=fs.readFileSync('base44/functions/processScheduledPushNotifications/entry.ts','utf8');
 const js=esbuild.transformSync(text,{loader:'ts',format:'cjs',target:'es2022'}).code;
 const pending={id:'pending-fanout-1',condition_type:'event_reminder_fanout',
   related_event_id:'event-a',template_type:'EVENT_REMINDER_FANOUT',
   scheduled_for:'2025-01-01T00:00:00.000Z',is_sent:false,created_date:'2024-12-01T00:00:00.000Z',data:'{}'};
 const receipts=new Map();let failOnce=true;let scheduleFinalizations=0;
 const db={
   User:{list:async()=>[]},
   Event:{get:async()=>({id:'event-a',event_name:'Test Event',event_date:'2028-01-15',event_time:'10:00',status:'confirmed',location:'City'})},
   EventService:{filter:async()=>[{id:'svc',event_id:'event-a',supplier_ids:'["a","b"]',
      supplier_statuses:'{"a":"confirmed","b":"confirmed"}'}]},
   Supplier:{list:async()=>[
     {id:'a',supplier_name:'A',contact_person:'A',phone:'0501234567',whatsapp_enabled:true},
     {id:'b',supplier_name:'B',contact_person:'B',phone:'0507654321',whatsapp_enabled:true}
   ]},
   NotificationTemplate:{filter:async()=>[{type:'SUPPLIER_EVENT_REMINDER',is_active:true,
     allowed_channels:['whatsapp'],whatsapp_body_template:'Reminder {{supplier_name}}',
     title_template:'Reminder',body_template:'Reminder'}]},
   PendingPushNotification:{
     filter:async()=>pending.is_sent?[]:[{...pending}],
     update:async(id,patch)=>{assert.equal(id,pending.id);Object.assign(pending,patch);if(patch.is_sent===true)scheduleFinalizations++;return pending;},
     deleteMany:async()=>({deleted:0})
   }
 };
 const client={auth:{me:async()=>({role:'admin'})},asServiceRole:{entities:db}};
 const module={exports:{}};let handler;
 vm.runInNewContext(js,{
   module,exports:module.exports,Deno:{env:{get:()=>null},serve:fn=>{handler=fn}},
   Response:{json:(data)=>({body:data})},console:{log:()=>{},warn:()=>{},error:()=>{}},
   require:path=>{
     if(path.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(path.endsWith('whatsappReceipt.ts'))return {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed};
     if(path.endsWith('whatsappSend.ts'))return {
       sendWhatsAppToChat:async(chatId,message,_client,ctx)=>{
         const key=ctx.idempotencyKey;
         if(receipts.has(key))return {success:true,queued:false,status:'accepted'};
         if(chatId.includes('7654321')&&failOnce){failOnce=false;throw Error('Queue reject before send');}
         receipts.set(key,{chatId,message});return {success:true,queued:true,jobId:key};
       },
       sendWhatsAppText:async()=>{throw Error('unexpected text send route')},
       toChatId:phone=>'972'+String(phone).slice(1)+'@c.us'
     };
     if(path.endsWith('quietHours.ts'))return {
       isShabbat:()=>false,getShabbatEndTime:()=>new Date(),
       resolveNotificationDelay:()=>({shouldDelay:false})
     };
     if(path.endsWith('eventReadiness.ts'))return {loadEventReadiness:async()=>({})};
     if(path.endsWith('missingAssignmentAlert.ts'))return {isMissingAssignmentAlertDue:()=>false,renderMissingAssignmentAlert:()=>({})};
     if(path.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
     throw Error('Unexpected module '+path);
   }
 });
 const first=await handler({method:'POST'});
 assert.equal(pending.is_sent,false,'Source must remain due when one WhatsApp enqueue fails');
 assert.equal(scheduleFinalizations,0);
 assert.equal(receipts.size,1);
 assert.equal(first.body.errors,1);
 const second=await handler({method:'POST'});
 assert.equal(pending.is_sent,true,'After retry fills the missing recipient, source may close');
 assert.equal(scheduleFinalizations,1);
 assert.equal(receipts.size,2,'No duplicate WhatsApp for the first recipient');
 assert.equal(second.body.errors,0);
});

test('daily worker does not mark due PendingPushNotification sent before durable WhatsApp enqueue',()=>{
 const code=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
 const start=code.indexOf('// PHASE 1: Delayed notifications have ONE owner');
 const end=code.indexOf('// PHASE 2: Process scheduled_check Templates');
 assert.ok(start>0&&end>start);
 assert.doesNotMatch(code.slice(start,end),/PendingPushNotification\.update|daily-pending:/);
 assert.match(code,/processScheduledPushNotifications worker alone claims/);
});
