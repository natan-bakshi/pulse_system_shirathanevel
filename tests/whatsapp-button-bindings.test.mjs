import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFutureInteractiveButtonSnapshot,resolveSignedActionForGreenButton} from '../base44/shared/whatsappButtonBindings.ts';
import {verifySignedWhatsAppAction} from '../base44/shared/whatsappSignedAction.ts';
const now=Date.parse('2026-10-26T12:00:00Z');
const secret='server-secret-for-interactive-button-tests-123456789';
const policy={enabled:true,quoteAssignment:false,buttons:[
 {action:'assignment_approve',label:'אישור'},
 {action:'assignment_reject',label:'דחייה'},
 {action:'contact_office',label:'משרד'}
]};
const baseJob=()=>({
 id:'outbox-job-123',source_type:'assignment_new',status:'sending',
 event_service_id:'service-123',supplier_id:'supplier-123',
 requested_provider:'green',sender_account_id:'green-instance-123',
 assignment_revision:'r5',chat_id:'972501234567@c.us'
});
async function create(job=baseJob(),patch={}){
 return createFutureInteractiveButtonSnapshot({
  job,policy,signingSecret:secret,issuedAt:now,
  nonceFactory:(()=>{let i=0;return ()=>'nonce-snapshot-'+(++i)+'-123456789';})(),
  ...patch
 },webcrypto.subtle);
}
const accepted=(json)=>({...baseJob(),status:'accepted',provider:'green',
 provider_message_id:'green-outbound-receipt-1',interactive_button_bindings_json:json});
const click=(buttonId)=>({buttonId,provider:'green',senderAccountId:'green-instance-123',
 originalProviderMessageId:'green-outbound-receipt-1',senderChatId:'972501234567@c.us'});
test('short Green button IDs map to server-signed allowlisted actions; office URL remains separate',async()=>{
 const raw=await create();
 const data=JSON.parse(raw);
 assert.equal(data.buttons.length,2);
 assert.deepEqual(data.buttons.map(x=>x.action),['assignment_approve','assignment_reject']);
 assert.notEqual(data.buttons[0].buttonId,data.buttons[1].buttonId);
 for(const b of data.buttons){
  assert.match(b.buttonId,/^wa1_[A-Za-z0-9_-]{22}$/);
  assert.ok(b.buttonId.length<40);
  assert.equal(b.buttonId.includes('supplier-123'),false);
  assert.equal(b.buttonId.includes(secret),false);
  const validated=await verifySignedWhatsAppAction({
   token:b.actionToken,secret,now:now+1000
  },webcrypto.subtle);
  assert.equal(validated.action,b.action);
  assert.equal(validated.outboxJobId,'outbox-job-123');
  assert.equal(validated.revision,'r5');
 }
 const job=accepted(raw);
 const selected=resolveSignedActionForGreenButton(job,click(data.buttons[0].buttonId));
 assert.equal(selected,data.buttons[0].actionToken);
 const wrong=resolveSignedActionForGreenButton(job,click('wa1_nonexistent0000000000'));
 assert.equal(wrong,null);
});
test('frozen binding returns identical bytes on worker restart; no regenerated action IDs',async()=>{
 const first=await create();
 const saved={...baseJob(),interactive_button_bindings_json:first};
 const second=await create(saved,{nonceFactory:()=>{throw Error('Must never generate new IDs after snapshot exists');}});
 assert.equal(second,first);
});
test('mismatched original message, recipient, provider or sending account cannot resolve action token',async()=>{
 const raw=await create();
 const data=JSON.parse(raw),job=accepted(raw),button=data.buttons[0].buttonId;
 for(const change of [
  {provider:'wasender'},{senderAccountId:'different-account'},
  {originalProviderMessageId:'other-receipt'},{senderChatId:'972509999999@c.us'}
 ])assert.equal(resolveSignedActionForGreenButton(job,{...click(button),...change}),null);
 for(const mutation of [
  {status:'unknown'},{source_type:'billing'}, {provider:'wasender'},
  {chat_id:'972509999999@c.us'}, {sender_account_id:'other'},
  {assignment_revision:'r4'}
 ])assert.equal(resolveSignedActionForGreenButton({...job,...mutation},click(button)),null);
});
test('missing, malformed and mismatched persisted snapshots fail closed instead of regenerating',async()=>{
 const raw=await create(),data=JSON.parse(raw);
 for(const invalid of [
  '{',JSON.stringify({...data,version:2}),
  JSON.stringify({...data,jobId:'another-job'}),
  JSON.stringify({...data,buttons:[]}),
  JSON.stringify({...data,buttons:[...data.buttons,data.buttons[0]]}),
  JSON.stringify({...data,buttons:data.buttons.map(x=>({...x,buttonId:'delete_all'}))})
 ]){
  const job={...baseJob(),interactive_button_bindings_json:invalid};
  await assert.rejects(create(job),/corrupt_existing_snapshot/);
  assert.equal(resolveSignedActionForGreenButton(accepted(invalid),click(data.buttons[0].buttonId)),null);
 }
});
test('interactive button snapshots require known origin and explicit enabled policy',async()=>{
 for(const job of [
  {...baseJob(),status:'accepted'},
  {...baseJob(),sender_account_id:''},
  {...baseJob(),assignment_revision:''},
  {...baseJob(),event_service_id:''},
  {...baseJob(),chat_id:'972501234567@g.us'}
 ])await assert.rejects(create(job));
 await assert.rejects(create(baseJob(),{policy:{...policy,enabled:false}}));
 await assert.rejects(create(baseJob(),{policy:{...policy,buttons:[
  {action:'contact_office',label:'משרד'}]}}));
});
