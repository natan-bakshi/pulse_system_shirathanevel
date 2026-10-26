import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {sendWhatsAppTransport} from '../base44/shared/whatsappSend.ts';
import {createFutureInteractiveButtonSnapshot} from '../base44/shared/whatsappButtonBindings.ts';
import {previewGreenInteractiveAssignment} from '../base44/shared/greenInteractiveOutbound.ts';

const savedDeno=globalThis.Deno,savedFetch=globalThis.fetch;
globalThis.Deno={env:{get:field=>({
 GREEN_API_INSTANCE_ID:'9903183013',
 GREEN_API_TOKEN:'not-a-real-test-token'
})[field]||''}};
test.after(()=>{
 if(savedDeno===undefined)delete globalThis.Deno;else globalThis.Deno=savedDeno;
 globalThis.fetch=savedFetch;
});
const signingSecret='sandbox-green-beta-signature-1234567890123456789';
const now=Date.now();
async function prepared(capability='reply_only'){
 const job={
  id:'outbox-123',status:'queued',source_type:'assignment_new',
  requested_provider:'green',provider:'green',
  message_type:'text',message_text:'בדיקת אישור שיבוץ',
  chat_id:'972501234567@c.us',
  sender_account_id:'9903183013',assignment_revision:'r4',
  event_service_id:'service-123',supplier_id:'supplier-123'
 };
 job.interactive_button_bindings_json=await createFutureInteractiveButtonSnapshot({
  job,signingSecret,policy:{enabled:true,quoteAssignment:false,buttons:[
   {action:'assignment_approve',label:'מאשר'},
   {action:'assignment_reject',label:'דוחה'}
  ]},issuedAt:now
 },webcrypto.subtle);
 job.status='sending';
 const preview=await previewGreenInteractiveAssignment({
  job,frozenSnapshot:job.interactive_button_bindings_json,
  signingSecret,capability,rolloutEnabled:true,
  officeNumber:'972541234567',officeLabel:'דבר עם המשרד',
  now,subtle:webcrypto.subtle
 });
 return {job,preview};
}
test('mocked Green beta transport performs ONE HTTP POST with frozen short buttons',async()=>{
 const {job,preview}=await prepared();
 const calls=[];
 globalThis.fetch=async (url,options)=>{
  calls.push({url,options});
  return {ok:true,status:200,json:async()=>({idMessage:'3EB0ACCEPTEDOFFLINETEST'})};
 };
 const receipt=await sendWhatsAppTransport(job,'green',{},preview);
 assert.equal(receipt.messageId,'3EB0ACCEPTEDOFFLINETEST');
 assert.equal(receipt.provider,'green');
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/\/waInstance9903183013\/sendInteractiveButtonsReply\/not-a-real-test-token$/);
 const body=JSON.parse(calls[0].options.body);
 assert.equal(body.chatId,job.chat_id);
 assert.equal(body.buttons.length,2);
 assert.deepEqual(body.buttons.map(x=>x.buttonText),['מאשר','דוחה']);
 assert.equal(JSON.stringify(body).includes(signingSecret),false);
 assert.equal(JSON.stringify(body).includes('actionToken'),false);
});
test('account switch rejects before any HTTP or signed-token leakage',async()=>{
 const {job,preview}=await prepared();
 let n=0;globalThis.fetch=async()=>{n++;throw Error('Must not contact provider')};
 await assert.rejects(sendWhatsAppTransport({...job,sender_account_id:'9900000000'},
  'green',{},preview),e=>e.errorCode===400);
 assert.equal(n,0);
 await assert.rejects(sendWhatsAppTransport({...job,provider:'wasender'},
  'wasender',{},preview),e=>e.errorCode===400);
 assert.equal(n,0);
});
test('Green beta 2xx with missing receipt is UNKNOWN and must not be blindly retried',async()=>{
 const {job,preview}=await prepared('mixed_url');
 let n=0;globalThis.fetch=async()=>{
  n++;return {ok:true,status:200,json:async()=>({})};
 };
 await assert.rejects(sendWhatsAppTransport(job,'green',{},preview),
  e=>e.deliveryUncertain===true);
 assert.equal(n,1,'one provider attempt only');
});
test('definite Green beta rate limit preserves 429 and wait for centralized worker policy',async()=>{
 const {job,preview}=await prepared('mixed_url');
 let n=0;globalThis.fetch=async()=>{
  n++;return {ok:false,status:429,headers:{get:k=>k==='Retry-After'?'45':null},
   json:async()=>({error:'rate limited'})};
 };
 await assert.rejects(sendWhatsAppTransport(job,'green',{},preview),
  e=>e.errorCode===429&&e.deliveryUncertain===false&&e.retryAfterSeconds===45);
 assert.equal(n,1);
});
test('legacy message with no preview keeps the existing sendMessage transport unchanged',async()=>{
 const {job}=await prepared();
 const requests=[];globalThis.fetch=async(url,options)=>{
  requests.push({url,body:JSON.parse(options.body)});
  return {ok:true,status:200,json:async()=>({idMessage:'legacy-text-receipt'})};
 };
 const result=await sendWhatsAppTransport(job,'green',{},null);
 assert.equal(result.messageId,'legacy-text-receipt');
 assert.equal(requests.length,1);
 assert.match(requests[0].url,/\/sendMessage\//);
 assert.deepEqual(requests[0].body,{chatId:job.chat_id,message:job.message_text});
});
