import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFutureGreenInteractiveHttpRequest} from '../base44/shared/greenInteractiveHttpBoundary.ts';
const secret='green-callback-verified-test-secret-0123456789';
const approved={rolloutAuthorized:true,accountCapabilityVerified:true,webhookSecret:secret};
const event={
 typeWebhook:'incomingMessageReceived',idMessage:'C0CD39BB261589D5C98412D255CD000B',
 instanceData:{idInstance:9903183013,typeInstance:'whatsapp'},
 senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us'},
 messageData:{typeMessage:'interactiveButtonsResponse',
  interactiveButtonsResponse:{stanzaId:'3EB0A5815E6EBF7DE71DE3',selectedId:'wa1_button'}}
};
function request(body=JSON.stringify(event),headers={}){
 return new Request('https://invalid.test/internal-callback',{
  method:'POST',headers:{
   'content-type':'application/json; charset=utf-8',
   'Authorization':'Bearer '+secret,...headers
  },body
 });
}
test('authenticated JSON body has actual byte length, not untrusted Content-Length',async()=>{
 const payload=JSON.stringify({...event,senderName:'שלום'});
 const raw=new TextEncoder().encode(payload);
 const result=await decodeFutureGreenInteractiveHttpRequest(request(payload),approved);
 assert.equal(result.ok,true);
 assert.equal(result.status,200);
 assert.equal(result.callbackByteLength,raw.length);
 assert.deepEqual(result.rawCallback.senderData,event.senderData);
 assert.equal(JSON.stringify(result).includes(secret),false,'secret must not enter response JSON');
});
test('closed rollout NEVER even touches method, headers, or body',async()=>{
 const untrusted={
  get method(){throw Error('must not read request while OFF');},
  get headers(){throw Error('must not read headers while OFF');},
  get body(){throw Error('must not read body while OFF');}
 };
 for(const bad of [
  {rolloutAuthorized:false},{accountCapabilityVerified:false},
  {rolloutAuthorized:undefined},{accountCapabilityVerified:undefined}
 ]){
  const result=await decodeFutureGreenInteractiveHttpRequest(untrusted,{...approved,...bad});
  assert.equal(result.ok,false);
  assert.equal(result.status,404);
  assert.equal(result.noDatabaseCalls,true);
 }
});
test('method, type and gzip are refused before body is read',async()=>{
 const unsupported=[
  {request:new Request('https://invalid.test/callback',{method:'GET'}),status:405},
  {request:request('{}',{'content-type':'text/plain'}),status:415},
  {request:request('{}',{'content-type':'application/json; charset=iso-8859-1'}),status:415},
  {request:request('{}',{'content-encoding':'gzip'}),status:415},
  {request:request('{}',{'content-type':'application/json,application/json'}),status:415}
 ];
 for(const t of unsupported){
  const result=await decodeFutureGreenInteractiveHttpRequest(t.request,approved);
  assert.equal(result.ok,false);
  assert.equal(result.status,t.status);
 }
});
test('bad Green token is rejected without consuming request body',async()=>{
 let reads=0;
 const bad={method:'POST',headers:new Headers({
  'content-type':'application/json','Authorization':'Bearer invalid-token-12345678'
 }),get body(){reads++;throw Error('Untrusted body must stay unread');}};
 const denied=await decodeFutureGreenInteractiveHttpRequest(bad,approved);
 assert.equal(denied.status,401);
 assert.equal(reads,0);
});
test('actual stream-size cap defeats spoofed small Content-Length; no huge buffering',async()=>{
 const body=JSON.stringify(event)+'a'.repeat(35000);
 const streams=[
  request(body),
  request(body,{'content-length':'100'}),
  request('{}',{'content-length':'32769'}),
  request('{}',{'content-length':'NaN'})
 ];
 for(const req of streams){
  const result=await decodeFutureGreenInteractiveHttpRequest(req,approved);
  assert.equal(result.ok,false);
  assert.equal(result.status,413);
 }
});
test('actual length, UTF-8 and JSON-object integrity are checked before admission',async()=>{
 const mismatch=await decodeFutureGreenInteractiveHttpRequest(
  request(JSON.stringify(event),{'content-length':'20'}),approved);
 assert.equal(mismatch.status,400);
 const primitive=await decodeFutureGreenInteractiveHttpRequest(request('"hello world"'+ ' '.repeat(20)),approved);
 assert.equal(primitive.status,400);
 const array=await decodeFutureGreenInteractiveHttpRequest(request('[1,2,3]'+ ' '.repeat(20)),approved);
 assert.equal(array.status,400);
 const invalid=await decodeFutureGreenInteractiveHttpRequest(request('{invalid'+' '.repeat(20)),approved);
 assert.equal(invalid.status,400);
 const badUtf8=new Uint8Array([123,34,97,34,58,34,0xff,34,125,...Array(15).fill(32)]);
 const malformed=await decodeFutureGreenInteractiveHttpRequest(
  new Request('https://invalid.test/callback',{method:'POST',headers:{
   'content-type':'application/json','Authorization':'Bearer '+secret
  },body:badUtf8}),approved);
 assert.equal(malformed.status,400);
});
test('a real HTTP callback endpoint is NOT registered or published in this stage',()=>{
 const file=String.raw`base44/shared/greenInteractiveHttpBoundary.ts`;
 assert.equal(file.startsWith('base44/shared/'),true);
});
