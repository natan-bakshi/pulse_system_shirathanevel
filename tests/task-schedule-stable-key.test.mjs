import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {taskDigestWhatsAppKey} from '../base44/shared/whatsappBusinessKeys.ts';

function harness(){
 const task={id:'task-future-1',title:'Confirm supplier',due_date:'2029-01-15T09:00:00.000Z',
  is_completed:false,assignee_ids:['admin-a']};
 const pending=[],allKeys=[],providerCalls=[];
 const db={
  Task:{get:async()=>task},
  PendingPushNotification:{
   filter:async q=>pending.filter(p=>p.related_task_id===q.related_task_id&&p.is_sent===q.is_sent),
   create:async data=>{
     const row={id:'pending-'+(allKeys.length+1),...data};
     pending.push(row);allKeys.push(JSON.parse(row.data).idempotency_key);
     return row;
   },
   delete:async id=>{const i=pending.findIndex(p=>p.id===id);if(i>=0)pending.splice(i,1)}
  },
  NotificationTemplate:{filter:async()=>[{
   type:'TASK_DUE_REMINDER',is_active:true,allowed_channels:['whatsapp'],
   title_template:'Due {{task_title}}',body_template:'Task reminder: {{task_title}}',
   whatsapp_body_template:'WhatsApp {{task_title}}'
  }]},
  User:{list:async()=>[{id:'admin-a',phone:'0501234567',email:'a@example.test',role:'admin',full_name:'A'}]},
  AppSettings:{list:async()=>[]}
 };
 const client={asServiceRole:{entities:db,functions:{invoke:async()=>providerCalls.push('unexpected')}}};
 const js=esbuild.transformSync(fs.readFileSync('base44/functions/scheduleTaskReminder/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
 }).code;
 let handler=null;
 vm.runInNewContext(js,{
   module:{exports:{}},exports:{},
   Deno:{serve:fn=>handler=fn},
   Response:{json:(body,{status=200}={})=>({body,status})},
   console:{error:()=>{},warn:()=>{}},
   require:name=>{
     if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(name.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
     if(name.endsWith('whatsappBusinessKeys.ts'))return {taskDigestWhatsAppKey};
     throw Error('Unexpected import '+name);
   }
 });
 return {run:async()=>handler({method:'POST',json:async()=>({taskId:task.id})}),task,pending,allKeys,providerCalls};
}
test('Task updates recreate Pending rows with the SAME durable WhatsApp key',async()=>{
 const x=harness();
 const a=await x.run();
 assert.equal(a.status,200);assert.equal(a.body.scheduled,1);
 const originalKey=x.allKeys[0];
 assert.equal(x.pending.length,1);
 assert.equal(JSON.parse(x.pending[0].data).task_due_date,x.task.due_date);
 x.task.title='Updated non-delivery field'; // task update triggers scheduleTaskReminder
 const b=await x.run();
 assert.equal(b.status,200);assert.equal(b.body.scheduled,1);
 assert.equal(x.pending.length,1,'Old unsent Pending is cleaned and rescheduled');
 assert.deepEqual(x.allKeys,[originalKey,originalKey],
  'New transient Pending ID must not create a new Outbox message');
 assert.equal(x.providerCalls.length,0,'This workflow schedules only, never sends provider HTTP');
});
test('due date revision changes the WhatsApp key and never replays the previous due version',async()=>{
 const x=harness();
 await x.run();const old=x.allKeys[0];
 x.task.due_date='2029-01-16T09:00:00.000Z';
 await x.run();
 assert.notEqual(x.allKeys[1],old);
 assert.equal(x.pending.length,1);
});
