import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {eventReminderWhatsAppKey,automatedWhatsAppKey,taskDigestWhatsAppKey} from '../base44/shared/whatsappBusinessKeys.ts';
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';
import {indexEventServicesByEvent,indexEventReminderReceipts} from '../base44/shared/notificationLookup.ts';
import {expectTaskRecipient,acknowledgeTaskRecipient,taskIdsReadyToMark,readScheduledTaskOwners} from '../base44/shared/taskNotificationAck.ts';

const TEST_NOW='2026-10-19T12:00:00.000Z';
class TestDate extends Date {
 constructor(...args){super(...(args.length?args:[TEST_NOW]));}
 static now(){return Date.parse(TEST_NOW)}
}
const samples=[
 {id:'task-1',title:'Check details',due_date:'2026-10-19T09:00:00.000Z',is_completed:false,whatsapp_notification_sent:false}
];
function harness({channel=['whatsapp'],users=[
 {id:'admin-a',email:'a@example.test',full_name:'Admin A',phone:'0501111111',role:'admin'},
 {id:'admin-b',email:'b@example.test',full_name:'Admin B',phone:'0502222222',role:'admin'}
],failedPhone='',tasks=samples,pendingRows=[],outboxRows=[]}={}){
 const currentTasks=tasks.map(t=>({...t}));
 const seen=new Map(),enqueued=[],flagWrites=[],inApp=[],errors=[];let failOnce=true;
 const db={
  Event:{list:async()=>[]},
  EventService:{list:async()=>[]},
  Supplier:{list:async()=>[]},
  User:{list:async()=>users},
  NotificationTemplate:{filter:async()=>[{type:'TASK_DUE_REMINDER',is_active:true,allowed_channels:channel,
   title_template:'Task {{task_title}}',body_template:'Complete {{task_title}}',
   whatsapp_body_template:'WhatsApp {{task_title}}',deep_link_base:'Tasks'}]},
  InAppNotification:{
   filter:async()=>[],
   create:async data=>{const row={id:'inapp-'+(inApp.length+1),...data};inApp.push(row);return row;},
   update:async()=>({})
  },
  Payment:{list:async()=>[]},Service:{list:async()=>[]},AppSettings:{list:async()=>[]},
  PendingPushNotification:{filter:async(query)=>pendingRows.filter(row=>row.template_type===query.template_type&&query.related_task_id.$in.includes(row.related_task_id))},
  WhatsAppOutbox:{filter:async(query)=>outboxRows.filter(row=>query.idempotency_key.$in.includes(row.idempotency_key))},
  Task:{
   list:async()=>currentTasks,
   update:async()=>{throw Error('Unsafe Task.update called before enqueue');},
   updateMany:async(query,patch)=>{
    flagWrites.push({query,patch,enqueued:enqueued.length});
    const matches=currentTasks.filter(t=>t.id===query.id&&
      t.due_date===query.due_date&&t.is_completed===query.is_completed);
    for(const t of matches)Object.assign(t,patch.$set);
    return {updated:matches.length};
   }
  }
 };
 const client={auth:{me:async()=>({id:'system-owner',role:'admin'})},asServiceRole:{entities:db}};
 const src=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
 const code=esbuild.transformSync(src,{loader:'ts',format:'cjs',target:'es2022'}).code;
 let handler;
 const sandbox={
   module:{exports:{}},exports:{},Date:TestDate,console:{log:()=>{},warn:()=>{},error:(...a)=>errors.push(a.map(String).join(' '))},
   Response:{json:(body,{status=200}={})=>({status,body})},
   Deno:{serve:fn=>{handler=fn;},env:{get:()=>null}},
   require:path=>{
     if(path.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(path.endsWith('eventFields.js'))return {getClientContacts:()=>[]};
     if(path.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
     if(path.endsWith('whatsappSend.ts'))return {sendWhatsAppText:async(phone,message,_client,context)=>{
       assert.ok(context.idempotencyKey,'Every synthetic digest must be idempotent');
       if(phone===failedPhone && failOnce){failOnce=false;throw Error('Synthetic enqueue failure');}
       const prev=seen.get(context.idempotencyKey);
       if(prev)return {success:true,status:'accepted',queued:false,jobId:prev.id,deduplicated:true};
       const job={id:'job-'+(enqueued.length+1),phone,message,context};
       enqueued.push(job);seen.set(context.idempotencyKey,job);
       return {success:true,status:'queued',queued:true,jobId:job.id};
     }};
     if(path.endsWith('whatsappReceipt.ts'))return {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed};
     if(path.endsWith('whatsappBusinessKeys.ts'))return {eventReminderWhatsAppKey,automatedWhatsAppKey,taskDigestWhatsAppKey};
     if(path.endsWith('taskNotificationAck.ts'))return {expectTaskRecipient,acknowledgeTaskRecipient,taskIdsReadyToMark,readScheduledTaskOwners};
     if(path.endsWith('notificationLookup.ts'))return {indexEventServicesByEvent,indexEventReminderReceipts};
     throw Error('Unexpected imported module: '+path);
   }
 };
 vm.runInNewContext(code,sandbox,{filename:'dailyScheduledNotifications/entry.ts'});
 return {run:async()=>handler({method:'POST',json:async()=>({})}),currentTasks,flagWrites,enqueued,inApp,errors};
}
test('task digest key is deterministic irrespective of task order and includes due date revision',async()=>{
 const tasks=[
  {id:'task-a',due_date:'2026-10-19T10:00:00Z',title:'Old wording'},
  {id:'task-b',due_date:'2026-10-19T10:00:00Z'}
 ];
 const a=await taskDigestWhatsAppKey('admin-a',tasks);
 const b=await taskDigestWhatsAppKey('admin-a',[tasks[1],{...tasks[0],title:'New wording'}]);
 assert.equal(a,b);
 assert.ok(a.length<=240);
 assert.notEqual(a,await taskDigestWhatsAppKey('admin-b',tasks));
 assert.notEqual(a,await taskDigestWhatsAppKey('admin-a',[{...tasks[0],due_date:'2026-10-20T10:00:00Z'},tasks[1]]));
 const large=Array.from({length:500},(_,i)=>({id:'task-'+i,due_date:'2026-10-19T10:00:00Z'}));
 assert.ok((await taskDigestWhatsAppKey('admin-a',large)).length<=240);
});
test('task completion never succeeds with one of two recipient receipts absent',()=>{
 const required=new Map(),ack=new Map();
 for(const recipient of ['admin-a','admin-b'])expectTaskRecipient(required,'task-a',recipient);
 acknowledgeTaskRecipient(ack,'task-a','admin-a');
 assert.deepEqual(taskIdsReadyToMark(required,ack),[]);
 acknowledgeTaskRecipient(ack,'task-a','admin-b');
 assert.deepEqual(taskIdsReadyToMark(required,ack),['task-a']);
});
test('due task is not marked before all WhatsApp recipients have durable Outbox receipts',async()=>{
 const x=harness({failedPhone:'0502222222'});
 const first=await x.run();
 assert.equal(first.status,200);assert.equal(first.body.results.errors,1);
 assert.equal(x.enqueued.length,1);
 assert.equal(x.flagWrites.length,0,'One successful admin must NOT mark a task also assigned to a failed admin');
 assert.equal(x.currentTasks[0].whatsapp_notification_sent,false);
 const second=await x.run();
 assert.equal(second.status,200);assert.equal(x.enqueued.length,2,
  'Second attempt must deduplicate admin A while admitting admin B');
 assert.equal(x.flagWrites.length,1);
 assert.ok(x.flagWrites[0].enqueued>=2,'Task flag may change only after BOTH durable receipts exist');
 assert.equal(x.currentTasks[0].whatsapp_notification_sent,true);
 const third=await x.run();
 assert.equal(third.body.results.task_notifications_sent,0);
 assert.equal(x.enqueued.length,2,'No more sends after durable task completion');
});
test('when EVERY task digest enqueue fails the Task remains eligible for retry',async()=>{
 const x=harness({failedPhone:'0501111111',users:[
   {id:'admin-a',phone:'0501111111',role:'admin'}
 ]});
 await x.run();
 assert.equal(x.flagWrites.length,0);
 assert.equal(x.currentTasks[0].whatsapp_notification_sent,false);
 await x.run();
 assert.equal(x.enqueued.length,1);
 assert.equal(x.currentTasks[0].whatsapp_notification_sent,true);
});
test('push-only task still uses durable InApp evidence, never an in-memory WhatsApp array',async()=>{
 const x=harness({channel:['push'],users:[
   {id:'admin-a',email:'a@example.test',phone:'',role:'admin',full_name:'Admin A'}
 ]});
 const result=await x.run();
 assert.equal(result.status,200);
 assert.equal(x.inApp.length,1);
 assert.equal(x.enqueued.length,0);
 assert.equal(x.flagWrites.length,1);
 assert.equal(x.currentTasks[0].whatsapp_notification_sent,true);
});
test('task digest updater is structurally after all Outbox sends, not before',()=>{
 const src=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
 assert.ok(src.indexOf('Phase 7c: only now')>src.indexOf('// 5a. Enqueue every WhatsApp message'));
 assert.match(src,/taskIdsReadyToMark\(taskExpectedRecipients,taskAcknowledgedRecipients\)/);
 assert.doesNotMatch(src.slice(src.indexOf('// PHASE 6.5: Task Notifications'),src.indexOf('// PHASE 7: Batch Send')),
   /Task\.update\(|Task\.updateMany\(/);
});
