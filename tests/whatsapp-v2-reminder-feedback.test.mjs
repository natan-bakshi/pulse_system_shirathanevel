import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {signV2ReminderAckProof,verifyV2ReminderAckProof}
 from '../base44/shared/whatsappV2ReminderAckProof.ts';
import {enqueueVerifiedV2ReminderAckFeedback}
 from '../base44/shared/whatsappV2ReminderFeedback.ts';
import {sendWhatsAppTransport}
 from '../base44/shared/whatsappSend.ts';
import {enqueueWhatsApp} from '../base44/shared/whatsappOutbox.ts';
import {V2_REMINDER_ACK_FEEDBACK_TEXT} from '../base44/shared/whatsappV2ReminderAckProof.ts';

const secret='v2-reminder-ack-feedback-signing-abcdefg-012345';
const acct='9903183013';
const oldDeno=globalThis.Deno;
globalThis.Deno={env:{get:key=>({
 GREEN_API_INSTANCE_ID:acct,WHATSAPP_INTERACTIVE_SIGNING_SECRET:secret,
 GREEN_API_TOKEN:'offline-test-token-not-real'
})[key]||''}};
test.after(()=>{if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;});
const ack=()=>({
 id:'job-reminder-456',company_id:'shirat_hanevel',
 source_type:'event_reminder',message_kind:'supplier_reminder',
 resource_type:'outbox_message',resource_id:'job-reminder-456',
 recipient_audience:'supplier',supplier_id:'supplier-456',
 recipient_id:'supplier-456',status:'accepted',
 provider:'green',requested_provider:'green',
 sender_account_id:acct,chat_id:'972501234567@c.us',
 provider_message_id:'3EB0REMINDER_ORIGINAL_123',
 revision:'r1',
 reminder_acknowledged_at:'2026-10-31T20:00:00.000Z',
 reminder_acknowledgement_event_id:'3EB0CLICK_12345678'
});
async function setup(){
 const source=ack();
 source.reminder_acknowledgement_proof=await signV2ReminderAckProof(source,secret);
 const control={
  id:'ctl-1',control_key:'global',enabled:true,paused:false,
  enqueue_owner:'',enqueue_until:'',interactive_outbound_live_enabled:true
 };
 const rows=[source],stats={reads:0,creates:0,providerConfigReads:0};
 const matches=(row,q)=>Object.entries(q).every(([k,v])=>
  (row[k]??null)===(v??null));
 const client={asServiceRole:{entities:{
  WhatsAppOutbox:{
   get:async id=>{stats.reads++;return rows.find(r=>r.id===id)||null;},
   filter:async q=>rows.filter(r=>matches(r,q)),
   create:async row=>{
    stats.creates++;const created={...row,id:'feedback-'+stats.creates};
    rows.push(created);return created;
   }
  },
  WhatsAppQueueControl:{
   filter:async()=>[control],
   updateMany:async(q,{$set})=>{
    if(!matches(control,q))return {updated:0};
    Object.assign(control,$set);return {updated:1};
   }
  },
  AppSettings:{filter:async()=>{stats.providerConfigReads++;throw Error('Should not read provider for pinned feedback');}}
 }}};
 const send=()=>enqueueVerifiedV2ReminderAckFeedback({
  client,sourceOutboxId:source.id,signingSecret:secret,
  activeGreenInstanceId:acct
 });
 return {send,source,control,rows,stats,client};
}
test('durable HMAC ACK proof must match all trusted identifying fields',async()=>{
 const source=ack();
 source.reminder_acknowledgement_proof=await signV2ReminderAckProof(source,secret);
 assert.equal(await verifyV2ReminderAckProof(source,secret),true);
 for(const patch of [
  {recipient_id:'different-supplier'}, {chat_id:'972509999999@c.us'},
  {sender_account_id:'9903183014'}, {provider_message_id:'3EB0OTHER'},
  {reminder_acknowledged_at:'2026-10-31T19:59:59.000Z'},
  {reminder_acknowledgement_event_id:'3EB0OTHERCLICK'},
  {source_type:'manual_trigger'}, {status:'unknown'}
 ]){
  assert.equal(await verifyV2ReminderAckProof({...source,...patch},secret),false);
 }
 assert.equal(await verifyV2ReminderAckProof(source,
  'fake-reminder-ack-feedback-signing-abcdefg-00000'),false);
});
test('verified ACK enqueues one ordinary central queue feedback message, pinned to original Green account',async()=>{
 const f=await setup();
 const reply=await f.send();
 assert.equal(reply.queued,true);
 assert.equal(reply.reason,'feedback_durably_queued');
 assert.equal(f.stats.creates,1);
 assert.equal(f.stats.providerConfigReads,0);
 const message=f.rows[1];
 assert.equal(message.chat_id,f.source.chat_id);
 assert.equal(message.source_type,'reminder_button_feedback');
 assert.equal(message.source_id,f.source.id);
 assert.equal(message.supplier_id,f.source.supplier_id);
 assert.equal(message.sender_account_id,acct);
 assert.equal(message.requested_provider,'green');
 assert.equal(message.status,'queued');
 assert.match(message.message_text,/קבלת התזכורת נרשם בהצלחה/);
 assert.equal(message.idempotency_key,'reminder-ack-feedback:'+f.source.id);
 assert.equal(f.control.enqueue_owner,'');
});
test('redelivery of an authenticated callback cannot enqueue second feedback',async()=>{
 const f=await setup();
 const first=await f.send();
 const replay=await f.send();
 assert.equal(first.queued,true);
 assert.equal(replay.queued,true);
 assert.equal(first.outboxId,replay.outboxId);
 assert.equal(f.stats.creates,1);
});
test('forged signed ACK, different sender account, paused queue and source mismatch create no feedback',async()=>{
 const f=await setup();
 f.source.reminder_acknowledgement_event_id='3EB0FORGED';
 assert.equal((await f.send()).reason,'ack_proof_invalid');
 assert.equal(f.stats.creates,0);
 const g=await setup();
 const mismatch=await enqueueVerifiedV2ReminderAckFeedback({
  client:g.client,sourceOutboxId:g.source.id,signingSecret:secret,
  activeGreenInstanceId:'9903183014'
 });
 assert.equal(mismatch.reason,'origin_untrusted_or_sender_changed');
 assert.equal(g.stats.creates,0);
 g.control.paused=true;
 assert.equal((await g.send()).reason,'central_queue_unavailable');
 assert.equal(g.stats.creates,0);
});
test('transport refuses feedback from a changed instance BEFORE provider request',async()=>{
 const f=await setup();
 await f.send();
 const job=f.rows[1];
 const prev=globalThis.Deno;
 globalThis.Deno={env:{get:key=>key==='GREEN_API_INSTANCE_ID'?'9903183014':
  key==='GREEN_API_TOKEN'?'fake-token':''}};
 try{
  await assert.rejects(()=>sendWhatsAppTransport(job,'green',f.client),
   /Original Green sender account unavailable/);
 }finally{
  if(prev===undefined)delete globalThis.Deno;
  else globalThis.Deno=prev;
 }
});
test('forged internal feedback context cannot pin Green or enqueue without original signed ACK proof',async()=>{
 const f=await setup();
 const prepare=(evidence,message=V2_REMINDER_ACK_FEEDBACK_TEXT)=>enqueueWhatsApp(f.client,{
  chatId:f.source.chat_id,messageType:'text',messageText:message,
  context:{
   sourceType:'reminder_button_feedback',sourceId:f.source.id,
   idempotencyKey:'reminder-ack-feedback:'+f.source.id,
   supplierId:f.source.supplier_id,feedbackSenderAccountId:acct,
   reminderAckEvidence:evidence
  }
 },f.control);
 for(const [proof,text] of [
  [null,V2_REMINDER_ACK_FEEDBACK_TEXT],
  [{...f.source,reminder_acknowledgement_event_id:'OTHER_EVENT'},V2_REMINDER_ACK_FEEDBACK_TEXT],
  [f.source,'תוכן זדוני במקום הודעת האישור הקבועה']
 ]){
  await assert.rejects(()=>prepare(proof,text),/Unverified supplier reminder feedback origin/);
 }
 assert.equal(f.stats.creates,0);
});
test('feedback uses existing queue only: no new cron, provider HTTP call or business transition',()=>{
 const src=fs.readFileSync('base44/shared/whatsappV2ReminderFeedback.ts','utf8');
 assert.doesNotMatch(src,/fetch\(|Deno\.serve|EventService\.update|Supplier\.update|setInterval\(/);
 assert.match(src,/enqueueWhatsApp\(/);
 assert.match(src,/verifyV2ReminderAckProof/);
 assert.match(src,/reminder_button_feedback/);
});
