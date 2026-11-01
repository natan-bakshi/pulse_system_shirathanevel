import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {
 prepareEventUpdateAcknowledgement,verifyEventUpdateAckTransport,
 admitEventUpdateAcknowledgement,recordEventUpdateAcknowledgement
} from '../base44/shared/supplierEventUpdateAcknowledgement.ts';
import {eventInformationNoticeKey} from '../base44/shared/supplierEventChange.ts';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const now=Date.parse('2026-11-01T12:00:00.000Z');
const SIGN='synthetic-event-ack-signing-secret-12345678909876';
const BEARER='synthetic-event-ack-webhook-token-12345678909876';
const ACCOUNT='9903183013';
const SUPPLIER='supplier-ack-test-123';
const SERVICE='service-ack-test-123';
const EVENT='event-ack-test-123';
const control={enabled:true,paused:false,
 interactive_outbound_live_enabled:true,
 interactive_assignment_production_enabled:true};
const config={enabled:true,legacyProductionApproved:true,
 accountCapabilityVerified:true,capability:'mixed_url',
 senderAccountId:ACCOUNT,signingSecret:SIGN};
const matches=(row,filter)=>Object.entries(filter).every(([k,v])=>
 (row[k]??null)===(v??null));
async function fixture(){
 const key=await eventInformationNoticeKey({
  eventId:EVENT,serviceId:SERVICE,supplierId:SUPPLIER,
  templateId:'template-ack-123',
  changeFingerprint:'[["location","A","B"]]'
 });
 const job={
  id:'outbox-ack-test-123',
  source_type:'event_update',source_id:EVENT,
  event_service_id:SERVICE,supplier_id:SUPPLIER,
  notification_template_id:'template-ack-123',idempotency_key:key,
  message_type:'text',message_text:'עודכנו פרטי האירוע.',
  requested_provider:'green',chat_id:'972501234567@c.us',
  status:'queued',attempt_count:0,send_started_at:'',
  provider_message_id:'',sender_account_id:''
 };
 const stats={outboxUpdates:0,serviceUpdates:0};
 const service={id:SERVICE,event_id:EVENT,is_external:false,
  supplier_ids:JSON.stringify([SUPPLIER]),
  supplier_statuses:JSON.stringify({[SUPPLIER]:'confirmed'})};
 const outbox={
  get:async()=>structuredClone(job),
  updateMany:async(filter,patch)=>{
   stats.outboxUpdates++;
   if(!matches(job,filter))return {updated:0};
   Object.assign(job,patch.$set);
   return {updated:1};
  },
  filter:async(filter)=>{
   if(matches(job,filter))return [structuredClone(job)];
   return [];
  }
 };
 const db={
  WhatsAppOutbox:outbox,
  EventService:{get:async()=>structuredClone(service),
   updateMany:async()=>{stats.serviceUpdates++;throw Error('Must never change supplier status');}}
 };
 return {job,service,stats,client:{asServiceRole:{entities:db}},db};
}
function buttonCallback(job,buttonId){
 return {
  typeWebhook:'incomingMessageReceived',
  instanceData:{idInstance:Number(ACCOUNT),typeInstance:'whatsapp'},
  senderData:{chatId:job.chat_id,sender:job.chat_id},
  timestamp:Math.floor(now/1000),idMessage:'3EB0CALLBACK_123456789',
  messageData:{typeMessage:'interactiveButtonsResponse',
   interactiveButtonsResponse:{
    stanzaId:job.provider_message_id,
    selectedId:buttonId,selectedIndex:0
   }}
 };
}
test('one signed receipt-only button is frozen before any Green provider call',async()=>{
 const f=await fixture();
 const prepared=await prepareEventUpdateAcknowledgement({
  client:f.client,job:f.job,provider:'green',control,config,now
 });
 assert.equal(prepared.kind,'event_update_ack');
 assert.equal(prepared.preview.method,'sendInteractiveButtons');
 assert.equal(prepared.preview.body.buttons.length,1);
 assert.equal(prepared.preview.body.buttons[0].buttonText,'קיבלתי');
 assert.equal(f.job.message_kind,'supplier_event_update');
 assert.equal(f.job.revision,'r1');
 assert.ok(f.job.interactive_v2_button_bindings_json);
 assert.equal(f.stats.serviceUpdates,0);
 assert.equal(f.stats.outboxUpdates,1);
 const sending={...f.job,status:'sending',provider:'green'};
 assert.equal(await verifyEventUpdateAckTransport({
  job:sending,provider:'green',preview:prepared.preview,secret:SIGN,now
 }),true);
 assert.equal(await verifyEventUpdateAckTransport({
  job:sending,provider:'green',preview:{
   ...prepared.preview,body:{...prepared.preview.body,
    buttons:[{...prepared.preview.body.buttons[0],buttonId:'forged'}]}
  },secret:SIGN,now
 }),false);
 assert.equal(await verifyEventUpdateAckTransport({
  job:sending,provider:'wasender',preview:prepared.preview,secret:SIGN,now
 }),false);
});
test('authenticated Green receipt is recorded exactly once, never changes assignments',async()=>{
 const f=await fixture();
 const prepared=await prepareEventUpdateAcknowledgement({
  client:f.client,job:f.job,provider:'green',control,config,now
 });
 Object.assign(f.job,{status:'accepted',provider:'green',
  provider_message_id:'3EB0ORIGINAL_123456789'});
 const raw=buttonCallback(f.job,prepared.preview.body.buttons[0].buttonId);
 const admission=await admitEventUpdateAcknowledgement({
  client:f.client,headers:{Authorization:'Bearer '+BEARER},
  rawCallback:raw,callbackByteLength:600,
  expectedInstanceId:ACCOUNT,webhookSecret:BEARER,signingSecret:SIGN,now
 });
 assert.equal(admission.status,'admitted',admission.reason);
 const result=await recordEventUpdateAcknowledgement({
  client:f.client,admission:admission.data,signingSecret:SIGN,now
 });
 assert.equal(result,'recorded');
 const originalStatus=f.service.supplier_statuses;
 assert.equal(f.service.supplier_statuses,originalStatus);
 assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER],'confirmed');
 assert.equal(f.stats.serviceUpdates,0);
 assert.ok(f.job.event_update_acknowledged_at);
 const repeat=await recordEventUpdateAcknowledgement({
  client:f.client,admission:admission.data,signingSecret:SIGN,now:now+5000
 });
 assert.equal(repeat,'already_recorded');
 assert.equal(f.stats.outboxUpdates,2,'one metadata freeze and one ACK write');
 const wrongChat=await admitEventUpdateAcknowledgement({
  client:f.client,headers:{Authorization:'Bearer '+BEARER},
  rawCallback:{...raw,senderData:{chatId:'972501999999@c.us',
   sender:'972501999999@c.us'}},
  callbackByteLength:600,expectedInstanceId:ACCOUNT,
  webhookSecret:BEARER,signingSecret:SIGN,now
 });
 assert.equal(wrongChat.status,'refused');
 const wrongBearer=await admitEventUpdateAcknowledgement({
  client:f.client,headers:{Authorization:'Bearer wrong'},
  rawCallback:raw,callbackByteLength:600,
  expectedInstanceId:ACCOUNT,webhookSecret:BEARER,signingSecret:SIGN,now
 });
 assert.equal(wrongBearer.status,'refused');
});
test('a fabricated receipt capability cannot update the Outbox',async()=>{
 const f=await fixture();
 const status=await recordEventUpdateAcknowledgement({
  client:f.client,signingSecret:SIGN,admission:{
   outboxId:f.job.id,providerEventId:'forged_event_12345',
   senderAccountId:ACCOUNT,chatId:f.job.chat_id,
   providerMessageId:'3EB0FORGED12345',
   supplierId:SUPPLIER,revision:'r1'
  },now
 });
 assert.equal(status,'refused');
 assert.equal(f.stats.outboxUpdates,0);
});
test('known 429 retry reuses the exact immutable signed button',async()=>{
 const f=await fixture();
 const prepared=await prepareEventUpdateAcknowledgement({
  client:f.client,job:f.job,provider:'green',control,config,now
 });
 const frozen=f.job.interactive_v2_button_bindings_json;
 Object.assign(f.job,{status:'retry_wait',provider:'green',error_code:429,
  attempt_count:1,send_started_at:new Date(now).toISOString()});
 const retry=await prepareEventUpdateAcknowledgement({
  client:f.client,job:f.job,provider:'green',control,config,now:now+1000
 });
 assert.equal(retry.kind,'event_update_ack');
 assert.equal(f.job.interactive_v2_button_bindings_json,frozen);
 assert.deepEqual(retry.preview.body.buttons,prepared.preview.body.buttons);
 assert.equal(f.stats.outboxUpdates,1);
});
test('wrong source, invalid rollout or removed assignment refuses before signing',async()=>{
 const f=await fixture();
 await assert.rejects(()=>prepareEventUpdateAcknowledgement({
  client:f.client,job:{...f.job,source_type:'assignment_new'},
  provider:'green',control,config,now
 }),/buttons_not_authorized/);
 await assert.rejects(()=>prepareEventUpdateAcknowledgement({
  client:f.client,job:f.job,provider:'green',control:{
   ...control,interactive_assignment_production_enabled:false
  },config,now
 }),/buttons_not_authorized/);
 f.db.EventService.get=async()=>({
  ...f.service,supplier_ids:'[]'
 });
 await assert.rejects(()=>prepareEventUpdateAcknowledgement({
  client:f.client,job:f.job,provider:'green',control,config,now
 }),/supplier_no_longer_assigned/);
 assert.equal(f.stats.outboxUpdates,0);
});
