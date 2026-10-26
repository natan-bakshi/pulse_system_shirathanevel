import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFutureInteractiveButtonSnapshot} from '../base44/shared/whatsappButtonBindings.ts';
import {previewGreenInteractiveAssignment} from '../base44/shared/greenInteractiveOutbound.ts';

const now=Date.parse('2026-10-26T12:00:00Z');
const secret='test-server-only-green-interactive-action-signing-key';
const policy={enabled:true,quoteAssignment:false,buttons:[
 {action:'assignment_approve',label:'אישור שיבוץ'},
 {action:'assignment_reject',label:'דחיית שיבוץ'},
 {action:'contact_office',label:'פנייה למשרד'}
]};
const job=()=>({
 id:'outbox-123',source_type:'assignment_new',
 status:'queued',requested_provider:'green',provider:'green',
 message_type:'text',message_text:'נשמח לקבל תשובתך לשיבוץ',
 event_service_id:'service-123',supplier_id:'supplier-123',
 sender_account_id:'9903183013',assignment_revision:'r2',
 chat_id:'972501234567@c.us',attempt_count:0
});
async function fixture(){
 const row=job();
 row.interactive_button_bindings_json=await createFutureInteractiveButtonSnapshot({
  job:row,policy,signingSecret:secret,issuedAt:now,
  nonceFactory:(()=>{let n=0;return ()=>'nonce-test-'+(++n)+'-123456789';})()
 },webcrypto.subtle);
 row.status='sending';
 return row;
}
const input=(row,patch={})=>({
 job:row,frozenSnapshot:row.interactive_button_bindings_json,
 signingSecret:secret,capability:'mixed_url',rolloutEnabled:true,
 officeNumber:'972541234567',officeLabel:'פנייה למשרד',
 now:now+1000,subtle:webcrypto.subtle,...patch
});
test('mixed Green API beta produces two reply buttons and real office wa.me URL, without sending',async()=>{
 const row=await fixture();
 const result=await previewGreenInteractiveAssignment(input(row));
 assert.equal(result.method,'sendInteractiveButtons');
 assert.equal(result.kind,'interactive_mixed');
 assert.equal(result.providerRequestsMade,0);
 assert.deepEqual(result.body.buttons.map(x=>x.type),['reply','reply','url']);
 assert.equal(result.body.buttons[2].url,'https://wa.me/972541234567');
 assert.equal(result.body.buttons[2].buttonText,'פנייה למשרד');
 assert.equal(result.body.chatId,row.chat_id);
 assert.equal(result.body.body,row.message_text);
 assert.ok(result.body.buttons[0].buttonId.startsWith('wa1_'));
 assert.ok(result.body.buttons[1].buttonId.startsWith('wa1_'));
 assert.equal(JSON.stringify(result.body).includes(secret),false);
 assert.equal(JSON.stringify(result.body).includes('actionToken'),false);
});
test('reply-only capability keeps office chat link in body without inventing URL buttons',async()=>{
 const row=await fixture();
 const result=await previewGreenInteractiveAssignment(input(row,{capability:'reply_only'}));
 assert.equal(result.method,'sendInteractiveButtonsReply');
 assert.equal(result.body.buttons.length,2);
 assert.equal(result.body.buttons.some(x=>Object.hasOwn(x,'type')),false);
 assert.match(result.body.body,/https:\/\/wa\.me\/972541234567/);
 assert.equal(result.fallbackReason,'office_link_in_body');
});
test('unverified provider account and inactive rollout use ordinary text once, without new backend read',async()=>{
 const row=job();
 for(const patch of [
  {rolloutEnabled:false,capability:'mixed_url'},
  {rolloutEnabled:true,capability:'unknown'}
 ]){
  const result=await previewGreenInteractiveAssignment(input(row,patch));
  assert.equal(result.kind,'plain_text');
  assert.equal(result.method,'sendMessage');
  assert.equal(result.providerRequestsMade,0);
  assert.deepEqual(Object.keys(result.body).sort(),['chatId','message']);
  assert.match(result.body.message,/https:\/\/wa\.me\/972541234567/);
  assert.equal(result.body.message.includes(secret),false);
 }
});
test('tampered displayed labels/order, wrong secret or corrupted frozen origin never renders buttons',async()=>{
 const row=await fixture();
 const saved=JSON.parse(row.interactive_button_bindings_json);
 for(const mutated of [
  {...saved,buttons:saved.buttons.map(x=>({...x,label:'מאשר חיוב'}))},
  {...saved,buttons:[...saved.buttons].reverse()},
  {...saved,supplierId:'another-supplier'},
  {...saved,chatId:'972509999999@c.us'},
  {...saved,buttons:[]}
 ]){
  const corrupt={...row,interactive_button_bindings_json:JSON.stringify(mutated)};
  await assert.rejects(previewGreenInteractiveAssignment(input(corrupt)));
 }
 await assert.rejects(previewGreenInteractiveAssignment(input(row,{
  signingSecret:'wrong-signing-secret-with-enough-characters-12345'
 })));
 const missed={...row,assignment_revision:'r3'};
 await assert.rejects(previewGreenInteractiveAssignment(input(missed)));
});
test('plain-text and beta builders reject group, external source, Wasender, empty body and unclaimed job',async()=>{
 const row=await fixture();
 for(const variation of [
  {chat_id:'972501234567@g.us'},
  {source_type:'invoice'},
  {requested_provider:'wasender'},
  {message_type:'document'},
  {message_text:''},
  {message_text:'a'.repeat(5000)}
 ]){
  await assert.rejects(previewGreenInteractiveAssignment(input({...row,...variation})));
 }
 await assert.rejects(previewGreenInteractiveAssignment(input({...row,status:'queued'})));
});
test('office number, mixed URL label and body length are bounded and safe',async()=>{
 const row=await fixture();
 for(const bad of [
  {officeNumber:'0501234567+'},
  {officeNumber:'https://invalid.example'},
  {officeLabel:'NOT\nSAFE'},
  {officeLabel:''}
 ])await assert.rejects(previewGreenInteractiveAssignment(input(row,bad)));
 const longRow={...row,message_text:'x'.repeat(4095)};
 await assert.rejects(previewGreenInteractiveAssignment(input(longRow,{capability:'reply_only'})));
});
