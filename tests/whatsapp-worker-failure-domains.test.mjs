import test from 'node:test';
import assert from 'node:assert/strict';
import {sendWhatsAppText} from '../base44/shared/whatsappSend.ts';
import {drainWhatsAppOutbox,persistWhatsAppProviderOutcome} from '../base44/shared/whatsappQueueWorker.ts';

// Synthetic Base44 entity APIs. These tests NEVER call a real WhatsApp provider.
const originalDeno=globalThis.Deno;
globalThis.Deno={env:{get:k=>({
  GREEN_API_INSTANCE_ID:'synthetic',GREEN_API_TOKEN:'synthetic',
  WASENDER_API_KEY:'synthetic'
})[k]||''}};
test.after(()=>{if(originalDeno===undefined)delete globalThis.Deno;else globalThis.Deno=originalDeno;});

function fixture(){
 const jobs=[];let counter=0;
 const control={id:'global',control_key:'global',enabled:true,paused:false,
   lease_owner:'',lease_until:'',enqueue_owner:'',enqueue_until:'',
   last_dispatched_at:'',green_interval_ms:0,wasender_interval_ms:0,max_messages_per_run:16};
 const matches=(row,q)=>Object.entries(q).every(([k,v])=>{
   if(v && typeof v==='object'){
     if('$in' in v)return v.$in.includes(row[k]);
     if('$lte' in v)return String(row[k]||'')<=String(v.$lte);
   }
   return row[k]===v;
 });
 const entity=(rows)=>({
   get:async id=>rows.find(r=>r.id===id)||null,
   update:async(id,patch)=>{const row=rows.find(r=>r.id===id);if(!row)throw Error('Not found');Object.assign(row,patch);return row;},
   updateMany:async(q,patch)=>{const found=rows.filter(r=>matches(r,q));found.forEach(r=>Object.assign(r,patch.$set));return {updated:found.length};},
   filter:async(q,sort,limit=100)=>{
     const result=rows.filter(r=>matches(r,q));
     const desc=String(sort||'').startsWith('-'),key=String(sort||'created_date').replace(/^-/, '');
     result.sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''))*(desc?-1:1));
     return result.slice(0,limit);
   },
   create:async record=>{
     const row={...record,id:'job-'+(++counter),created_date:new Date(Date.now()+counter).toISOString()};
     rows.push(row);return row;
   }
 });
 const controls=entity([control]),outbox=entity(jobs);
 const client={asServiceRole:{entities:{
   WhatsAppQueueControl:controls,WhatsAppOutbox:outbox,
   AppSettings:{filter:async()=>[{setting_key:'whatsapp_default_provider',setting_value:'green'}]},
   EventService:{get:async()=>({id:'svc-1',event_id:'event-1',supplier_ids:'["supplier-1"]',supplier_statuses:'{"supplier-1":"pending"}'})},
   Event:{get:async()=>({id:'event-1',status:'confirmed'})}
 }}};
 return {client,control,jobs,outbox,controls};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('seven ready scheduled fan-out recipients drain in ONE run instead of waiting five minutes for watchdog',async()=>{
 const x=fixture();
 for(let i=0;i<7;i++){
   await sendWhatsAppText('0501234567','scheduled fanout '+i,x.client,{
     sourceType:'scheduled_fanout',sourceId:'qa-fanout',
     idempotencyKey:'qa-fanout-recipient-'+i
   });
 }
 const started=Date.now(),seen=[];
 const result=await drainWhatsAppOutbox(x.client,{
   wakeReason:'outbox_create',
   transport:async job=>{seen.push(job.message_text);return {messageId:'green-fanout-'+seen.length}}
 });
 assert.equal(result.accepted,7);
 assert.equal(result.processed,7);
 assert.equal(result.continued,false);
 assert.equal(x.jobs.length,7);
 assert.equal(x.jobs.filter(j=>j.status==='accepted').length,7);
 assert.equal(new Set(seen).size,7);
 assert.equal(x.control.lease_owner,'');
 assert.ok(Date.now()-started<2500,'Ready burst must not sleep until the next five-minute watchdog');
});

test('fanout jobs created WHILE first provider call runs get picked up by same worker',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','fanout first',x.client,{
   sourceType:'scheduled_fanout',sourceId:'qa-fanout',idempotencyKey:'qa-first'});
 let calls=0,created=false;
 const r=await drainWhatsAppOutbox(x.client,{wakeReason:'outbox_create',
   transport:async()=>{
     calls++;
     if(!created){
       created=true;
       for(let i=1;i<7;i++){
         await x.outbox.create({chat_id:'972501234567@c.us',message_type:'text',
           message_text:'fanout followup '+i,source_type:'scheduled_fanout',
           idempotency_key:'qa-followup-'+i,requested_provider:'green',
           status:'queued',available_at:new Date().toISOString(),attempt_count:0});
       }
     }
     return {messageId:'green-concurrent-'+calls};
   }
 });
 assert.equal(r.accepted,7);
 assert.equal(calls,7,'A newly queued fanout job must be sent only once');
 assert.equal(x.jobs.every(j=>j.status==='accepted'),true);
 assert.equal(r.continued,false);
});

test('seven-recipient fanout exceeding batch limit wakes two successors, never five-minute watchdog',async()=>{
 const x=fixture();
 x.control.max_messages_per_run=3;
 let wakes=0,sends=0;
 const old=x.controls.update;
 x.controls.update=async(id,patch)=>{
   if(patch.wake_requested_at)wakes++;
   return old(id,patch);
 };
 for(let i=0;i<7;i++){
   await sendWhatsAppText('0501234567','fanout batch '+i,x.client,{
     sourceType:'scheduled_fanout',sourceId:'qa-batch',idempotencyKey:'qa-batch-'+i
   });
 }
 const transport=async()=>({messageId:'green-batch-'+(++sends)});
 const first=await drainWhatsAppOutbox(x.client,{wakeReason:'outbox_create',transport});
 const second=await drainWhatsAppOutbox(x.client,{wakeReason:'continue',transport});
 const third=await drainWhatsAppOutbox(x.client,{wakeReason:'continue',transport});
 assert.deepEqual([first.accepted,second.accepted,third.accepted],[3,3,1]);
 assert.deepEqual([first.continued,second.continued,third.continued],[true,true,false]);
 assert.equal(wakes,2);
 assert.equal(sends,7);
 assert.equal(x.jobs.filter(j=>j.status==='accepted').length,7);
 assert.equal(x.jobs.filter(j=>j.attempt_count!==1).length,0);
 assert.equal(x.control.lease_owner,'');
});

test('future-only notification releases global lease immediately; urgent invoice is not blocked',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','future scheduled message',x.client,{
   sourceType:'scheduled_notification',availableAt:new Date(Date.now()+5500).toISOString()
 });
 const started=Date.now();
 let calls=0;
 const transport=async()=>{calls++;return {messageId:'provider-'+calls}};
 const futureOnly=await drainWhatsAppOutbox(x.client,{transport,maxRuntimeMs:15000});
 assert.equal(futureOnly.processed,0);
 assert.equal(calls,0);
 assert.equal(x.jobs[0].status,'queued');
 assert.equal(x.control.lease_owner,'');
 assert.ok(Date.now()-started<1800,'A future-only message must never hold a long worker sleep');
 await sendWhatsAppText('0501234567','urgent invoice',x.client,{sourceType:'invoice'});
 const immediate=await drainWhatsAppOutbox(x.client,{transport,maxRuntimeMs:15000});
 assert.equal(immediate.accepted,1);
 assert.equal(x.jobs[0].status,'queued');
 assert.equal(x.jobs[1].status,'accepted');
 assert.equal(calls,1);
});

test('assignment status lookup outage defers ONLY that row; healthy agreement sends immediately',async()=>{
 const x=fixture();
 x.client.asServiceRole.entities.EventService.get=async()=>{throw Error('Transient source outage')};
 await sendWhatsAppText('0501234567','assignment',x.client,{
   sourceType:'assignment_new',eventServiceId:'svc-1',supplierId:'supplier-1'});
 await sendWhatsAppText('0501234567','agreement',x.client,{sourceType:'agreement'});
 const seen=[];
 const result=await drainWhatsAppOutbox(x.client,{transport:async j=>{
   seen.push(j.source_type);return {messageId:'provider-agreement'};
 }});
 assert.deepEqual(seen,['agreement']);
 assert.equal(result.retried,1);
 assert.equal(result.accepted,1);
 assert.equal(x.jobs[0].status,'retry_wait');
 assert.ok(Date.parse(x.jobs[0].available_at)>Date.now());
 assert.equal(x.jobs[0].attempt_count,0,'No provider attempt occurred during validation');
 assert.equal(x.jobs[1].status,'accepted');
});

test('provider ACCEPTED followed by database outage recovers by CAS without another HTTP call',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','customer agreement',x.client);
 const original=x.outbox.update;let failedOnce=false,transportCalls=0;
 x.outbox.update=async(id,patch)=>{
   if(!failedOnce){failedOnce=true;throw Error('Synthetic DB connection reset before commit');}
   return original(id,patch);
 };
 const r=await drainWhatsAppOutbox(x.client,{transport:async()=>{
   transportCalls++;return {messageId:'green-proven-1'};
 }});
 assert.equal(r.accepted,1);
 assert.equal(r.unknown,0);
 assert.equal(x.jobs[0].status,'accepted');
 assert.equal(x.jobs[0].provider_message_id,'green-proven-1');
 assert.equal(transportCalls,1);
 assert.equal((await drainWhatsAppOutbox(x.client,{transport:async()=>{throw Error('duplicate provider call')}})).reason,'empty');
});

test('database receipt COMMITTED but response lost is verified without overwriting accepted',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','customer copy',x.client);
 const original=x.outbox.update;let first=true,cas=0,calls=0;
 x.outbox.update=async(id,patch)=>{
   await original(id,patch);
   if(first){first=false;throw Error('Synthetic lost response after commit');}
 };
 const originalCas=x.outbox.updateMany;
 x.outbox.updateMany=async(q,p)=>{if(q.status==='sending')cas++;return originalCas(q,p)};
 const r=await drainWhatsAppOutbox(x.client,{transport:async()=>{
   calls++;return {messageId:'green-after-commit'};
 }});
 assert.equal(r.accepted,1);
 assert.equal(r.unknown,0);
 assert.equal(x.jobs[0].status,'accepted');
 assert.equal(cas,0,'Existing durable receipt needs no second write');
 assert.equal(calls,1);
});

test('unrecoverable receipt DB outage never retries the provider, leaves sending for watchdog review',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','client link',x.client);
 let sends=0;
 x.outbox.update=async()=>{throw Error('DB unavailable')};
 const originalCas=x.outbox.updateMany;
 x.outbox.updateMany=async(q,p)=>{
   if(q.status==='sending')throw Error('DB recovery unavailable');
   return originalCas(q,p);
 };
 const transport=async()=>{sends++;return {messageId:'accepted-but-not-durable'}};
 const r=await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(r.reason,'blocked');
 assert.equal(r.accepted,0,'Do not assert durable acceptance when receipt DB is down');
 assert.equal(x.jobs[0].status,'sending');
 assert.equal(x.jobs[0].attempt_count,1);
 assert.equal(sends,1);
 await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(sends,1,'Unverified in-flight job must never be replayed');
 assert.equal(x.control.lease_owner,'');
});

test('provider 2xx without messageId remains UNKNOWN, never accepted and never retried',async()=>{
 const x=fixture();await sendWhatsAppText('0501234567','message',x.client);
 let calls=0;const transport=async()=>{calls++;return {success:true,messageId:''}};
 const r=await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(r.unknown,1);
 assert.equal(r.accepted,0);
 assert.equal(x.jobs[0].status,'unknown');
 await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(calls,1);
});

test('new Outbox CREATE during lease release cannot be lost until watchdog',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','first message',x.client,{sourceType:'manual'});
 const originalRelease=x.controls.updateMany,originalWake=x.controls.update;
 let injected=0,wakes=0,providerCalls=0;
 x.controls.updateMany=async(q,p)=>{
   const result=await originalRelease(q,p);
   if(q.lease_owner && p.$set?.lease_owner==='' && !injected){
     injected++;
     // Simulates an Outbox CREATE whose own workflow saw the worker BUSY.
     await x.outbox.create({chat_id:'972501234567@c.us',message_type:'text',
       message_text:'second message during release',requested_provider:'green',
       status:'queued',available_at:new Date().toISOString()});
   }
   return result;
 };
 x.controls.update=async(id,patch)=>{
   if(patch.wake_requested_at)wakes++;
   return originalWake(id,patch);
 };
 const transport=async()=>{providerCalls++;return {messageId:'provider-'+providerCalls}};
 const first=await drainWhatsAppOutbox(x.client,{transport});
 assert.equal(first.accepted,1);
 assert.equal(first.continued,true,'Post-release scan must trigger successor for raced CREATE');
 assert.equal(wakes,1);
 assert.equal(x.jobs.length,2);
 assert.equal(x.jobs[1].status,'queued');
 const next=await drainWhatsAppOutbox(x.client,{transport,wakeReason:'continue'});
 assert.equal(next.accepted,1);
 assert.equal(providerCalls,2);
 assert.equal(x.jobs.every(j=>j.status==='accepted'),true);
});

test('future-only worker with no processed sends still catches urgent CREATE during lease release',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','tomorrow reminder',x.client,{
   sourceType:'scheduled_notification',availableAt:new Date(Date.now()+60000).toISOString()});
 const originalRelease=x.controls.updateMany,originalWake=x.controls.update;
 let injected=0,wakes=0;
 x.controls.updateMany=async(q,p)=>{
   const result=await originalRelease(q,p);
   if(q.lease_owner && p.$set?.lease_owner==='' && !injected){
     injected++;
     await x.outbox.create({chat_id:'972501234567@c.us',message_type:'text',
       message_text:'urgent queued while future-only worker finishes',
       requested_provider:'green',status:'queued',available_at:new Date().toISOString()});
   }
   return result;
 };
 x.controls.update=async(id,patch)=>{
   if(patch.wake_requested_at)wakes++;
   return originalWake(id,patch);
 };
 const r=await drainWhatsAppOutbox(x.client,{transport:async()=>{throw Error('should not send future job')}});
 assert.equal(r.processed,0);
 assert.equal(r.continued,true);
 assert.equal(wakes,1);
 assert.equal(x.jobs.length,2);
 assert.equal(x.jobs[0].status,'queued');
 const processed=await drainWhatsAppOutbox(x.client,{wakeReason:'continue',
   transport:async()=>({messageId:'urgent-accepted'})});
 assert.equal(processed.accepted,1);
 assert.equal(x.jobs[1].status,'accepted');
 assert.equal(x.jobs[0].status,'queued');
});

test('authenticated wrapper preflight reuses control and fast due dispatch avoids stale-row scans',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','fast path',x.client);
 const controls=x.client.asServiceRole.entities.WhatsAppQueueControl;
 const outbox=x.client.asServiceRole.entities.WhatsAppOutbox;
 let controlsReads=0,inflightReads=0;
 const originalControlRead=controls.filter,originalOutboxRead=outbox.filter;
 controls.filter=async(...args)=>{controlsReads++;return originalControlRead(...args)};
 outbox.filter=async(...args)=>{
   if(args[0]?.status==='sending')inflightReads++;
   return originalOutboxRead(...args);
 };
 const r=await drainWhatsAppOutbox(x.client,{
   initialControl:{...x.control},wakeReason:'outbox_create',
   transport:async()=>({messageId:'fast-accepted'})
 });
 assert.equal(r.accepted,1);
 assert.equal(controlsReads,0,'No duplicate control read on authenticated hot path');
 assert.equal(inflightReads,0,'Watchdog-only sweep must not delay a fresh message');
});

test('watchdog still recovers old in-flight sending while processing new due messages',async()=>{
 const x=fixture();
 x.jobs.push({id:'stale-old',created_date:'2026-10-10T00:00:00Z',
   available_at:'2026-10-10T00:00:00Z',send_started_at:'2026-10-10T00:00:00Z',
   status:'sending',attempt_count:1});
 await sendWhatsAppText('0501234567','due right now',x.client);
 let calls=0;
 const result=await drainWhatsAppOutbox(x.client,{wakeReason:'watchdog',
   transport:async()=>{calls++;return {messageId:'accepted-current'}}});
 assert.equal(result.accepted,1);
 assert.equal(calls,1);
 assert.equal(x.jobs[0].status,'unknown','Old in-flight is inspected only; not replayed');
 assert.equal(x.jobs[1].status,'accepted');
});

test('stale optimistic control preflight cannot send after administrator pauses queue',async()=>{
 const x=fixture();
 await sendWhatsAppText('0501234567','must not send',x.client);
 const earlier={...x.control};
 x.control.paused=true;
 const r=await drainWhatsAppOutbox(x.client,{initialControl:earlier,
   transport:async()=>{throw Error('Paused queue must never call provider')}});
 assert.equal(r.processed,0);
 assert.equal(x.jobs[0].status,'queued');
 assert.equal(x.control.lease_owner,'');
});

test('direct database persistence helper validates both write and read failures conservatively',async()=>{
 const record={id:'row-1',status:'sending',lease_token:'lease-1'};
 const job={...record};
 let creates=0;
 const db={
   update:async()=>{throw Error('Write failed')},
   get:async()=>{throw Error('Read failed')},
   updateMany:async(q,p)=>{
     creates++;
     assert.equal(q.status,'sending');
     assert.equal(q.lease_token,'lease-1');
     Object.assign(record,p.$set);return {updated:1};
   }
 };
 const proved=await persistWhatsAppProviderOutcome(db,job,{status:'accepted',provider_message_id:'green-saved'});
 assert.equal(proved,true);
 assert.equal(creates,1);
 assert.equal(record.provider_message_id,'green-saved');
});
