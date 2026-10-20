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
