import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createV2OpaqueButtonSnapshot}
 from '../base44/shared/whatsappV2OpaqueButtonBridge.ts';
import {handleGreenButtonQaWebhook}
 from '../base44/shared/greenButtonQaWebhookHandler.ts';
import {greenProductionPassiveInboundReady}
 from '../base44/shared/greenButtonQaLaunch.ts';

const reference=fs.readFileSync(
 'tests/whatsapp-production-inbound-independent-qa.test.mjs','utf8');
const envValue=key=>{
 const found=reference.match(new RegExp('\\b'+key+":'([^']+)'",'m'));
 assert.ok(found,'reference fixture must define '+key);
 return found[1];
};
const instance='9903183013';
const bearer='staged-reminder-gate-auth-bearer-0123456789';
const signing='staged-reminder-gate-action-signature-0123456789';
const now=Date.parse('2026-10-31T19:30:00Z');
const envData={
 GREEN_BUTTONS_QA_OWNER_APPROVED:envValue('GREEN_BUTTONS_QA_OWNER_APPROVED'),
 GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:envValue('GREEN_BUTTONS_QA_ACCOUNT_VERIFIED'),
 GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',
 GREEN_API_INSTANCE_ID:instance,
 GREEN_API_TOKEN:'offline-not-real-green-key-long-abcdef01234567',
 GREEN_API_WEBHOOK_TOKEN:bearer,
 WHATSAPP_INTERACTIVE_SIGNING_SECRET:signing
};
const env=key=>envData[key]||'';
const oldDeno=globalThis.Deno;
globalThis.Deno={env:{get:env}};
test.after(()=>{if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;});
async function fixture(inbound=false){
 assert.equal(greenProductionPassiveInboundReady(env),true);
 const jobId='reminder-orig-789';
 const queued={
  id:jobId,company_id:'shirat_hanevel',
  message_kind:'supplier_reminder',source_type:'event_reminder',
  resource_type:'outbox_message',resource_id:jobId,
  recipient_audience:'supplier',recipient_id:'supplier-456',
  supplier_id:'supplier-456',message_type:'text',
  chat_id:'972501234567@c.us',sender_account_id:instance,
  requested_provider:'green',revision:'r1',
  status:'queued',attempt_count:0,send_started_at:'',provider_message_id:''
 };
 const snapshot=await createV2OpaqueButtonSnapshot({
  job:queued,actions:[{action:'reminder_acknowledge',label:'קיבלתי'}],
  signingSecret:signing,now
 });
 const source={...queued,status:'accepted',provider:'green',
  provider_message_id:'3EB0REMINDER_56781234',
  interactive_v2_button_bindings_json:snapshot,
  reminder_acknowledged_at:'',reminder_acknowledgement_event_id:''};
 const control={
  id:'global-queue',control_key:'global',enabled:true,paused:false,
  interactive_reminder_v2_outbound_enabled:false,
  interactive_reminder_v2_inbound_ever_enabled:inbound,
  enqueue_owner:'',enqueue_until:''
 };
 const rows=[source],stats={queries:0,controlReads:0,writes:0,creates:0,stage:0,provider:0};
 const matches=(row,q)=>Object.entries(q).every(([key,val])=>
  (row[key]??null)===(val??null));
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{
   filter:async()=>{stats.controlReads++;return [control]},
   updateMany:async(query,{$set})=>{
    if(!matches(control,query))return {updated:0};
    Object.assign(control,$set);return {updated:1};
   }
  },
  WhatsAppOutbox:{
   filter:async(query)=>{stats.queries++;return rows.filter(row=>matches(row,query));},
   get:async id=>rows.find(r=>r.id===id)?{
    ...rows.find(r=>r.id===id)
   }:null,
   updateMany:async(query,{$set})=>{
    const matched=rows.filter(r=>matches(r,query));
    for(const row of matched)Object.assign(row,$set);
    stats.writes+=matched.length;return {updated:matched.length};
   },
   create:async fields=>{
    const row={id:'feedback-'+(++stats.creates),...fields};
    rows.push(row);return row;
   }
  },
  AppSettings:{filter:async()=>{throw Error('V2 path must not query V1 settings');}}
 }}};
 const buttonId=JSON.parse(snapshot).buttons[0].buttonId;
 const raw={
  typeWebhook:'incomingMessageReceived',idMessage:'3EB0BUTTON_PRESS_1234',
  timestamp:Math.floor(now/1000),
  instanceData:{idInstance:Number(instance),typeInstance:'whatsapp'},
  senderData:{chatId:source.chat_id,sender:source.chat_id},
  messageData:{typeMessage:'interactiveButtonsResponse',
   interactiveButtonsResponse:{stanzaId:source.provider_message_id,
    selectedId:buttonId,selectedIndex:0}}
 };
 const invoke=async(requestBody=raw)=>handleGreenButtonQaWebhook(
  new Request('https://mock.test/green-v2',{method:'POST',
   headers:{Authorization:'Bearer '+bearer,'content-type':'application/json'},
   body:JSON.stringify(requestBody)}),
  {env,makeClient:()=>client,now,
   recalculateEventStatus:async()=>{throw Error('V2 must not change event');},
   stage:async()=>{stats.stage++;throw Error('V1 must not receive V2 short IDs');}}
 );
 return {source,control,rows,stats,raw,invoke};
}
test('V2 off-by-default flag never ACKs or mutates while V1 webhook remains untouched',async()=>{
 const f=await fixture(false);
 const res=await f.invoke();
 assert.equal(res.httpStatus,503);
 assert.equal(res.body.received,false);
 assert.equal(f.stats.controlReads,1);
 assert.equal(f.stats.queries,0);
 assert.equal(f.stats.writes,0);
 assert.equal(f.stats.creates,0);
 assert.equal(f.stats.stage,0);
});
test('historically permitted signed V2 reminder click records once and enqueues exactly one feedback in existing queue',async()=>{
 const f=await fixture(true);
 const first=await f.invoke();
 assert.equal(first.httpStatus,200);
 assert.equal(first.body.received,true);
 assert.equal(first.noProviderCalls,true);
 assert.equal(f.source.reminder_acknowledgement_event_id,f.raw.idMessage);
 assert.match(f.source.reminder_acknowledgement_proof,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(f.stats.creates,1);
 assert.equal(f.rows[1].source_type,'reminder_button_feedback');
 assert.equal(f.rows[1].sender_account_id,instance);
 assert.equal(f.rows[1].requested_provider,'green');
 assert.equal(f.stats.stage,0);
 const again=await f.invoke();
 assert.equal(again.httpStatus,200);
 assert.equal(again.body.received,true);
 assert.equal(f.stats.creates,1,'webhook retry cannot create duplicate notification');
 assert.equal(f.source.reminder_acknowledgement_event_id,f.raw.idMessage);
 assert.equal(f.stats.stage,0,'V1 business decisions must not be involved');
});
test('invalid short V2 ID on authenticated incoming event never commits or sends a response',async()=>{
 const f=await fixture(true);
 const raw={...f.raw,messageData:{...f.raw.messageData,
  interactiveButtonsResponse:{
   ...f.raw.messageData.interactiveButtonsResponse,
   selectedId:'wa2_AAAAAAAAAAAAAAAAAAAAAA'
  }}};
 const res=await f.invoke(raw);
 assert.equal(res.httpStatus,422);
 assert.equal(f.stats.creates,0);
 assert.equal(f.stats.writes,0);
 assert.equal(f.stats.stage,0);
});
