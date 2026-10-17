import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsAppText, sendWhatsAppToChat, sendWhatsAppFileUri, sendWhatsAppTransport } from '../base44/shared/whatsappSend.ts';
import { drainWhatsAppOutbox, delayUntilNextSend, delayUntilNextSendMs, providerIntervalMs, lastDispatchForProvider, classifyWhatsAppError } from '../base44/shared/whatsappQueueWorker.ts';
import { readWhatsAppQueueControl } from '../base44/shared/whatsappOutbox.ts';

globalThis.Deno={env:{get:key=>({WASENDER_API_KEY:'synthetic-wasender',GREEN_API_INSTANCE_ID:'synthetic-green',GREEN_API_TOKEN:'synthetic-token'})[key]}};
test.after(()=>delete globalThis.Deno);

function fixture(overrides={}) {
 const now=new Date().toISOString();
 const control={id:'control-global',control_key:'global',enabled:true,paused:false,min_interval_seconds:0,max_messages_per_run:30,
   lease_owner:'',lease_until:'',enqueue_owner:'',enqueue_until:'',next_allowed_at:'',last_dispatched_at:'',...overrides};
 const jobs=[],notifications=[],agreements=[],cards=[],copies=[];
 let index=0;
 const matches=(row,query={})=>Object.entries(query).every(([key,value])=>{
   if(value&&typeof value==='object'){
     if('$in' in value)return value.$in.includes(row[key]);
     if('$lte' in value)return String(row[key]||'')<=String(value.$lte);
     if('$gte' in value)return String(row[key]||'')>=String(value.$gte);
   }
   return row[key]===value;
 });
 const buildApi=(rows,entityName)=>({
   list:async(sort,limit)=>[...rows].sort((a,b)=>String(a.created_date).localeCompare(String(b.created_date))).slice(0,limit||500),
   filter:async(query,sort,limit)=>rows.filter(x=>matches(x,query)).sort((a,b)=>{
     const field=sort?.replace(/^-/, '')||'created_date';
     const mul=String(sort||'').startsWith('-')?-1:1;
     return mul*String(a[field]||'').localeCompare(String(b[field]||''));
   }).slice(0,limit||500),
   get:async(id)=>rows.find(x=>x.id===id)||null,
   create:async(data)=>{const r={...data,id:entityName+'-'+(++index),created_date:new Date(Date.now()+index).toISOString()};rows.push(r);return r;},
   update:async(id,change)=>{const r=rows.find(x=>x.id===id);if(!r)throw new Error('record not found');Object.assign(r,change);return r;},
   updateMany:async(query,ops)=>{const found=rows.filter(r=>matches(r,query));for(const r of found)Object.assign(r,ops.$set||{});return {updated:found.length};}
 });
 const controlApi=buildApi([control],'control'),outboxApi=buildApi(jobs,'job');
 const client={asServiceRole:{entities:{
    WhatsAppQueueControl:controlApi,WhatsAppOutbox:outboxApi,
    AppSettings:{filter:async()=>[{setting_key:'whatsapp_default_provider',setting_value:control.selectedProvider||'wasender'}]},
    InAppNotification:{update:async(id,value)=>{notifications.push({id,value});return value}},
    ClientMessageDelivery:{update:async(id,value)=>{agreements.push({id,value});return value},get:async()=>({kind:'signed_copy',agreement_id:'agreement-main'})},
    EventAgreement:{updateMany:async(query,patch)=>{copies.push({query,patch});return {updated:1}}},
    CardSetupRequest:{update:async(id,value)=>{cards.push({id,value});return value}},
    EventService:{get:async(id)=>({id,event_id:'event-a',is_external:false,supplier_ids:'[\"supplier-a\"]',supplier_statuses:'{\"supplier-a\":\"confirmed\"}'})},
    Event:{get:async(id)=>({id,status:'confirmed'})}
   },integrations:{Core:{CreateFileSignedUrl:async({file_uri})=>({signed_url:'https://example.com/signed/'+encodeURIComponent(file_uri)})}}}
 };
 return {jobs,control,client,notifications,agreements,cards,copies};
}
test('first dispatch is immediate; delay applies only BETWEEN sends',()=>{
  const now=Date.parse('2026-10-12T12:00:00Z');
  assert.equal(delayUntilNextSend('',now,7),0);
  assert.equal(delayUntilNextSend('2026-10-12T11:59:00+00:00',now,7),0);
  assert.equal(delayUntilNextSend('2026-10-12T14:59:57+03:00',now,7),4_000);
  assert.equal(delayUntilNextSend('2026-10-12T11:59:58Z',now,7),5_000);
  assert.equal(delayUntilNextSend('2026-10-12T12:00:00Z',now,0),0);
});
test('provider-specific millisecond intervals and idle first message',()=>{
 const now=Date.parse('2026-10-13T14:00:00Z');
 const cfg={wasender_interval_ms:6250,green_interval_ms:125,min_interval_seconds:7};
 assert.equal(providerIntervalMs(cfg,'wasender'),6250);
 assert.equal(providerIntervalMs(cfg,'green'),125);
 assert.equal(delayUntilNextSendMs('',now,6250),0);
 assert.equal(delayUntilNextSendMs('2026-10-13T13:59:59.950Z',now,125),75);
 assert.equal(delayUntilNextSendMs('2026-10-13T13:59:59.950Z',now,6250),6200);
 assert.equal(delayUntilNextSendMs('2026-10-13T13:59:00Z',now,6250),0);
 assert.equal(providerIntervalMs({min_interval_seconds:3},'green'),3000);
});


test('pacing is independent across Green API and Wasender after both providers have history',async()=>{
 const old=new Date(Date.now()-60_000).toISOString();
 const x=fixture({selectedProvider:'green',green_interval_ms:170,wasender_interval_ms:5000,
   last_green_dispatched_at:old,last_wasender_dispatched_at:old,last_dispatched_at:old});
 await sendWhatsAppText('0501234567','green-1',x.client);
 x.control.selectedProvider='wasender';
 // Each backend request receives its own SDK client; provider lookup is
 // intentionally memoized only within that request.
 await sendWhatsAppText('0501234567','wasender-1',{...x.client});
 x.control.selectedProvider='green';
 await sendWhatsAppText('0501234567','green-2',{...x.client});
 const sent=[];
 const r=await drainWhatsAppOutbox(x.client,{maxRuntimeMs:6000,transport:async(job,provider)=>{
   sent.push({provider,at:Date.now(),job});return {messageId:'mix-'+sent.length};
 }});
 assert.equal(r.accepted,3,'Switching from Green to Wasender must not impose 5s before first Wasender message');
 assert.deepEqual(sent.map(e=>e.provider),['green','wasender','green']);
 assert.ok(sent[1].at-sent[0].at<1100,'A different provider does not inherit Green cooldown');
 assert.ok(sent[2].at-sent[0].at>=155,'Return to Green respects only previous GREEN dispatch');
 assert.equal(sent[2].job.prior_dispatch_at,sent[0].job.send_started_at);
 assert.equal(sent[1].job.prior_dispatch_at,old);
 assert.equal(x.control.last_green_dispatched_at,sent[2].job.send_started_at);
 assert.equal(x.control.last_wasender_dispatched_at,sent[1].job.send_started_at);
 assert.equal(x.control.last_provider,'green');
});
test('legacy queue rows retain safe pacing without per-provider timestamps',()=>{
 const t=new Date('2026-10-17T10:00:00Z').toISOString();
 const cfg={last_provider:'wasender',last_dispatched_at:t};
 assert.equal(lastDispatchForProvider(cfg,'wasender'),t);
 assert.equal(lastDispatchForProvider(cfg,'green'),t,
   'Migration must not accidentally violate a provider gap with unknown history');
 assert.equal(lastDispatchForProvider({...cfg,last_green_dispatched_at:'2026-10-17T09:58:00Z'},'green'),
   '2026-10-17T09:58:00Z');
 assert.equal(lastDispatchForProvider({last_dispatched_at:''},'green'),'');
});
test('stale cancelled jobs consume a bounded worker slot and cannot starve other sources',async()=>{
 const x=fixture({selectedProvider:'green',green_interval_ms:0,wasender_interval_ms:0,
   max_messages_per_run:2});
 for(let i=0;i<5;i++)await sendWhatsAppText('0501234567','obsolete '+i,x.client,{
   sourceType:'assignment_new',eventServiceId:'service-a',supplierId:'supplier-a'
 });
 await sendWhatsAppText('0501234567','urgent invoice',x.client,{sourceType:'invoice'});
 const contacts=[];const transport=async(job)=>{contacts.push(job.source_type);return {messageId:'invoice-receipt'}};
 const first=await drainWhatsAppOutbox(x.client,{maxRuntimeMs:8000,transport});
 assert.equal(first.processed,2);assert.equal(first.skipped,2);assert.equal(first.continued,true);
 const second=await drainWhatsAppOutbox(x.client,{maxRuntimeMs:8000,transport});
 assert.equal(second.processed,2);assert.equal(second.skipped,2);
 const third=await drainWhatsAppOutbox(x.client,{maxRuntimeMs:8000,transport});
 assert.equal(third.processed,2);
 assert.equal(third.skipped,1);
 assert.equal(third.accepted,1);
 assert.deepEqual(contacts,['invoice']);
 assert.equal(x.jobs.filter(j=>j.status==='cancelled').length,5);
});
test('Green API 200 without idMessage is UNKNOWN, never proof of delivery',async()=>{
 const x=fixture({selectedProvider:'green',green_interval_ms:0});
 await sendWhatsAppText('0501234567','must have receipt',x.client,{sourceType:'invoice'});
 const originalFetch=globalThis.fetch;
 let networkCalls=0;
 globalThis.fetch=async()=>{networkCalls++;return {ok:true,status:200,json:async()=>({})};};
 try{
   const r=await drainWhatsAppOutbox(x.client);
   assert.equal(r.unknown,1);
   assert.equal(r.accepted,0);
   assert.equal(x.jobs[0].status,'unknown');
   assert.equal(networkCalls,1);
   await drainWhatsAppOutbox(x.client);
   assert.equal(networkCalls,1,'Never silently replay a provider request with unverified receipt');
 }finally{globalThis.fetch=originalFetch;}
});
test('Green API explicit idMessage is recognized as provider acceptance, NOT delivery',async()=>{
 const x=fixture({selectedProvider:'green',green_interval_ms:0});
 await sendWhatsAppText('0501234567','message',x.client);
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({idMessage:'green-abc-42'})});
 try{
   const r=await drainWhatsAppOutbox(x.client);
   assert.equal(r.accepted,1);
   assert.equal(x.jobs[0].provider_message_id,'green-abc-42');
 }finally{globalThis.fetch=originalFetch;}
});

test('the active provider controls real worker pacing in milliseconds',async()=>{
 const x=fixture({selectedProvider:'green',green_interval_ms:110,wasender_interval_ms:7000,
   min_interval_seconds:7});
 for(let i=0;i<3;i++)await sendWhatsAppText('0501234567','entry '+i,x.client);
 const times=[];const started=Date.now();
 const result=await drainWhatsAppOutbox(x.client,{maxRuntimeMs:11000,transport:async(_job,provider)=>{
   assert.equal(provider,'green');times.push(Date.now());return {messageId:'ms-test'};
 }});
 assert.equal(result.accepted,3);
 assert.equal(times.length,3);
 assert.ok(times[0]-started<250,'First message must not wait for configured interval');
 assert.ok(times[1]-times[0]>=100,'Second message must respect Green API millisecond interval');
 assert.ok(times[2]-times[1]>=100,'Third message must respect Green API millisecond interval');
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
test('migration safety: disabled queue preserves legacy delivery instead of losing messages',async()=>{
 const x=fixture({enabled:false});
 const previousFetch=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>({
  ok:true,status:200,json:async()=>({success:true,data:{msgId:'legacy-ok'}})
 });
 try{
  const receipt=await sendWhatsAppText('0501234567','legacy mode',x.client);
  assert.equal(receipt.queued,false);
  assert.equal(receipt.messageId,'legacy-ok');
  assert.equal(x.jobs.length,0);
 }finally{globalThis.fetch=previousFetch;}
});

test('hot-path idempotent enqueue avoids duplicate control reads and redundant CAS confirmation reads',async()=>{
 const x=fixture({selectedProvider:'green'});
 let controlFilters=0,controlGets=0;
 const controls=x.client.asServiceRole.entities.WhatsAppQueueControl;
 const filter=controls.filter,get=controls.get;
 controls.filter=async(...args)=>{controlFilters++;return filter(...args)};
 controls.get=async(...args)=>{controlGets++;return get(...args)};
 const r=await sendWhatsAppText('0501234567','one durable message',x.client,{
   sourceType:'assignment_new',idempotencyKey:'canonical:once'
 });
 assert.equal(r.queued,true);
 assert.equal(controlFilters,2,'One control read at route and one at lock acquisition, not three');
 assert.equal(controlGets,0,'Conditional compare-and-swap is enough ownership proof');
 assert.equal(x.jobs.length,1);
});
test('enqueue detects a disable occurring after the caller originally checked the queue',async()=>{
 const x=fixture({selectedProvider:'green'});
 const controls=x.client.asServiceRole.entities.WhatsAppQueueControl;
 const filter=controls.filter;let reads=0;
 controls.filter=async(...args)=>{reads++;if(reads===2)x.control.enabled=false;return filter(...args)};
 await assert.rejects(sendWhatsAppText('0501234567','must not queue while disabled',x.client,{
   idempotencyKey:'disabled-during-lock'
 }),/disabled before enqueue/i);
 assert.equal(x.jobs.length,0,'No job may be written after the lock sees disabled');
 assert.equal(x.control.enqueue_owner,'','The enqueue lock must always release on this error');
});

test('deduplicated messages do not waste provider configuration reads',async()=>{
 const x=fixture({selectedProvider:'green'});
 let reads=0;
 x.client.asServiceRole.entities.AppSettings.filter=async()=>{
   reads++;return [{setting_key:'whatsapp_default_provider',setting_value:'green'}];
 };
 const opts={sourceType:'assignment_new',idempotencyKey:'stable-assignment:1'};
 const a=await sendWhatsAppText('0501234567','Once',x.client,opts);
 const b=await sendWhatsAppText('0501234567','Once',x.client,opts);
 assert.equal(a.queued,true);
 assert.equal(b.deduplicated,true);
 assert.equal(x.jobs.length,1);
 assert.equal(reads,1,'Provider settings should be read only for the new job');
});

test('provider is pinned when enqueued and is never silently changed when default provider changes',async()=>{
  const x=fixture({selectedProvider:'green',green_interval_ms:0,wasender_interval_ms:0});
  await sendWhatsAppText('0501234567','green-created',x.client,{sourceType:'assignment_new'});
  x.control.selectedProvider='wasender';
  const nextRequestClient={...x.client,asServiceRole:x.client.asServiceRole};
  await sendWhatsAppText('0501234567','wasender-created',nextRequestClient,{sourceType:'assignment_new'});
  assert.equal(x.jobs[0].requested_provider,'green');
  assert.equal(x.jobs[1].requested_provider,'wasender');
  x.control.selectedProvider='green';
  const workerClient={...x.client,asServiceRole:x.client.asServiceRole};
  const routes=[];
  const result=await drainWhatsAppOutbox(workerClient,{transport:async(job,provider)=>{
    routes.push({message:job.message_text,provider});return {messageId:'route-'+routes.length};
  }});
  assert.equal(result.accepted,2);
  assert.deepEqual(routes.map(x=>x.provider),['green','wasender']);
});

test('worker saves causal timing metadata and wake source without extra provider calls',async()=>{
 const x=fixture({selectedProvider:'green',green_interval_ms:0,wasender_interval_ms:0});
 await sendWhatsAppText('0501234567','diagnostic job',x.client);
 let transports=0;
 const r=await drainWhatsAppOutbox(x.client,{
   wakeReason:'continue',
   transport:async()=>{transports++;await new Promise(resolve=>setTimeout(resolve,3));return {messageId:'diagnostic-accepted'}}
 });
 assert.equal(r.accepted,1);
 assert.equal(transports,1);
 const j=x.jobs[0];
 assert.equal(j.status,'accepted');
 assert.equal(j.worker_wake_reason,'continue');
 assert.ok(j.worker_run_id);
 assert.equal(j.worker_run_id,x.control.last_worker_run_id);
 assert.equal(x.control.last_worker_wake_reason,'continue');
 assert.equal(x.control.last_batch_count,1);
 assert.ok(x.control.last_batch_elapsed_ms>=0);
 assert.ok(Date.parse(j.job_claimed_at)>=Date.parse(j.rate_ready_at));
 assert.ok(Date.parse(j.transport_finished_at)>=Date.parse(j.transport_started_at));
 assert.ok(Date.parse(j.completed_at)>=Date.parse(j.transport_finished_at));
 assert.equal(j.configured_interval_ms,0);
 assert.equal(j.prior_dispatch_at,'');
 assert.equal(x.jobs.length,1);
});
test('provider timeout retains transport timing but stays UNKNOWN with zero automatic replay',async()=>{
 const x=fixture({selectedProvider:'green',green_interval_ms:0});
 await sendWhatsAppText('0501234567','uncertain transport',x.client);
 let attempts=0;
 const transport=async()=>{
   attempts++;
   throw Object.assign(new Error('Simulated timeout'),{errorCode:502,deliveryUncertain:true});
 };
 const r=await drainWhatsAppOutbox(x.client,{wakeReason:'watchdog',transport});
 assert.equal(r.unknown,1);
 assert.equal(x.jobs[0].status,'unknown');
 assert.equal(x.jobs[0].worker_wake_reason,'watchdog');
 assert.ok(Date.parse(x.jobs[0].transport_finished_at)>=Date.parse(x.jobs[0].transport_started_at));
 await drainWhatsAppOutbox(x.client,{wakeReason:'watchdog',transport});
 assert.equal(attempts,1,'Uncertain provider outcome must not be retried');
});

test('bounded batches wake the entity workflow with update after releasing the lease',async()=>{
 const x=fixture({selectedProvider:'green',green_interval_ms:0,max_messages_per_run:1});
 const controls=x.client.asServiceRole.entities.WhatsAppQueueControl;
 const updates=[];
 const original=controls.update;
 controls.update=async(id,patch)=>{updates.push({patch,leased:!!x.control.lease_owner});return original(id,patch);};
 for(let i=0;i<3;i++)await sendWhatsAppText('0501234567','batch '+i,x.client);
 const receipts=[];
 const transport=async(job)=>{receipts.push(job.id);return {messageId:'batch-'+receipts.length}};
 const first=await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(first.accepted,1);assert.equal(first.continued,true);
 assert.equal(updates.length,1);
 assert.equal(updates[0].leased,false);
 assert.ok(updates[0].patch.wake_requested_at);
 const second=await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(second.accepted,1);assert.equal(second.continued,true);
 const third=await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(third.accepted,1);assert.equal(third.continued,false);
 assert.equal(updates.length,2,'Do not self-trigger when the queue is empty');
 assert.equal(new Set(receipts).size,3);
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
test('cancelled or confirmed assignments are not sent from a delayed queue',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','new assignment',x.client,{sourceType:'assignment_new',eventServiceId:'service-a',supplierId:'supplier-a'});
 let actualCalls=0;
 const result=await drainWhatsAppOutbox(x.client,{transport:async()=>{actualCalls++;return {messageId:'unwanted'}}});
 assert.equal(actualCalls,0);
 assert.equal(x.jobs[0].status,'cancelled');
});

test('expired payment links and OTP messages are not sent after queue delay',async()=>{
  const x=fixture();
  const expiry=new Date(Date.now()-60000).toISOString();
  await sendWhatsAppText('0501234567','sensitive link',x.client,{sourceType:'payment_link',expiresAt:expiry});
  let calls=0;
  await drainWhatsAppOutbox(x.client,{transport:async()=>{calls++;return {messageId:'unexpected'}}});
  assert.equal(calls,0);
  assert.equal(x.jobs[0].status,'expired');
});

test('expired agreement links reconcile downstream delivery state without contacting provider',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','obsolete verification code',x.client,{
   sourceType:'agreement',clientMessageDeliveryId:'delivery-1',
   expiresAt:new Date(Date.now()-120000).toISOString()
 });
 const provider=async()=>{throw Error('Expired message must never reach a provider')};
 const r=await drainWhatsAppOutbox(x.client,{transport:provider});
 assert.equal(x.jobs[0].status,'expired');
 assert.equal(x.agreements.length,1);
 assert.equal(x.agreements[0].value.state,'expired');
 assert.equal(r.accepted,0);
});

test('an HTTP 401 from Green does not block a queued Wasender message',async()=>{
 const x=fixture({selectedProvider:'green',green_interval_ms:0,wasender_interval_ms:0});
 await sendWhatsAppText('0501234567','green message',x.client);
 x.control.selectedProvider='wasender';
 await sendWhatsAppText('0501234567','wasender message',{...x.client});
 const attempts=[];
 const r=await drainWhatsAppOutbox(x.client,{transport:async(job,provider)=>{
   attempts.push(provider);
   if(provider==='green')throw Object.assign(new Error('Unauthorized'),{errorCode:401,deliveryUncertain:false});
   return {messageId:'wasender-accepted'};
 }});
 assert.equal(r.failed,1);
 assert.equal(r.accepted,1);
 assert.deepEqual(attempts,['green','wasender']);
 assert.deepEqual(x.jobs.map(j=>j.status),['failed','accepted']);
 assert.equal(x.jobs[0].attempt_count,1);
 assert.equal(x.jobs[1].provider_message_id,'wasender-accepted');
});
test('missing Green credentials safely defers only Green with zero transport attempts; Wasender proceeds',async()=>{
 const x=fixture({selectedProvider:'green',green_interval_ms:0,wasender_interval_ms:0});
 await sendWhatsAppText('0501234567','green no-key',x.client);
 x.control.selectedProvider='wasender';
 await sendWhatsAppText('0501234567','wasender ready',{...x.client});
 const before=globalThis.Deno;
 globalThis.Deno={env:{get:key=>key==='GREEN_API_INSTANCE_ID'||key==='GREEN_API_TOKEN'?'':key==='WASENDER_API_KEY'?'has-session':''}};
 try{
   let calls=0;
   const r=await drainWhatsAppOutbox(x.client,{transport:async(job,provider)=>{
     calls++;assert.equal(provider,'wasender');return {messageId:'wa-success'};
   }});
   assert.equal(calls,1);
   assert.equal(r.accepted,1);
   assert.equal(r.retried,1);
   assert.equal(x.jobs[0].status,'retry_wait');
   assert.equal(x.jobs[0].attempt_count,0,'No external send was attempted without credentials');
   assert.ok(Date.parse(x.jobs[0].available_at)>Date.now());
   assert.equal(x.jobs[1].status,'accepted');
 }finally{globalThis.Deno=before;}
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
test('100 future retries cannot starve a newer due message',async()=>{
 const x=fixture({min_interval_seconds:0});
 const future=new Date(Date.now()+120_000).toISOString();
 for(let i=0;i<110;i++)x.jobs.push({
  id:'future-'+i,created_date:new Date(Date.now()-100_000+i).toISOString(),
  status:'retry_wait',available_at:future,attempt_count:1
 });
 await sendWhatsAppText('0501234567','recent ready',x.client,{sourceType:'assignment'});
 let calls=0;
 const r=await drainWhatsAppOutbox(x.client,{maxRuntimeMs:7000,transport:async(job)=>{
  calls++;assert.equal(job.message_text,'recent ready');return {messageId:'ok'};
 }});
 assert.equal(calls,1);assert.equal(r.accepted,1);
 assert.equal(x.jobs.filter(j=>j.status==='retry_wait').length,110);
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
 assert.equal(x.copies[0].patch.$set.copy_state,'accepted');
});
test('retry-after header extends central 429 cooldown',()=>{
 const now=Date.parse('2026-10-12T10:00:00Z');
 const outcome=classifyWhatsAppError({errorCode:429,retryAfterSeconds:80},1,3,now);
 assert.equal(outcome.status,'retry_wait');
 assert.equal(Date.parse(outcome.retryAt)-now,80000);
});

test('worker classifies safe rejections and uncertainty without automatic duplicates',()=>{
 assert.equal(classifyWhatsAppError({errorCode:429},1).status,'retry_wait');
 assert.equal(classifyWhatsAppError({errorCode:429},3).status,'failed');
 assert.equal(classifyWhatsAppError({errorCode:401},1).status,'failed');
 assert.equal(classifyWhatsAppError({errorCode:503},1).status,'unknown');
 assert.equal(classifyWhatsAppError({deliveryUncertain:true,errorCode:0},1).status,'unknown');
});
