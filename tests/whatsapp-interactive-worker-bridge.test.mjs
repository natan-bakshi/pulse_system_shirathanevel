import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {drainWhatsAppOutbox} from '../base44/shared/whatsappQueueWorker.ts';

// Every test uses a synthetic Base44 SDK. Absolutely no outbound HTTP
// or actual client/supplier notification is performed by this suite.
const oldDeno=globalThis.Deno;
globalThis.Deno={env:{get:key=>({
 GREEN_API_INSTANCE_ID:'9903183013',GREEN_API_TOKEN:'sandbox-only-not-real',
 WASENDER_API_KEY:'sandbox-only-not-real'
})[key]||''}};
test.after(()=>{if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;});
const policy={enabled:true,quoteAssignment:false,buttons:[
 {action:'assignment_approve',label:'מאשר'},
 {action:'assignment_reject',label:'דוחה'},
 {action:'contact_office',label:'למשרד'}
]};
const opts=()=>({
 enabled:true,accountCapabilityVerified:true,capability:'mixed_url',
 senderAccountId:'9903183013',signingSecret:'signed-future-buttons-in-sandbox-only-01234567890',
 policy,officeNumber:'972501234567',officeLabel:'למשרד',
 subtle:webcrypto.subtle
});
function fixture(){
 const now=Date.now();
 const jobs=[],events={writes:0,snapshotWrites:0,creates:0,outboxReads:0,
   providerCalls:0,serviceReads:0};
 const service={
  id:'service-123',event_id:'event-123',is_external:false,
  supplier_ids:'["supplier-123"]',
  supplier_statuses:'{"supplier-123":"pending"}',
  assignment_intent_mode:'durable_v1',assignment_notification_intents:JSON.stringify([
   {supplier_id:'supplier-123',revision:4,
    key:'assignment:service-123:supplier-123:r4:SUPPLIER_NEW_ASSIGNMENT',state:'accepted'}
  ])
 };
 const control={id:'control-123',control_key:'global',
  enabled:true,paused:false,interactive_outbound_live_enabled:false,
  min_interval_seconds:0,green_interval_ms:0,wasender_interval_ms:0,
  max_messages_per_run:16,lease_owner:'',lease_until:'',
  last_dispatched_at:'',last_green_dispatched_at:'',
  enqueue_owner:'',enqueue_until:''};
 const matching=(row,query={})=>Object.entries(query).every(([k,v])=>{
  const actual=row[k]??null;
  if(v&&typeof v==='object'){
   if('$in' in v)return v.$in.includes(actual);
   if('$lte' in v)return String(actual||'')<=String(v.$lte);
  }
  return actual===(v??null);
 });
 const entity=(rows,name)=>({
  get:async id=>{
   if(name==='outbox')events.outboxReads++;
   return structuredClone(rows.find(r=>r.id===id)||null);
  },
  filter:async (query={},sort='created_date',limit=100)=>{
   const field=String(sort).replace(/^-/,''),mul=String(sort).startsWith('-')?-1:1;
   return rows.filter(r=>matching(r,query)).sort((a,b)=>
    mul*String(a[field]||'').localeCompare(String(b[field]||''))).slice(0,limit);
  },
  updateMany:async(query,change)=>{
   const selected=rows.filter(r=>matching(r,query));
   for(const row of selected)Object.assign(row,change.$set);
   if(name==='outbox'&&selected.length&&'interactive_button_bindings_json' in change.$set)
    events.snapshotWrites++;
   if(selected.length)events.writes++;
   return {updated:selected.length};
  },
  update:async(id,change)=>{
   const row=rows.find(r=>r.id===id);if(!row)throw Error('not found');
   Object.assign(row,change);events.writes++;return structuredClone(row);
  },
  create:async change=>{
   const row={...change,id:name+'-'+(++events.creates)};
   rows.push(row);return structuredClone(row);
  }
 });
 const outbox=entity(jobs,'outbox'),controls=entity([control],'control');
 const client={asServiceRole:{entities:{
  WhatsAppOutbox:outbox,WhatsAppQueueControl:controls,
  AppSettings:{filter:async()=>[{setting_key:'whatsapp_default_provider',setting_value:'green'}]},
  EventService:{get:async id=>{events.serviceReads++;return id===service.id?structuredClone(service):null;}},
  Event:{get:async id=>id==='event-123'?{id,status:'confirmed'}:null}
 }}};
 const add=(source='assignment_new',overrides={})=>{
  const row={
   id:'job-'+String(jobs.length+1).padStart(3,'0'),
   source_type:source,message_type:'text',
   message_text:source==='assignment_new'?'נדרש אישור שיבוץ':'תשלום בקישור',
   chat_id:'972501234567@c.us',
   idempotency_key:source==='assignment_new'
    ?'assignment:service-123:supplier-123:r4:SUPPLIER_NEW_ASSIGNMENT'
    :'invoice:job-'+jobs.length,
   event_service_id:source==='assignment_new'?'service-123':'',
   supplier_id:source==='assignment_new'?'supplier-123':'',
   requested_provider:'green',status:'queued',
   available_at:new Date(now-10000).toISOString(),
   created_date:new Date(now-2000+jobs.length*50).toISOString(),
   attempt_count:0,provider_message_id:'',...overrides
  };
  jobs.push(row);return row;
 };
 return {client,outbox,controls,service,control,jobs,events,add};
}
test('superseded queued supplier assignment is cancelled without a second provider call, even when interactive OFF',async()=>{
 const x=fixture();
 const old=x.add('assignment_new',{
  idempotency_key:'assignment:service-123:supplier-123:r3:SUPPLIER_NEW_ASSIGNMENT'
 });
 const fresh=x.add('assignment_new');
 const sent=[];
 const result=await drainWhatsAppOutbox(x.client,{maxRuntimeMs:10000,
  transport:async job=>{sent.push(job.id);return {messageId:'only-current-'+job.id};}
 });
 assert.equal(result.skipped,1);
 assert.equal(result.accepted,1);
 assert.equal(old.status,'cancelled');
 assert.equal(fresh.status,'accepted');
 assert.deepEqual(sent,[fresh.id]);
 assert.equal(x.events.snapshotWrites,0);
});
test('another supplier later revision does not cancel the still-pending original supplier assignment',async()=>{
 const x=fixture();
 x.service.supplier_ids='["supplier-123","supplier-456"]';
 x.service.supplier_statuses='{"supplier-123":"pending","supplier-456":"pending"}';
 const history=JSON.parse(x.service.assignment_notification_intents);
 history.push({supplier_id:'supplier-456',revision:5,state:'accepted',
  key:'assignment:service-123:supplier-456:r5:SUPPLIER_NEW_ASSIGNMENT'});
 x.service.assignment_notification_intents=JSON.stringify(history);
 const current=x.add(),sent=[];
 const result=await drainWhatsAppOutbox(x.client,{
  transport:async job=>{sent.push(job.id);return {messageId:'current-assignment-id'};}
 });
 assert.equal(result.accepted,1);
 assert.equal(result.skipped,0);
 assert.deepEqual(sent,[current.id]);
});
test('invalid intent history defers original assignment without any transport',async()=>{
 const x=fixture(),job=x.add();
 x.service.assignment_notification_intents='{';
 const result=await drainWhatsAppOutbox(x.client,{
  transport:async()=>{throw Error('must not send invalid intent')}
 });
 assert.equal(result.retried,1);
 assert.equal(result.accepted,0);
 assert.equal(job.status,'retry_wait');
 assert.equal(job.attempt_count,0);
});
test('DEFAULT-OFF worker preserves exact legacy path and does not snapshot or add DB reads',async()=>{
 const x=fixture();const j=x.add();
 const seen=[];
 const r=await drainWhatsAppOutbox(x.client,{maxRuntimeMs:10000,
  interactiveConfig:opts(),
  transport:async(job,provider,client,preview)=>{
   x.events.providerCalls++;seen.push({job:{...job},provider,preview});
   return {messageId:'legacy-confirmed-id'};
  }
 });
 assert.equal(r.accepted,1);
 assert.equal(x.events.providerCalls,1);
 assert.equal(x.events.snapshotWrites,0);
 assert.equal(j.sender_account_id,undefined);
 assert.equal(j.assignment_revision,undefined);
 assert.equal(j.interactive_button_bindings_json,undefined);
 assert.equal(seen[0].preview,null);
 assert.equal(seen[0].job.message_text,'נדרש אישור שיבוץ');
 assert.equal(j.status,'accepted');
});
test('production wrapper now wires ONLY explicitly gated single-chat QA; control defaults OFF',()=>{
 const fn=fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8');
 const schema=JSON.parse(fs.readFileSync('base44/entities/WhatsAppQueueControl.jsonc','utf8'));
 assert.equal(schema.properties.interactive_outbound_live_enabled.default,false);
 assert.match(fn,/trustedGreenButtonQaConfig\(controlRows\[0\]/);
 assert.match(fn,/\.\.\.\(qaConfig\?\{interactiveConfig:qaConfig\}:\{\}\)/);
 assert.doesNotMatch(fn,/interactiveConfig:opts\(\)/);
});
test('explicit test-only double gate freezes signed account+revision BEFORE ONE provider request',async()=>{
 const x=fixture();x.control.interactive_outbound_live_enabled=true;
 const j=x.add(),seen=[];
 const result=await drainWhatsAppOutbox(x.client,{
  maxRuntimeMs:10000,interactiveConfig:opts(),
  transport:async (job,provider,client,preview)=>{
   assert.equal(x.jobs[0].interactive_button_bindings_json,job.interactive_button_bindings_json,
    'snapshot must be durable before any provider attempt');
   assert.equal(x.jobs[0].status,'sending','claim precedes provider HTTP');
   x.events.providerCalls++;
   seen.push({job:{...job},provider,preview});
   return {messageId:'test-provider-message-id-123'};
  }
 });
 assert.equal(result.accepted,1);
 assert.equal(x.events.snapshotWrites,1);
 assert.equal(x.events.providerCalls,1);
 assert.equal(seen[0].preview.method,'sendInteractiveButtons');
 assert.equal(seen[0].preview.body.buttons.length,3);
 assert.equal(seen[0].preview.body.buttons[2].url,'https://wa.me/972501234567');
 assert.equal(seen[0].job.assignment_revision,'r4');
 assert.equal(seen[0].job.sender_account_id,'9903183013');
 assert.equal(j.status,'accepted');
 assert.equal(j.provider_message_id,'test-provider-message-id-123');
 assert.equal((await drainWhatsAppOutbox(x.client,{
  interactiveConfig:opts(),transport:async()=>{throw Error('must not send twice')}
 })).reason,'empty');
});
test('unknown beta capability is blocked; legacy assignment without durable journal still uses original plain send',async()=>{
 for(const setup of [
  {configure:optsBase=>({...optsBase,capability:'unknown'}),key:'v2'},
  {configure:optsBase=>optsBase,key:'legacy'}
 ]){
  const x=fixture();x.control.interactive_outbound_live_enabled=true;
  if(setup.key==='legacy')x.service.assignment_intent_mode='';
  const j=x.add('assignment_new',{
   ...(setup.key==='legacy'?{idempotency_key:'assignment:service-123:supplier-123:2026-10-25T10:00Z:SUPPLIER_NEW_ASSIGNMENT'}:{})
  });
  const previews=[];
  const result=await drainWhatsAppOutbox(x.client,{
   interactiveConfig:setup.configure(opts()),maxRuntimeMs:10000,
   transport:async (_job,_provider,_client,preview)=>{
    previews.push(preview);return {messageId:'original-plain-accepted'};
   }
  });
  if(setup.key==='legacy'){
   assert.equal(result.accepted,1);
   assert.equal(previews[0],null);
   assert.equal(j.interactive_button_bindings_json,undefined);
  }else{
   assert.equal(result.failed,1,'misconfigured account capability must fail closed rather than silently use beta');
   assert.equal(previews.length,0);
  }
 }
});
test('bad signature/invalid policy quarantines only assignment without delaying invoice',async()=>{
 const x=fixture();x.control.interactive_outbound_live_enabled=true;
 const j=x.add(),invoice=x.add('invoice'),seen=[];
 const broken={...opts(),signingSecret:'short'};
 const result=await drainWhatsAppOutbox(x.client,{maxRuntimeMs:10000,
  interactiveConfig:broken,transport:async job=>{
   seen.push(job.source_type);return {messageId:'invoice-only-123'};
  }
 });
 assert.equal(result.failed,1);
 assert.equal(result.accepted,1);
 assert.deepEqual(seen,['invoice']);
 assert.equal(j.status,'failed');
 assert.match(j.last_error,/before provider dispatch/);
 assert.equal(j.attempt_count,0);
 assert.equal(invoice.status,'accepted');
});
test('definite 429 retains EXACT signed button IDs on authorized later retry',async()=>{
 const x=fixture();x.control.interactive_outbound_live_enabled=true;
 const j=x.add();
 const sent=[];
 let count=0;
 const transport=async(job,provider,client,preview)=>{
  count++;sent.push(preview);
  if(count===1)throw {errorCode:429,deliveryUncertain:false,retryAfterSeconds:0};
  return {messageId:'accepted-after-definite-retry'};
 };
 const first=await drainWhatsAppOutbox(x.client,{
  maxRuntimeMs:10000,interactiveConfig:opts(),transport
 });
 assert.equal(first.retried,1);
 assert.equal(j.status,'retry_wait');
 assert.equal(j.error_code,429);
 const original=j.interactive_button_bindings_json;
 // Simulate the future being due: no timers, no actual provider request.
 j.available_at=new Date(Date.now()-1000).toISOString();
 const second=await drainWhatsAppOutbox(x.client,{
  maxRuntimeMs:10000,interactiveConfig:opts(),transport
 });
 assert.equal(second.accepted,1);
 assert.equal(count,2);
 assert.equal(x.events.snapshotWrites,1);
 assert.equal(j.interactive_button_bindings_json,original);
 assert.deepEqual(sent[0].body.buttons,sent[1].body.buttons);
 assert.equal(j.status,'accepted');
});
test('rollback after a definite 429 quarantines frozen buttons instead of silently resending plain text',async()=>{
 const x=fixture();x.control.interactive_outbound_live_enabled=true;
 const job=x.add();let network=0;
 const first=await drainWhatsAppOutbox(x.client,{
  interactiveConfig:opts(),transport:async()=>{network++;throw {errorCode:429,deliveryUncertain:false};}
 });
 assert.equal(first.retried,1);
 assert.equal(job.status,'retry_wait');
 job.available_at=new Date(Date.now()-1000).toISOString();
 x.control.interactive_outbound_live_enabled=false;
 const invoice=x.add('invoice');
 const subsequent=await drainWhatsAppOutbox(x.client,{
  transport:async current=>{network++;assert.equal(current.source_type,'invoice');
   return {messageId:'invoice-completed'};}
 });
 assert.equal(subsequent.failed,1);
 assert.equal(subsequent.accepted,1);
 assert.equal(network,2,'exactly one first 429 attempt plus one invoice, no fallback resend');
 assert.equal(job.status,'failed');
 assert.match(job.last_error,/Frozen interactive assignment needs manual review/);
 assert.equal(invoice.status,'accepted');
});
test('preparation metadata with no trusted credentials is quarantined before any provider call',async()=>{
 const x=fixture();const job=x.add();
 job.assignment_revision='r4';
 let network=0;
 const r=await drainWhatsAppOutbox(x.client,{transport:async()=>{
  network++;return {messageId:'must-not-send'};
 }});
 assert.equal(r.failed,1);
 assert.equal(network,0);
 assert.equal(job.status,'failed');
});
test('tampered snapshot after definite 429 quarantines, never calls provider again',async()=>{
 const x=fixture();x.control.interactive_outbound_live_enabled=true;
 const j=x.add();
 let sent=0;
 const one=await drainWhatsAppOutbox(x.client,{
  maxRuntimeMs:10000,interactiveConfig:opts(),transport:async()=>{
   sent++;throw {errorCode:429,deliveryUncertain:false};
  }
 });
 assert.equal(one.retried,1);
 const data=JSON.parse(j.interactive_button_bindings_json);
 data.buttons[0].label='לא מאשר';
 j.interactive_button_bindings_json=JSON.stringify(data);
 j.available_at=new Date(Date.now()-1000).toISOString();
 const two=await drainWhatsAppOutbox(x.client,{
  maxRuntimeMs:10000,interactiveConfig:opts(),transport:async()=>{
   sent++;return {messageId:'should-not-send'};
  }
 });
 assert.equal(two.failed,1);
 assert.equal(sent,1);
 assert.equal(j.status,'failed');
 assert.equal(x.events.snapshotWrites,1);
});
