import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {eventReminderWhatsAppKey} from '../base44/shared/whatsappBusinessKeys.ts';
import {sendWhatsAppText} from '../base44/shared/whatsappSend.ts';

const event={id:'event-aaa123',event_name:'Family Example',event_date:'2026-11-17',event_time:'10:00'};
const supplierTemplate={type:'SUPPLIER_EVENT_REMINDER',timing_value:1,timing_unit:'days'};
const adminTemplate={type:'ADMIN_EVENT_REMINDER',timing_value:1,timing_unit:'days'};

test('same event reminder producer and recipient always produce same key across runs and unrelated edits',()=>{
 const a=eventReminderWhatsAppKey(event,supplierTemplate,'supplier','supplier-aaa123');
 const b=eventReminderWhatsAppKey({...event,event_name:'New family spelling',notes:'unrelated edit'},
   {...supplierTemplate,body_template:'Different formatting'},'supplier','supplier-aaa123');
 assert.equal(a,b);
 assert.match(a,/SUPPLIER_EVENT_REMINDER/);
 assert.ok(a.length<=240);
});
test('new event date/time, timing configuration and recipient produce a different reminder key',()=>{
 const base=eventReminderWhatsAppKey(event,supplierTemplate,'supplier','supplier-aaa123');
 const variants=[
   [{...event,event_date:'2026-11-18'},supplierTemplate,'supplier','supplier-aaa123'],
   [{...event,event_time:'13:00'},supplierTemplate,'supplier','supplier-aaa123'],
   [event,{...supplierTemplate,timing_value:2},'supplier','supplier-aaa123'],
   [event,supplierTemplate,'supplier','supplier-bbb456'],
   [event,adminTemplate,'admin','admin-ccc789']
 ];
 for(const args of variants)assert.notEqual(eventReminderWhatsAppKey(...args),base);
});
test('same event reminder generated twice creates ONE durable Outbox job',async()=>{
 const control={id:'control-1',control_key:'global',enabled:true,enqueue_owner:'',enqueue_until:''};
 const jobs=[];let counter=0;
 const ents={
   WhatsAppQueueControl:{
     filter:async()=>[control],
     updateMany:async(q,ops)=>{
       if(q.enqueue_owner!==control.enqueue_owner)return {updated:0};
       Object.assign(control,ops.$set);return {updated:1};
     }
   },
   WhatsAppOutbox:{
     filter:async q=>jobs.filter(j=>j.idempotency_key===q.idempotency_key),
     create:async data=>{const job={...data,id:'job-'+(++counter)};jobs.push(job);return job;}
   },
   AppSettings:{filter:async()=>[{setting_value:'green'}]}
 };
 const client={asServiceRole:{entities:ents}};
 const oldDeno=globalThis.Deno;
 globalThis.Deno={env:{get:()=>''}};
 const key=eventReminderWhatsAppKey(event,supplierTemplate,'supplier','supplier-aaa123');
 try{
   const a=await sendWhatsAppText('0501234567','REMINDER 1',client,{
     sourceType:'event_reminder',sourceId:event.id,idempotencyKey:key
   });
   const b=await sendWhatsAppText('0501234567','REMINDER 1',client,{
     sourceType:'event_reminder',sourceId:event.id,idempotencyKey:key
   });
   assert.equal(jobs.length,1);
   assert.equal(b.jobId,a.jobId);
   assert.equal(b.deduplicated,true);
 }finally{if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
});
test('two scheduler implementations and delayed pending worker share business key',()=>{
 const daily=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
 const legacy=fs.readFileSync('base44/functions/sendEventReminders/entry.ts','utf8');
 const pending=fs.readFileSync('base44/functions/processScheduledPushNotifications/entry.ts','utf8');
 assert.match(daily,/idempotencyKey:eventReminderWhatsAppKey\(event,supplierReminderTemplate,'supplier',supplierId\)/);
 assert.match(daily,/idempotencyKey:eventReminderWhatsAppKey\(event,adminReminderTemplate,'admin',admin\.id\)/);
 assert.match(legacy,/eventReminderWhatsAppKey\(event,supplierTemplate,'supplier',supplierId\)/);
 assert.match(legacy,/eventReminderWhatsAppKey\(event,adminTemplate,'admin',admin\.id\)/);
 assert.match(legacy,/idempotency_key:reminderKey/);
 assert.match(pending,/idempotencyKey:pendingData\.idempotency_key\|\|'scheduled-wa:'\+pending\.id/);
});
test('unexpected reminder types cannot silently collide with a valid key',()=>{
 assert.throws(()=>eventReminderWhatsAppKey(event,{type:'REMINDER'},'supplier','supplier-aaa123'),/Unsupported/);
 assert.throws(()=>eventReminderWhatsAppKey(event,supplierTemplate,'supplier',''),/Incomplete/);
});
