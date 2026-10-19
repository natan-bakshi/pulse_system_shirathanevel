import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {entityTriggerWhatsAppContext} from '../base44/shared/entityTriggerWhatsApp.ts';
import {assignmentWhatsAppKey,assignmentWhatsAppContext,cleanMissingAssignmentTime} from '../base44/shared/assignmentWhatsApp.ts';
import {isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';

const base={
 entityName:'EventService',origin:{id:'es-120',updated_date:'2026-10-19T05:26:02.583051'},
 recipientChatId:'972501234567@c.us',template:{id:'template-1',type:'ADMIN_ASSIGNMENT_REJECTED'},
 specificSupplierId:'supplier-1',eventServiceId:'es-120',eventId:'event-1',sourceType:'notification'
};
test('one entity update, 3/6-digit timestamp, identical business key and recipient',async()=>{
 const a=await entityTriggerWhatsAppContext(base,new Date('2026-10-19T12:00:00Z'));
 const b=await entityTriggerWhatsAppContext({...base,origin:{...base.origin,updated_date:'2026-10-19T05:26:02.583000'}},new Date('2026-10-19T12:30:00Z'));
 assert.equal(a.idempotencyKey,b.idempotencyKey);
 assert.ok(a.idempotencyKey.startsWith('entity-notification-v1:'));
 assert.equal(a.availableAt,undefined);
 assert.equal(a.sourceType,'notification');
 assert.equal(a.sourceId,'es-120');
 assert.equal(a.eventServiceId,'es-120');
 assert.equal(a.supplierId,'supplier-1');
});
test('different business revisions, templates, targets and status-change suppliers never collapse together',async()=>{
 const original=await entityTriggerWhatsAppContext(base,new Date('2026-10-19T12:00:00Z'));
 const variations=[
   {...base,origin:{...base.origin,updated_date:'2026-10-19T05:26:02.584000'}},
   {...base,template:{...base.template,id:'template-2'}},
   {...base,recipientChatId:'972509999999@c.us'},
   {...base,specificSupplierId:'supplier-2'},
   {...base,entityName:'Event'},
   {...base,origin:{...base.origin,id:'es-121'}}
 ];
 for(const change of variations){
  const key=(await entityTriggerWhatsAppContext(change,new Date('2026-10-19T12:00:00Z'))).idempotencyKey;
  assert.notEqual(key,original.idempotencyKey);
 }
});
test('missing business revision uses NO de-duplication key (avoid dropping a subsequent real alert)',async()=>{
 const noDate={...base,origin:{id:'es-120'}};
 const value=await entityTriggerWhatsAppContext(noDate,new Date('2026-10-19T12:00:00Z'));
 assert.equal(value.idempotencyKey,'');
});
test('late-night winter reminder goes into the SAME outbox with Jerusalem 08:00 availability',async()=>{
 const night=new Date('2026-12-12T21:30:00Z'); // Saturday 23:30 Israel winter
 const ctx=await entityTriggerWhatsAppContext(base,night);
 assert.equal(ctx.availableAt,'2026-12-13T06:00:00.000Z');
 const morning=await entityTriggerWhatsAppContext(base,new Date('2026-12-13T07:00:00Z'));
 assert.equal(morning.availableAt,undefined);
 assert.equal(ctx.idempotencyKey,morning.idempotencyKey);
});
test('late-night summer reminder uses real DST, never the old month-based offset approximation',async()=>{
 const ctx=await entityTriggerWhatsAppContext(base,new Date('2026-10-19T20:30:00Z'));
 assert.equal(ctx.availableAt,'2026-10-20T05:00:00.000Z');
 const atWork=await entityTriggerWhatsAppContext(base,new Date('2026-10-19T07:00:00Z'));
 assert.equal(atWork.availableAt,undefined);
 assert.equal(ctx.idempotencyKey,atWork.idempotencyKey);
});
function loadTrigger({now='2026-10-19T20:30:00Z',reply,statusCode='',sendError=null}={}){
 const src=fs.readFileSync('base44/functions/handleEntityEvents/entry.ts','utf8');
 const compiled=esbuild.transformSync(src,{loader:'ts',format:'cjs',target:'es2022'}).code;
 const module={exports:{}};const sent=[];let pending=0;
 const client={asServiceRole:{entities:{
   PendingPushNotification:{create:async()=>{pending++;throw Error('Unexpected separate Pending row')}},
   Service:{get:async()=>({service_name:'Band'})}
 }}};
 const answer=reply===undefined?{success:true,queued:true,status:'queued',jobId:'job-1'}:reply;
 vm.runInNewContext(compiled+'\nmodule.exports.triggerWhatsAppForTest=triggerWhatsApp;',{
   module,exports:module.exports,console:{log:()=>{},warn:()=>{},error:()=>{}},
   Deno:{serve:()=>{}},Response:{json:v=>v},
   require:path=>{
     if(path.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(path.endsWith('eventFields.js'))return {getClientContacts:()=>[],getEventContacts:()=>[]};
     if(path.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
     if(path.endsWith('notificationCore.ts'))return {createNotificationCore:()=>({})};
     if(path.endsWith('whatsappSend.ts'))return {sendWhatsAppToChat:async(chat,text,_client,ctx)=>{
       sent.push({chat,text,ctx});
       if(sendError)throw sendError;
       return answer;
     }};
     if(path.endsWith('assignmentWhatsApp.ts'))return {assignmentWhatsAppKey,assignmentWhatsAppContext,cleanMissingAssignmentTime};
     if(path.endsWith('assignmentReminderTiming.ts'))return {shouldScheduleAssignmentReplyReminder:()=>false};
     if(path.endsWith('quietHours.ts'))return {resolveNotificationDelay:()=>({shouldDelay:false,scheduledFor:null})};
     if(path.endsWith('entityTriggerWhatsApp.ts'))return {entityTriggerWhatsAppContext:arg=>entityTriggerWhatsAppContext(arg,new Date(now))};
     if(path.endsWith('whatsappReceipt.ts'))return {isWhatsAppEnqueueConfirmed};
     throw Error('Unexpected import '+path);
   }
 });
 const ev={id:'event-1',event_name:'QA Event',event_date:'2026-11-15',event_time:'12:00'};
 const service={id:'es-120',event_id:'event-1',service_id:'cat-1',updated_date:base.origin.updated_date};
 const admin={id:'admin-1',full_name:'Example Admin',phone:'0501234567'};
 const template={id:'template-1',type:'ADMIN_ASSIGNMENT_REJECTED',category:'notification',whatsapp_body_template:'Notice {{event_name}} for {{supplier_name}}'};
 return {invoke:origin=>module.exports.triggerWhatsAppForTest(
   client,template,admin.phone,ev,null,service,admin,false,null,
   origin||{entityName:'EventService',origin:base.origin,specificSupplierId:'supplier-1'}
 ),sent,get pending(){return pending;}};
}
test('runtime: quiet hours create ONE Outbox intent; no PendingPushNotification or provider direct send',async()=>{
 const fx=loadTrigger();
 await fx.invoke();
 assert.equal(fx.pending,0);
 assert.equal(fx.sent.length,1);
 assert.equal(fx.sent[0].ctx.availableAt,'2026-10-20T05:00:00.000Z');
 assert.ok(fx.sent[0].ctx.idempotencyKey.startsWith('entity-notification-v1:'));
 assert.equal(fx.sent[0].ctx.sourceId,'es-120');
});
test('runtime: daytime trigger has same key, starts immediately, not a second scheduler',async()=>{
 const quiet=loadTrigger({now:'2026-10-19T20:30:00Z'});
 const day=loadTrigger({now:'2026-10-19T09:00:00Z'});
 await quiet.invoke();await day.invoke();
 assert.equal(day.sent[0].ctx.availableAt,undefined);
 assert.equal(day.sent[0].ctx.idempotencyKey,quiet.sent[0].ctx.idempotencyKey);
});
test('runtime: queue insert failure propagates; cannot be swallowed as a scheduled success',async()=>{
 const fx=loadTrigger({sendError:new Error('Simulated enqueue storage failure')});
 await assert.rejects(fx.invoke(),/Simulated enqueue storage failure/);
 assert.equal(fx.pending,0);
 assert.equal(fx.sent.length,1);
});
test('runtime: terminal UNKNOWN cannot pass merely because a stale response contains queued=true',async()=>{
 const fx=loadTrigger({reply:{success:true,status:'unknown',queued:true,jobId:'old-job'}});
 await assert.rejects(fx.invoke(),/not confirmed: unknown/);
 assert.equal(fx.pending,0);
});
test('runtime: assignment trigger still has its existing dedicated identity and never falls back to nonassignment key',async()=>{
 const fx=loadTrigger();
 const src=fs.readFileSync('base44/functions/handleEntityEvents/entry.ts','utf8');
 assert.match(src,/template\.type==='SUPPLIER_NEW_ASSIGNMENT'[\s\S]*assignmentWhatsAppContext/);
 assert.match(src,/!isWhatsAppEnqueueConfirmed\(receipt\)/);
});
