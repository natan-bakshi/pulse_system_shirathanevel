import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planGreenButtonsOnlyEdgeIngress}
 from '../base44/shared/greenButtonsOnlyEdgeIngress.ts';
import {planFutureGreenWebhookAck}
 from '../base44/shared/greenWebhookAckPlanning.ts';
const INSTANCE='9903183013',TOKEN='synthetic-Green-edge-webhook-secret-1234567890';
const NOW=Date.parse('2026-10-26T12:00:00Z');
const event=(type='textMessage')=>({
 typeWebhook:'incomingMessageReceived',idMessage:'3EB0FAKE1234567890ABCD',
 instanceData:{idInstance:Number(INSTANCE),typeInstance:'whatsapp'},
 senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us'},
 timestamp:Math.floor(NOW/1000),
 messageData:{typeMessage:type,textMessageData:{textMessage:'מאשר'}}
});
function request(raw,headers={}){
 return new Request('https://invalid.test/edge',{method:'POST',headers:{
  'content-type':'application/json',Authorization:'Bearer '+TOKEN,...headers
 },body:JSON.stringify(raw)});
}
const config={rolloutAuthorized:true,accountCapabilityVerified:true,
 webhookSecret:TOKEN,expectedInstanceId:INSTANCE,now:NOW};
test('edge gate drops known human chat and provider-status notifications without a Base44 invocation',async()=>{
 const variants=['textMessage','extendedTextMessage','audioMessage','imageMessage',
  'videoMessage','documentMessage','stickerMessage','reactionMessage','pollMessage'];
 const metadata=['outgoingMessageStatus','stateInstanceChanged','deviceInfo','quotaExceeded'];
 for(const raw of [
  ...variants.map(type=>event(type)),
  ...metadata.map(typeWebhook=>({...event(),typeWebhook}))
 ]){
  const outcome=await planGreenButtonsOnlyEdgeIngress(request(raw),config);
  assert.equal(outcome.decision,'ignored_non_button');
  assert.equal(outcome.requiresBase44Forward,false);
  assert.equal(outcome.mayBeAckCandidateAfterGreenQa,true);
  assert.equal(outcome.providerAckNotPublished,true);
  assert.equal(outcome.noDatabaseCalls,true);
  assert.equal(outcome.noProviderCalls,true);
  assert.equal(outcome.noBackendInvocationsMade,true);
  assert.equal('callbackForSecureForward' in outcome,false,
   'do not retain manual chat payload when nothing is forwarded');
 }
});
test('authenticated provider selection preserves only an in-memory callback for downstream independent verification',async()=>{
 const raw=event('templateButtonsReplyMessage');
 raw.messageData={typeMessage:'templateButtonsReplyMessage',
  templateButtonReplyMessage:{stanzaId:'3EB0ORIGINALMESSAGE123456',
   selectedId:'wa1_test_button',selectedDisplayText:'מאשר'}};
 const outcome=await planGreenButtonsOnlyEdgeIngress(request(raw),config);
 assert.equal(outcome.decision,'forward_verified_button');
 assert.equal(outcome.requiresBase44Forward,true);
 assert.equal(outcome.manualReviewRequired,false);
 assert.equal(outcome.mayBeAckCandidateAfterGreenQa,false);
 assert.deepEqual(outcome.callbackForSecureForward,raw);
 assert.equal(outcome.noBackendInvocationsMade,true,'forward is planned, NOT sent');
});
test('unsupported beta and malformed selections are forwarded to REVIEW, never silently discarded',async()=>{
 for(const type of ['newBetaButtonSelection','listResponseMessage',
  'interactiveButtonsResponse']){
  const raw=event(type);
  const result=await planGreenButtonsOnlyEdgeIngress(request(raw),config);
  assert.equal(result.decision,'forward_unknown_for_review',type);
  assert.equal(result.manualReviewRequired,true,type);
  assert.equal(result.requiresBase44Forward,true,type);
  assert.equal(result.mayBeAckCandidateAfterGreenQa,false,type);
  assert.equal(result.noBackendInvocationsMade,true,type);
 }
});
test('provider authentication and expected instance are mandatory before any filtering',async()=>{
 const candidates=[
  {req:request(event(),{Authorization:'Bearer wrong-secret-no-access'}),config},
  {req:request(event()),cfg:{...config,expectedInstanceId:'9901110000'}},
  {req:request(event()),cfg:{...config,rolloutAuthorized:false}},
  {req:request(event()),cfg:{...config,accountCapabilityVerified:false}}
 ];
 for(const item of candidates){
  const result=await planGreenButtonsOnlyEdgeIngress(item.req,item.cfg||item.config);
  assert.equal(result.decision,'request_refused');
  assert.equal(result.requiresBase44Forward,false);
  assert.equal(result.mayBeAckCandidateAfterGreenQa,false);
  assert.equal(result.noBackendInvocationsMade,true);
 }
});
test('edge gate cannot fake ACK decision or business transition: it has no HTTP/network/DB capability',()=>{
 const src=fs.readFileSync('base44/shared/greenButtonsOnlyEdgeIngress.ts','utf8');
 assert.doesNotMatch(src,/\b(?:Deno\.serve|fetch\(|\.updateMany\(|\.create\(|\.filter\()/);
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 assert.doesNotMatch(ui,/planGreenButtonsOnlyEdgeIngress/);
 assert.equal(planFutureGreenWebhookAck({stage:'ignored_non_button',
  reason:'owner_approved_buttons_only_filter',
  verifiedProviderAndAccount:false,assignmentOnlyRoute:true,
  noDatabaseCalls:true}).mayRespond200AfterProviderQa,false);
});
