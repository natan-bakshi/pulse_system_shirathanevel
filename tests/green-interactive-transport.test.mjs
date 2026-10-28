import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {sendWhatsAppTransport} from '../base44/shared/whatsappSend.ts';
import {createFutureInteractiveButtonSnapshot} from '../base44/shared/whatsappButtonBindings.ts';
import {previewGreenInteractiveAssignment} from '../base44/shared/greenInteractiveOutbound.ts';

const savedDeno=globalThis.Deno,savedFetch=globalThis.fetch;
const greenTestEnv={
 GREEN_API_INSTANCE_ID:'9903183013',
 GREEN_API_TOKEN:'not-a-real-test-token'
};
globalThis.Deno={env:{get:field=>greenTestEnv[field]||''}};
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
test('ONE marked QA button send uses instance Green URL while normal text remains on historic endpoint',async()=>{
 const {job,preview}=await prepared('mixed_url');
 greenTestEnv.GREEN_API_URL='https://7201.api.green-api.com';
 const requests=[];
 globalThis.fetch=async(url,options)=>{
  requests.push({url,method:options.method,body:JSON.parse(options.body)});
  return {ok:true,status:200,json:async()=>({idMessage:'3EB0SYNTHETICPROVIDERRECEIPT'})};
 };
 try{
  const response=await sendWhatsAppTransport({
   ...job,interactive_qa_required:true
  },'green',{},preview);
  assert.equal(response.deliveryStatus,'accepted');
  assert.equal(requests.length,1,'one Green beta send ONLY');
  assert.equal(requests[0].method,'POST');
  assert.equal(requests[0].url,
   'https://7201.api.green-api.com/waInstance9903183013/sendInteractiveButtons/not-a-real-test-token');
  assert.deepEqual(requests[0].body.buttons.map(x=>x.type),['reply','reply','url']);
  requests.length=0;
  await sendWhatsAppTransport({
   chat_id:job.chat_id,message_type:'text',message_text:'legacy-safe'
  },'green',{},null);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,
   'https://api.green-api.com/waInstance9903183013/sendMessage/not-a-real-test-token',
   'regular existing messages never silently change provider host');
 }finally{delete greenTestEnv.GREEN_API_URL;}
});
test('provider-issued instance host 7103 is honored only by marked mixed-button pilot',async()=>{
 const {job,preview}=await prepared('mixed_url');
 greenTestEnv.GREEN_API_URL='https://7103.api.greenapi.com';
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,method:options.method,body:JSON.parse(options.body)});
  return {ok:true,status:200,json:async()=>({idMessage:'synthetic-7103-receipt'})};
 };
 try{
  const sent=await sendWhatsAppTransport({
   ...job,interactive_qa_required:true
  },'green',{},preview);
  assert.equal(sent.messageId,'synthetic-7103-receipt');
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'POST');
  assert.equal(new URL(calls[0].url).origin,'https://7103.api.greenapi.com');
  assert.ok(calls[0].url.includes('/sendInteractiveButtons/'));
  assert.deepEqual(calls[0].body.buttons.map(b=>b.type),['reply','reply','url']);
  assert.equal(calls[0].body.chatId,job.chat_id);
  calls.length=0;
  await sendWhatsAppTransport({
   chat_id:job.chat_id,message_type:'text',message_text:'normal'
  },'green',{},null);
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0].url).origin,'https://api.green-api.com');
  assert.ok(calls[0].url.includes('/sendMessage/'));
 }finally{delete greenTestEnv.GREEN_API_URL;}
});
test('invalid pilot URL blocks provider HTTP without affecting existing Green sends',async()=>{
 const {job,preview}=await prepared('mixed_url');
 let calls=0;globalThis.fetch=async(url)=>{
  calls++;return {ok:true,status:200,json:async()=>({idMessage:'green-legacy'})};
 };
 greenTestEnv.GREEN_API_URL='https://7201.api.green-api.com.evil.invalid';
 try{
  await assert.rejects(sendWhatsAppTransport({
   ...job,interactive_qa_required:true
  },'green',{},preview),e=>e.errorCode===400&&e.deliveryUncertain===false);
  assert.equal(calls,0,'unsafe host must fail BEFORE provider request');
  const receipt=await sendWhatsAppTransport({
   chat_id:job.chat_id,message_type:'text',message_text:'normal'
  },'green',{},null);
  assert.equal(receipt.messageId,'green-legacy');
  assert.equal(calls,1,'existing traffic must still have its historic route');
 }finally{delete greenTestEnv.GREEN_API_URL;}
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
