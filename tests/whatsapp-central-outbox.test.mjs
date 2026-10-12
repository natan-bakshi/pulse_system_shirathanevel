import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsAppText, sendWhatsAppToChat, sendWhatsAppFileUri, sendWhatsAppTransport } from '../base44/shared/whatsappSend.ts';
import { drainWhatsAppOutbox, delayUntilNextSend, classifyWhatsAppError } from '../base44/shared/whatsappQueueWorker.ts';
import { readWhatsAppQueueControl } from '../base44/shared/whatsappOutbox.ts';

globalThis.Deno={env:{get:key=>({WASENDER_API_KEY:'synthetic-wasender',GREEN_API_INSTANCE_ID:'synthetic-green',GREEN_API_TOKEN:'synthetic-token'})[key]}};
test.after(()=>delete globalThis.Deno);

function fixture(overrides={}) {
 const now=new Date().toISOString();
 const control={id:'control-global',control_key:'global',enabled:true,paused:false,min_interval_seconds:0,max_messages_per_run:30,
   lease_owner:'',lease_until:'',enqueue_owner:'',enqueue_until:'',next_allowed_at:'',last_dispatched_at:'',...overrides};
 const jobs=[],notifications=[],agreements=[],cards=[];
 let index=0;
 const matches=(row,query={})=>Object.entries(query).every(([key,value])=>{
   if(value&&typeof value==='object'&&('$in' in value))return value.$in.includes(row[key]);
   return row[key]===value;
 });
 const buildApi=(rows,entityName)=>({
   list:async(sort,limit)=>[...rows].sort((a,b)=>String(a.created_date).localeCompare(String(b.created_date))).slice(0,limit||500),
   filter:async(query,sort,limit)=>rows.filter(x=>matches(x,query)).sort((a,b)=>String(a.created_date).localeCompare(String(b.created_date))).slice(0,limit||500),
   get:async(id)=>rows.find(x=>x.id===id)||null,
   create:async(data)=>{const r={...data,id:entityName+'-'+(++index),created_date:new Date(Date.now()+index).toISOString()};rows.push(r);return r;},
   update:async(id,change)=>{const r=rows.find(x=>x.id===id);if(!r)throw new Error('record not found');Object.assign(r,change);return r;},
   updateMany:async(query,ops)=>{const found=rows.filter(r=>matches(r,query));for(const r of found)Object.assign(r,ops.$set||{});return {updated:found.length};}
 });
 const controlApi=buildApi([control],'control'),outboxApi=buildApi(jobs,'job');
 const client={asServiceRole:{entities:{
    WhatsAppQueueControl:controlApi,WhatsAppOutbox:outboxApi,
    AppSettings:{filter:async()=>[{setting_key:'whatsapp_default_provider',setting_value:'wasender'}]},
    InAppNotification:{update:async(id,value)=>{notifications.push({id,value});return value}},
    ClientMessageDelivery:{update:async(id,value)=>{agreements.push({id,value});return value}},
    CardSetupRequest:{update:async(id,value)=>{cards.push({id,value});return value}}
   },integrations:{Core:{CreateFileSignedUrl:async({file_uri})=>({signed_url:'https://example.com/signed/'+encodeURIComponent(file_uri)})}}}
 };
 return {jobs,control,client,notifications,agreements,cards};
}
test('first dispatch is immediate; delay applies only BETWEEN sends',()=>{
  const now=Date.parse('2026-10-12T12:00:00Z');
  assert.equal(delayUntilNextSend('',now,7),0);
  assert.equal(delayUntilNextSend('2026-10-12T11:59:00+00:00',now,7),0);
  assert.equal(delayUntilNextSend('2026-10-12T14:59:57+03:00',now,7),4_000);
  assert.equal(delayUntilNextSend('2026-10-12T11:59:58Z',now,7),5_000);
  assert.equal(delayUntilNextSend('2026-10-12T12:00:00Z',now,0),0);
});
test('every business entry creates a durable job, no provider call while enqueueing',async()=>{
 const x=fixture();
 const oldFetch=globalThis.fetch;
 globalThis.fetch=()=>{throw Error('must never contact provider during enqueue')};
 try{
  const a=await sendWhatsAppText('0501234567','message',x.client,{sourceType:'assignment',sourceId:'test'});
  const b=await sendWhatsAppToChat('120363123456789@g.us','group message',x.client,{sourceType:'reminder'});
  const c=await sendWhatsAppFileUri('0501234567','private://invoice','invoice.pdf','document',x.client,{sourceType:'invoice'});
  assert.equal(a.queued,true);assert.equal(b.queued,true);assert.equal(c.queued,true);
  assert.equal(x.jobs.length,3);assert.equal(x.jobs[1].chat_id,'120363123456789@g.us');
  assert.equal(x.jobs[2].file_uri,'private://invoice');
  assert.equal(x.jobs[2].document_url,'');
 }finally{globalThis.fetch=oldFetch}
});
test('one worker dispatches multiple sources FIFO without delay before first',async()=>{
 const x=fixture();
 for(const type of ['assignment','reminder','invoice','payment_link','manual']){
   await sendWhatsAppText('0501234567',type,x.client,{sourceType:type});
 }
 const calls=[];const started=Date.now();
 const result=await drainWhatsAppOutbox(x.client,{transport:async(job,provider)=>{
   calls.push({type:job.source_type,time:Date.now(),provider});return {messageId:'test-'+calls.length};
 }});
 assert.equal(result.accepted,5);assert.deepEqual(calls.map(c=>c.type),['assignment','reminder','invoice','payment_link','manual']);
 assert.equal(x.jobs.filter(j=>j.status==='accepted').length,5);
 assert.ok(calls[0].time-started<600,'first send should be immediate when idle');
 assert.equal(x.control.lease_owner,'');
});
test('competing workflows share one lease; no duplicate provider calls',async()=>{
 const x=fixture();for(let i=0;i<20;i++)await sendWhatsAppText('0501234567','m'+i,x.client);
 const accepted=new Set();let calls=0;
 const transport=async(job)=>{calls++;await new Promise(r=>setTimeout(r,1));assert.ok(!accepted.has(job.id));accepted.add(job.id);return {messageId:'id-'+job.id}};
 const [a,b]=await Promise.all([drainWhatsAppOutbox(x.client,{transport}),drainWhatsAppOutbox(x.client,{transport})]);
 assert.equal(calls,20);assert.equal(accepted.size,20);
 assert.equal(x.jobs.filter(j=>j.status==='accepted').length,20);
 assert.equal([a.reason,b.reason].includes('busy'),true);
});
test('provider timeout remains unknown and is never retried',async()=>{
 const x=fixture();await sendWhatsAppText('0501234567','message',x.client);
 let calls=0;const transport=async()=>{calls++;throw {deliveryUncertain:true,errorCode:503}};
 await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(x.jobs[0].status,'unknown');
 await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(calls,1);
});
test('explicit 429 is centralized backoff, not an immediate local retry',async()=>{
 const x=fixture();await sendWhatsAppText('0501234567','message',x.client);
 let calls=0;await drainWhatsAppOutbox(x.client,{maxRuntimeMs:9000,transport:async()=>{calls++;throw {deliveryUncertain:false,errorCode:429}}});
 assert.equal(calls,1);
 assert.equal(x.jobs[0].status,'retry_wait');
 assert.ok(Date.parse(x.jobs[0].available_at)>Date.now());
});
test('expired in-flight claim is marked unknown by watchdog without replay',async()=>{
 const x=fixture();
 x.jobs.push({id:'orphan',created_date:'2026-10-11T00:00:00Z',status:'sending',attempt_count:1,send_started_at:'2026-10-11T01:00:00Z'});
 await drainWhatsAppOutbox(x.client,{transport:async()=>{throw Error('never transport orphan')}});
 assert.equal(x.jobs[0].status,'unknown');
});
test('paused or disabled queue never dispatches',async()=>{
 for(const state of [{paused:true},{enabled:false}]){
  const x=fixture(state);x.jobs.push({id:'queued',status:'queued',created_date:new Date().toISOString(),available_at:new Date().toISOString()});
  const r=await drainWhatsAppOutbox(x.client,{transport:async()=>{throw Error('unexpected send')}});
  assert.equal(r.sent,0);assert.equal(x.jobs[0].status,'queued');
 }
});
test('idempotency key is preserved across duplicate triggers',async()=>{
 const x=fixture();
 const first=await sendWhatsAppText('0501234567','assigned',x.client,{idempotencyKey:'assignment:event:a:rev1'});
 const second=await sendWhatsAppText('0501234567','assigned',x.client,{idempotencyKey:'assignment:event:a:rev1'});
 assert.equal(first.jobId,second.jobId);assert.equal(x.jobs.length,1);
});
test('parallel idempotent enqueues are serialized and produce only one job',async()=>{
 const x=fixture();
 const results=await Promise.all(Array.from({length:12},()=>sendWhatsAppText('0501234567','same assignment',x.client,{idempotencyKey:'assignment:one:revision1'})));
 assert.equal(x.jobs.length,1);
 assert.equal(new Set(results.map(r=>r.jobId)).size,1);
 assert.equal(x.control.enqueue_owner,'');
});

test('worker updates linked record only after provider acceptance',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','confirmation',x.client,{inAppNotificationId:'notice-1',clientMessageDeliveryId:'agreement-1',cardSetupRequestId:'card-1'});
 assert.equal(x.notifications.length,0);
 await drainWhatsAppOutbox(x.client,{transport:async()=>({messageId:'provider-123'})});
 assert.equal(x.notifications[0].value.whatsapp_sent,true);
 assert.equal(x.agreements[0].value.state,'accepted');
 assert.equal(x.cards[0].value.link_message_state,'accepted');
});
test('worker classifies safe rejections and uncertainty without automatic duplicates',()=>{
 assert.equal(classifyWhatsAppError({errorCode:429},1).status,'retry_wait');
 assert.equal(classifyWhatsAppError({errorCode:429},3).status,'failed');
 assert.equal(classifyWhatsAppError({errorCode:401},1).status,'failed');
 assert.equal(classifyWhatsAppError({errorCode:503},1).status,'unknown');
 assert.equal(classifyWhatsAppError({deliveryUncertain:true,errorCode:0},1).status,'unknown');
});
