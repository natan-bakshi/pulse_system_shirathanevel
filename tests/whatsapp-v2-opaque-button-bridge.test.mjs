import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 createV2OpaqueButtonSnapshot,verifyV2OpaqueButtonSnapshot,
 resolveAuthenticatedV2GreenButton
} from '../base44/shared/whatsappV2OpaqueButtonBridge.ts';
import {STAGED_V2_WHATSAPP_ACTIONS}
 from '../base44/shared/whatsappV2StagedActionRegistry.ts';
import {getInteractiveActionContract,allowedInboundActionIds}
 from '../base44/shared/whatsappInteractiveActionRegistry.ts';
import {verifySignedWhatsAppActionV2}
 from '../base44/shared/whatsappSignedActionV2.ts';

const secret='test-secret-for-opaque-green-buttons-2026-aadd-2332';
const now=Date.parse('2026-10-31T19:00:00Z');
const src=()=>({
 id:'outbox-reminder-23',company_id:'shirat_hanevel',
 message_kind:'supplier_reminder',source_type:'event_reminder',
 resource_type:'outbox_message',resource_id:'outbox-reminder-23',
 recipient_audience:'supplier',recipient_id:'supplier-456',
 supplier_id:'supplier-456',message_type:'text',
 requested_provider:'green',sender_account_id:'9903183013',
 chat_id:'972501234567@c.us',revision:'r1',
 status:'queued',attempt_count:0,send_started_at:'',provider_message_id:''
});
const selection=()=>[{action:'reminder_acknowledge',label:'קיבלתי'}];
const accepted=(job)=>({
 ...job,status:'accepted',provider:'green',
 provider_message_id:'3EB0REMINDER_9922',
 interactive_v2_button_bindings_json:job.interactive_v2_button_bindings_json
});
const click=(job,id)=>({
 provider:'green',senderAccountId:job.sender_account_id,
 senderChatId:job.chat_id,providerEventId:'3EB0CALLBACK_5544',
 originalProviderMessageId:job.provider_message_id,
 buttonId:id,providerTimestampSeconds:Math.round(now/1000)
});
async function prepared(){
 const job=src();
 const frozen=await createV2OpaqueButtonSnapshot({job,actions:selection(),
  signingSecret:secret,now});
 const queued={...job,interactive_v2_button_bindings_json:frozen};
 return {frozen,queued,live:accepted(queued)};
}
test('staged reminder action is separate from live v1 assignment registry and cannot update supplier status',()=>{
 assert.deepEqual(STAGED_V2_WHATSAPP_ACTIONS.messageKinds.map(x=>x.messageKind),
  ['assignment','supplier_reminder']);
 assert.equal(getInteractiveActionContract('supplier_reminder',
  'reminder_acknowledge',STAGED_V2_WHATSAPP_ACTIONS)?.handler,'notification_ack');
 assert.deepEqual(allowedInboundActionIds('supplier_reminder',STAGED_V2_WHATSAPP_ACTIONS),[]);
 assert.deepEqual(allowedInboundActionIds('assignment'),
  ['assignment_approve','assignment_reject']);
});
test('short opaque ID is 26 chars, while HMAC token stays in frozen Outbox snapshot',async()=>{
 const {frozen,queued}=await prepared();
 const b=JSON.parse(frozen).buttons[0];
 assert.match(b.buttonId,/^wa2_[A-Za-z0-9_-]{22}$/);
 assert.equal(b.buttonId.length,26);
 assert.ok(b.actionToken.length>250,'full V2 token must never be the provider ID');
 assert.notEqual(b.buttonId,b.actionToken);
 assert.match(frozen,/"snapshotMac":"[A-Za-z0-9_-]{43}"/);
 assert.equal((await verifyV2OpaqueButtonSnapshot({
  job:queued,raw:frozen,signingSecret:secret,now
 }))?.buttons[0].action,'reminder_acknowledge');
 const verified=await verifySignedWhatsAppActionV2({
  token:b.actionToken,secret,now,registry:STAGED_V2_WHATSAPP_ACTIONS
 });
 assert.equal(verified.outboxJobId,queued.id);
 assert.equal(verified.recipientId,queued.supplier_id);
 assert.equal(verified.messageKind,'supplier_reminder');
 const r2=await createV2OpaqueButtonSnapshot({
  job:src(),actions:selection(),signingSecret:secret,now
 });
 assert.notEqual(JSON.parse(r2).buttons[0].buttonId,b.buttonId,
  'each message gets random short IDs, not a predictable action name');
});
test('signed original accepted Green message and callback admit one reminder action only',async()=>{
 const {live}=await prepared();
 const id=JSON.parse(live.interactive_v2_button_bindings_json).buttons[0].buttonId;
 const result=await resolveAuthenticatedV2GreenButton({
  job:live,click:click(live,id),signingSecret:secret,now
 });
 assert.deepEqual(result,{
  action:'reminder_acknowledge',receiptKey:'v2:green:9903183013:3EB0CALLBACK_5544',
  providerEventId:'3EB0CALLBACK_5544',originOutboxId:live.id,
  resourceId:live.id,recipientId:'supplier-456',
  recipientChatId:'972501234567@c.us',messageKind:'supplier_reminder',
  revision:'r1',providerMessageId:'3EB0REMINDER_9922'
 });
});
test('changes to scope, sender account, provider receipt or selected ID never authorize an action',async()=>{
 const {live}=await prepared();
 const id=JSON.parse(live.interactive_v2_button_bindings_json).buttons[0].buttonId;
 for(const patch of [
  {id:'another-job'}, {company_id:'another-company'},
  {message_kind:'assignment'}, {source_type:'manual_trigger'},
  {resource_id:'different-resource'}, {recipient_id:'different-supplier'},
  {recipient_audience:'client'}, {supplier_id:'other-supplier'},
  {requested_provider:'wasender'}, {sender_account_id:'9903183014'},
  {chat_id:'972509999999@c.us'}, {revision:'r2'},
  {provider_message_id:'3EB0ANOTHER_222'}, {status:'unknown'},
  {provider:'wasender'}
 ]){
  const other={...live,...patch};
  assert.equal(await resolveAuthenticatedV2GreenButton({
   job:other,click:click(other,id),signingSecret:secret,now
  }),null,JSON.stringify(patch));
 }
 for(const patch of [
  {provider:'wasender'}, {senderAccountId:'9903183014'},
  {senderChatId:'972509999999@c.us'},
  {originalProviderMessageId:'3EB0OTHER_1234'},
  {buttonId:'wa2_AAAAAAAAAAAAAAAAAAAAAA'},
  {buttonId:'assignment_approve'}
 ]){
  assert.equal(await resolveAuthenticatedV2GreenButton({
   job:live,click:{...click(live,id),...patch},signingSecret:secret,now
  }),null,JSON.stringify(patch));
 }
});
test('forged snapshot labels, order, buttons, MAC and action tokens fail closed',async()=>{
 const {live,frozen}=await prepared();
 const snapshot=JSON.parse(frozen);
 for(const mutation of [
  x=>{x.buttons[0].label='אושר';},
  x=>{x.buttons[0].action='assignment_approve';},
  x=>{x.buttons[0].buttonId='wa2_AAAAAAAAAAAAAAAAAAAAAA';},
  x=>{x.buttons[0].actionToken='v2.clearly.fake';},
  x=>{x.buttons.push({...x.buttons[0]});},
  x=>{x.snapshotMac='A'.repeat(43);},
  x=>{x.jobId='another-job';},
  x=>{x.buttons[0].extra='bad';}
 ]){
  const testSnap=structuredClone(snapshot);mutation(testSnap);
  const body=JSON.stringify(testSnap);
  assert.equal(await verifyV2OpaqueButtonSnapshot({
   job:{...live,interactive_v2_button_bindings_json:body},
   raw:body,signingSecret:secret,now,accepted:true
  }),null,body.slice(0,95));
 }
 const id=snapshot.buttons[0].buttonId;
 assert.equal(await resolveAuthenticatedV2GreenButton({
  job:live,click:click(live,id),signingSecret:'different-secret-00000000000-aa',now
 }),null);
 assert.equal(await resolveAuthenticatedV2GreenButton({
  job:live,click:click(live,id),signingSecret:secret,now:now+2*86400000
 }),null,'expired button cannot reactivate');
});
test('snapshot must be created before sending and persisted unchanged, rejects duplicate or arbitrary action',async()=>{
 for(const invalid of [
  {status:'accepted'}, {status:'sending'}, {attempt_count:1},
  {send_started_at:new Date(now).toISOString()},
  {requested_provider:'wasender'}, {chat_id:'120000@g.us'},
  {company_id:'other-company'}, {resource_id:'different'},
  {message_kind:'unknown'}, {source_type:'assignment_new'},
  {recipient_audience:'admin'}, {recipient_id:'other-supplier'}
 ]){
  await assert.rejects(()=>createV2OpaqueButtonSnapshot({
   job:{...src(),...invalid},actions:selection(),
   signingSecret:secret,now
  }),/origin_not_eligible/,JSON.stringify(invalid));
 }
 for(const actions of [
  [{action:'contact_office',label:'למשרד'}],
  [{action:'assignment_reject',label:'דוחה'}],
  [{action:'reminder_acknowledge',label:'קיבלתי'},
   {action:'reminder_acknowledge',label:'קיבלתי שוב'}],
  [{action:'reminder_acknowledge',label:'\nחחח'}],
  []
 ]){
  await assert.rejects(()=>createV2OpaqueButtonSnapshot({
   job:src(),actions,signingSecret:secret,now
  }));
 }
 const {queued}=await prepared();
 await assert.rejects(()=>createV2OpaqueButtonSnapshot({
  job:queued,actions:selection(),signingSecret:secret,now
 }),/snapshot_already_exists/);
});
test('new V2 bridge has no network, database mutation, public route, poller or silent worker integration',()=>{
 const srcText=fs.readFileSync('base44/shared/whatsappV2OpaqueButtonBridge.ts','utf8');
 assert.doesNotMatch(srcText,/fetch\(|Deno\.serve|\.updateMany\(|\.create\(|setInterval\(|setTimeout\(/);
 const old=fs.readFileSync('base44/shared/whatsappButtonBindings.ts','utf8');
 assert.doesNotMatch(old,/whatsappV2OpaqueButtonBridge|wa2_/);
 const webhook=fs.readFileSync('base44/shared/greenButtonQaWebhookHandler.ts','utf8');
 assert.doesNotMatch(webhook,/whatsappV2OpaqueButtonBridge|reminder_acknowledge/);
});
