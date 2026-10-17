import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {automatedWhatsAppKey} from '../base44/shared/whatsappBusinessKeys.ts';
import {whatsappEnqueueReceiptState} from '../base44/shared/whatsappReceipt.ts';

const event={id:'event-example',event_date:'2026-11-20',event_name:'Test Event',family_name:'Example'};
const supplier={id:'supplier-a',phone:'0501234567',whatsapp_enabled:true,supplier_name:'Supplier'};
const eventService={id:'es-example'};
const template={id:'template-1',type:'GENERIC_CHECK',allowed_channels:['whatsapp'],
 title_template:'Reminder',body_template:'Please check',whatsapp_body_template:'WhatsApp {{supplier_name}}'};
const user={id:'supplier-user',email:'supplier@example.test',role:'supplier',phone:'0501234567'};
function runner({quiet=false,transportReceipt=null}={}){
 const source=fs.readFileSync('base44/functions/checkAutomatedTriggers/entry.ts','utf8');
 const start=source.indexOf('async function triggerNotification(');
 const end=source.indexOf('// --- Quiet Hours Helpers ---',start);
 assert.ok(start>=0&&end>start);
 const outbox=new Map(),sentCalls=[],pending=[],inApps=[];
 const client={asServiceRole:{entities:{
  PendingPushNotification:{
   create:async data=>{const row={id:'pending-'+(pending.length+1),...data};pending.push(row);return row;},
   update:async(id,patch)=>Object.assign(pending.find(p=>p.id===id),patch)
  },
  InAppNotification:{create:async data=>{
    const row={id:'inapp-'+(inApps.length+1),...data};inApps.push(row);return row;
  }}
 }}};
 const sandbox={
  console:{log:()=>{},error:()=>{}},
  isInQuietHours:()=>quiet,getQuietHoursEndTime:()=>new Date('2026-11-20T06:00:00Z'),
  automatedWhatsAppKey,whatsappEnqueueReceiptState,
  attachOutboxInAppReceipt:async()=>{},
  sendWhatsAppText:async(phone,text,_client,opts)=>{
   sentCalls.push({phone,text,opts});
   if(transportReceipt)return transportReceipt;
   if(!outbox.has(opts.idempotencyKey))outbox.set(opts.idempotencyKey,{phone,text,opts});
   return {success:true,status:'queued',queued:true,jobId:'job-1'};
  }
 };
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.invokeTrigger=triggerNotification;',sandbox);
 return {
  invoke:async()=>sandbox.invokeTrigger(client,template,event,user,supplier,eventService,{notifications_created:0}),
  client,outbox,sentCalls,pending,inApps
 };
}
test('legacy scheduled_check producer uses the SAME durable key as daily producer',async()=>{
 const x=runner();
 await x.invoke();await x.invoke();
 assert.equal(x.outbox.size,1);
 assert.equal(x.sentCalls.length,2,'Both producer calls go through the shared transport/Outbox');
 assert.equal(x.sentCalls[0].opts.idempotencyKey,x.sentCalls[1].opts.idempotencyKey);
 const sameFromDaily=automatedWhatsAppKey('scheduled_template',{
   eventId:event.id,recipientId:supplier.id,eventDate:event.event_date,
   serviceId:eventService.id,templateType:template.type,target:'supplier'
 });
 assert.equal(x.sentCalls[0].opts.idempotencyKey,sameFromDaily);
 assert.equal(x.sentCalls[0].opts.sourceType,'scheduled_template');
});
test('quiet-hour source carries the same stable key until delayed delivery',async()=>{
 const x=runner({quiet:true});
 await x.invoke();await x.invoke();
 assert.equal(x.sentCalls.length,0,'No WhatsApp API is called during quiet hours');
 assert.equal(x.pending.length,2);
 assert.equal(JSON.parse(x.pending[0].data).idempotency_key,JSON.parse(x.pending[1].data).idempotency_key);
 assert.equal(JSON.parse(x.pending[0].data).source_type,'scheduled_template');
 assert.equal(x.inApps.length,2,'Existing in-app fanout semantics are unchanged');
});
test('deduplicated UNKNOWN is not incorrectly reported as sent in legacy in-app mirror',async()=>{
 const x=runner({transportReceipt:{success:true,queued:false,status:'unknown',jobId:'unknown-job'}});
 await x.invoke();
 assert.equal(x.inApps.length,1);
 assert.equal(x.inApps[0].whatsapp_sent,false,'Unknown is never evidence of provider acceptance');
});
