import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {signV2ReminderAckProof,verifyV2ReminderAckProof} from '../base44/shared/whatsappV2ReminderAckProof.ts';
import {
 createV2OpaqueButtonSnapshot
} from '../base44/shared/whatsappV2OpaqueButtonBridge.ts';
import {admitAuthenticatedV2GreenReminder,
 recordVerifiedV2ReminderAcknowledgement,
 isAdmittedGreenV2Reminder}
 from '../base44/shared/whatsappV2ReminderInbound.ts';

const now=Date.parse('2026-10-31T20:00:00Z');
const signing='v2-reminder-callback-staged-signing-0123456789';
const bearer='v2-reminder-provider-auth-bearer-0123456789';
const sender='9903183013';
const name='outbox-reminder-45';
async function scenario(){
 const queued={
  id:name,company_id:'shirat_hanevel',message_kind:'supplier_reminder',
  source_type:'event_reminder',resource_type:'outbox_message',
  resource_id:name,recipient_audience:'supplier',
  recipient_id:'supplier-456',supplier_id:'supplier-456',
  message_type:'text',requested_provider:'green',
  sender_account_id:sender,chat_id:'972501234567@c.us',revision:'r1',
  status:'queued',attempt_count:0,send_started_at:'',provider_message_id:''
 };
 const frozen=await createV2OpaqueButtonSnapshot({
  job:queued,actions:[{action:'reminder_acknowledge',label:'קיבלתי'}],
  signingSecret:signing,now
 });
 const original={...queued,status:'accepted',provider:'green',
  provider_message_id:'3EB0REMINDER_0123456789',
  interactive_v2_button_bindings_json:frozen,
  reminder_acknowledged_at:'',reminder_acknowledgement_event_id:''};
 const buttonId=JSON.parse(frozen).buttons[0].buttonId;
 const raw={
  typeWebhook:'incomingMessageReceived',
  instanceData:{idInstance:Number(sender),typeInstance:'whatsapp'},
  senderData:{chatId:original.chat_id,sender:original.chat_id},
  timestamp:Math.floor(now/1000),idMessage:'3EB0CALLBACK_12345678',
  messageData:{typeMessage:'interactiveButtonsResponse',
   interactiveButtonsResponse:{stanzaId:original.provider_message_id,
    selectedId:buttonId,selectedIndex:0}}
 };
 const stats={filters:0,reads:0,writes:0,providerCalls:0,queried:[]};
 let failMode='';
 const matches=(row,q)=>Object.entries(q).every(([k,v])=>
  (row[k]??null)===(v??null));
 const outbox={
  filter:async(query,_order,limit,_offset,projection)=>{
   stats.filters++;stats.queried.push(query);
   assert.equal(limit,2);
   assert.ok(Array.isArray(projection));
   assert.equal(projection.includes('message_text'),false);
   return matches(original,query)?[{...original}]:[];
  },
  get:async(id)=>{
   stats.reads++;return id===original.id?{...original}:null;
  },
  updateMany:async(query,update)=>{
   stats.writes++;
   if(!matches(original,query))return {updated:0};
   if(failMode==='before')throw Error('DB timeout without commit');
   Object.assign(original,update.$set);
   if(failMode==='after')throw Error('DB timeout after commit');
   return {updated:1};
  }
 };
 const client={asServiceRole:{entities:{WhatsAppOutbox:outbox}}};
 const input={
  client,headers:{Authorization:'Bearer '+bearer},
  rawCallback:raw,callbackByteLength:600,expectedInstanceId:sender,
  webhookSecret:bearer,signingSecret:signing,
  rolloutAuthorized:true,providerCapabilityVerified:true,now
 };
 return {client,input,raw,original,stats,
  setFailMode:mode=>{failMode=mode}};
}
test('authenticated Green V2 reminder click passes strict server-side origin and provider verification',async()=>{
 const f=await scenario();
 const result=await admitAuthenticatedV2GreenReminder(f.input);
 assert.equal(result.status,'admitted');
 assert.equal(result.reason,'signed_original_proven');
 assert.equal(result.outboxReads,1);
 assert.equal(f.stats.filters,1);
 assert.equal(f.stats.writes,0);
 assert.equal(isAdmittedGreenV2Reminder(result.admission),true);
 assert.equal(result.admission.action,'reminder_acknowledge');
 assert.equal(JSON.stringify(result).includes(signing),false);
 assert.equal(JSON.stringify(result).includes(bearer),false);
 assert.equal(f.stats.queried[0].provider_message_id,f.original.provider_message_id);
});
test('auth, instance, group, unsupported buttons and rollout OFF refuse before any DB operation',async()=>{
 const f=await scenario();
 for(const patch of [
  {headers:{Authorization:'Bearer WRONG'}},
  {rolloutAuthorized:false}, {providerCapabilityVerified:false},
  {callbackByteLength:50000},
  {expectedInstanceId:'9903183014'},
  {rawCallback:{...f.raw,
   messageData:{typeMessage:'textMessage',textMessage:{textMessage:'yes'}}}},
  {rawCallback:{...f.raw,senderData:{
   chatId:'972501234567@g.us',sender:'972501234567@g.us'}}},
  {rawCallback:{...f.raw,messageData:{
   typeMessage:'interactiveButtonsResponse',
   interactiveButtonsResponse:{stanzaId:f.original.provider_message_id,
    selectedId:'wa1_0000000000000000000000'}}}}
 ]){
  const rejected=await admitAuthenticatedV2GreenReminder({...f.input,...patch});
  assert.equal(rejected.status,'refused',JSON.stringify(patch));
 }
 assert.equal(f.stats.filters,0);
 assert.equal(f.stats.writes,0);
});
test('V2 callback rejects nonmatching Outbox provider, sender, foreign chat or ambiguous original',async()=>{
 const f=await scenario();
 const original=f.client.asServiceRole.entities.WhatsAppOutbox.filter;
 f.client.asServiceRole.entities.WhatsAppOutbox.filter=async(query,...rest)=>{
  const base=await original(query,...rest);
  return base.length?[base[0],base[0]]:[];
 };
 assert.equal((await admitAuthenticatedV2GreenReminder(f.input)).reason,'ambiguous_origin');
 assert.equal(f.stats.writes,0);
});
test('verified reminder acknowledgement writes exactly one durable CAS, duplicate and conflicting presses are inert',async()=>{
 const f=await scenario();
 const admitted=await admitAuthenticatedV2GreenReminder(f.input);
 const first=await recordVerifiedV2ReminderAcknowledgement({
  client:f.client,admission:admitted.admission,signingSecret:signing,now
 });
 assert.deepEqual(first,{status:'recorded',reason:'durable_ack_recorded',writesAuthorized:1});
 assert.equal(f.original.reminder_acknowledgement_event_id,f.raw.idMessage);
 assert.equal(f.original.reminder_acknowledged_at,new Date(now).toISOString());
 assert.equal(await verifyV2ReminderAckProof(f.original,signing),true);
 assert.equal(f.stats.writes,1);
 const replay=await recordVerifiedV2ReminderAcknowledgement({
  client:f.client,admission:admitted.admission,signingSecret:signing,now:now+1000
 });
 assert.equal(replay.status,'already_recorded');
 assert.equal(f.stats.writes,1);
 const other=await scenario();
 const otherAdmitted=await admitAuthenticatedV2GreenReminder(other.input);
 f.original.reminder_acknowledgement_event_id='3EB0_DIFFERENT_PRESS';
 f.original.reminder_acknowledgement_proof=await signV2ReminderAckProof(f.original,signing);
 const conflict=await recordVerifiedV2ReminderAcknowledgement({
  client:f.client,admission:admitted.admission,signingSecret:signing,now
 });
 assert.equal(conflict.status,'already_acknowledged');
 assert.equal(f.stats.writes,1);
 assert.equal(otherAdmitted.status,'admitted');
});
test('unverified or forged admission cannot write by invoking recorder directly',async()=>{
 const f=await scenario();
 const attempts=[
  null,{}, {action:'reminder_acknowledge'},f.raw,
  {outboxId:name,providerEventId:f.raw.idMessage,action:'reminder_acknowledge'}
 ];
 for(const admission of attempts){
  const denied=await recordVerifiedV2ReminderAcknowledgement({
   client:f.client,admission,signingSecret:signing,now
  });
  assert.equal(denied.status,'refused');
 }
 assert.equal(f.stats.reads,0);
 assert.equal(f.stats.writes,0);
});
test('ambiguous DB response after commit detects durable result without retrying provider or CAS',async()=>{
 const f=await scenario();
 const admitted=await admitAuthenticatedV2GreenReminder(f.input);
 f.setFailMode('after');
 const applied=await recordVerifiedV2ReminderAcknowledgement({
  client:f.client,admission:admitted.admission,signingSecret:signing,now
 });
 assert.equal(applied.status,'already_recorded');
 assert.equal(applied.reason,'durable_ack_verified');
 assert.equal(f.stats.writes,1);
 assert.equal(f.stats.reads,2);
});
test('ambiguous before commit requires manual review without additional writes',async()=>{
 const f=await scenario();
 const admitted=await admitAuthenticatedV2GreenReminder(f.input);
 f.setFailMode('before');
 const result=await recordVerifiedV2ReminderAcknowledgement({
  client:f.client,admission:admitted.admission,signingSecret:signing,now
 });
 assert.equal(result.status,'needs_review');
 assert.equal(result.reason,'ack_commit_uncertain');
 assert.equal(f.stats.writes,1);
 assert.equal(f.original.reminder_acknowledgement_event_id,'');
});
test('staged V2 reminders cannot change live assignment engine, callback URL or notification recipients',()=>{
 const module=fs.readFileSync('base44/shared/whatsappV2ReminderInbound.ts','utf8');
 assert.doesNotMatch(module,/Deno\.serve|fetch\(|setInterval\(|sendWhatsAppTransport|EventService\.update|\.delete\(/);
 assert.match(module,/provider_message_id:a\.providerMessageId/);
 assert.match(module,/reminder_acknowledged_at:job\.reminder_acknowledged_at\?\?null/);
 const v1=fs.readFileSync('base44/shared/greenButtonQaWebhookHandler.ts','utf8');
 assert.match(v1,/if\(v2Callback\)/);
 assert.match(v1,/interactive_reminder_v2_inbound_ever_enabled!==true/);
 assert.match(v1,/recordVerifiedV2ReminderAcknowledgement/);
 assert.match(v1,/enqueueVerifiedV2ReminderAckFeedback/);
 assert.match(v1,/if\(feedback\.queued\)return result\(200,true\)/);
 assert.doesNotMatch(v1,/Deno\.serve|sendWhatsAppTransport/);
 const worker=fs.readFileSync('base44/shared/whatsappQueueWorker.ts','utf8');
 assert.doesNotMatch(worker,/whatsappV2ReminderInbound|reminder_acknowledge/);
});
