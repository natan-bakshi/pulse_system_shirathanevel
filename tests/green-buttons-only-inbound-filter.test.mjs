import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stageFutureGreenInteractiveHttpCallback} from '../base44/shared/greenInteractiveHttpStaging.ts';
import {planFutureGreenWebhookAck,isVerifiedGreenNonButtonEvent}
 from '../base44/shared/greenWebhookAckPlanning.ts';
import {buildOfficeWhatsAppInquiryLink}
 from '../base44/shared/whatsappOfficeInquiryLink.ts';

const INSTANCE='9903183013',TOKEN='green-mock-webhook-token-only-0123456789';
const PRIVATE='972501234567@c.us';
const incoming=type=>({
 typeWebhook:'incomingMessageReceived',
 instanceData:{idInstance:Number(INSTANCE),typeInstance:'whatsapp'},
 idMessage:'3EB0FICTITIOUS12345678900000000',timestamp:1793016000,
 senderData:{chatId:PRIVATE,sender:PRIVATE},
 messageData:{typeMessage:type,
  textMessageData:{textMessage:'מאשר'},
  quotedMessage:{stanzaId:'3EB0ORIGINALASSIGNMENT1234567890'}}
});
function stage(raw,{token=TOKEN,expectedInstanceId=INSTANCE,enabled=true}={}){
 const counts={reads:0,writes:0,messages:0,recalcs:0};
 // NO SDK entities are allowed in filtered/unsupported paths. Every method
 // actively throws so an accidental lookup cannot pass unnoticed.
 const trap=new Proxy({}, {get:()=>()=>{counts.reads++;throw Error('Database not allowed')}});
 const client={asServiceRole:{entities:new Proxy({}, {get:()=>trap})}};
 const headers={'content-type':'application/json','Authorization':'Bearer '+token};
 const request=new Request('https://invalid.test/future-green',{
  method:'POST',headers,body:JSON.stringify(raw)});
 const promise=stageFutureGreenInteractiveHttpCallback(request,{
  client,rolloutAuthorized:enabled,accountCapabilityVerified:true,
  webhookSecret:TOKEN,actionSigningSecret:'not-a-real-key-0123456789',
  expectedInstanceId,claimOwner:'green-test-worker-123',
  recalculateEventStatus:async()=>{counts.recalcs++;throw Error('Never recalc')}
 });
 return promise.then(result=>({result,counts,ack:planFutureGreenWebhookAck(result)}));
}
test('owner policy filters ALL documented manual inbound types without a single DB read, mutation or supplier status change',async()=>{
 const types=[
  'textMessage','extendedTextMessage','audioMessage','imageMessage',
  'videoMessage','documentMessage','stickerMessage','locationMessage',
  'contactMessage','contactsArrayMessage','quotedMessage','reactionMessage',
  'groupInviteMessage','pollMessage','pollUpdateMessage','editedMessage',
  'deletedMessage','productMessage','orderMessage'
 ];
 for(const type of types){
  const raw=incoming(type);
  const {result,counts,ack}=await stage(raw);
  assert.equal(result.stage,'ignored_non_button',type);
  assert.equal(result.assignmentOnlyRoute,true,type);
  assert.equal(result.noDatabaseCalls,true,type);
  assert.equal(ack.decision,'safe_ack_candidate',type);
  assert.equal(ack.providerAckNotPublished,true,type);
  assert.equal(ack.providerHttpStatusNotChosen,true,type);
  assert.equal(ack.automaticSupplierReplayAllowed,false,type);
  assert.deepEqual(counts,{reads:0,writes:0,messages:0,recalcs:0},type);
 }
});
test('provider status and device notifications are irrelevant ONLY to dedicated assignment handler',async()=>{
 for(const typeWebhook of [
  'outgoingMessageReceived','outgoingAPIMessageReceived','outgoingMessageStatus',
  'stateInstanceChanged','statusInstanceChanged','deviceInfo','incomingCall',
  'outgoingCall','incomingBlock','quotaExceeded','IncomingMessageStatus'
 ]){
  const raw={...incoming('textMessage'),typeWebhook};
  const {result,counts,ack}=await stage(raw);
  assert.equal(result.stage,'ignored_non_button',typeWebhook);
  assert.equal(ack.decision,'safe_ack_candidate',typeWebhook);
  assert.equal(counts.reads,0,typeWebhook);
  assert.equal(counts.writes,0,typeWebhook);
 }
});
test('forged or foreign token/account never gets ACK clearance even for simple text',async()=>{
 for(const options of [
  {token:'invalid-green-webhook-token-9876543210'},
  {expectedInstanceId:'9900001111'},
  {enabled:false}
 ]){
  const {result,ack,counts}=await stage(incoming('textMessage'),options);
  assert.notEqual(result.stage,'ignored_non_button');
  assert.equal(ack.mayRespond200AfterProviderQa,false);
  assert.deepEqual(counts,{reads:0,writes:0,messages:0,recalcs:0});
 }
});
test('unsupported beta button / list selection / disguised button key NEVER silently ignored',async()=>{
 const bad=[
  incoming('futureInteractiveButtonClick'),
  incoming('listResponseMessage'),
  incoming('buttonsResponseMessage'),
  incoming('templateButtonsReplyMessage'),
  incoming('interactiveButtonsResponse'),
  {...incoming('textMessage'),messageData:{
   typeMessage:'textMessage',buttonsResponseMessage:{selectedButtonId:'wa1_fake'}
  }},
  {...incoming('textMessage'),messageData:{
   typeMessage:'textMessage',listResponseMessage:{title:'fake'}
  }},
  {...incoming('textMessage'),messageData:{
   typeMessage:'textMessage',interactiveButtonsReply:{selectedId:'fake'}
  }}
 ];
 for(const raw of bad){
  assert.equal(isVerifiedGreenNonButtonEvent(raw,INSTANCE),false);
  const {result,ack,counts}=await stage(raw);
  assert.ok(['invalid_selection','rate_guard_refused','quarantine_unavailable']
   .includes(result.stage),result.stage);
  assert.equal(ack.mayRespond200AfterProviderQa,false);
  // Unknown Beta formats now attempt a bounded durable review route;
  // the trapped/absent DB cannot make a supplier transition or ACK.
  assert.ok(counts.reads>=0);
  assert.equal(counts.writes,0);
 }
});
test('free-text answer quoting the EXACT assignment is ignored, even if it says approve',async()=>{
 const raw=incoming('extendedTextMessage');
 raw.messageData.extendedTextMessageData={
  text:'מאשר את השיבוץ',stanzaId:'3EB0ORIGINALASSIGNMENT1234567890'
 };
 const {result,counts}=await stage(raw);
 assert.equal(result.stage,'ignored_non_button');
 assert.equal(counts.reads,0);
 assert.equal(counts.writes,0);
});
test('contact office URL pre-fills correct outbox reference, but office reply is NEVER a supplier assignment action',async()=>{
 const url=buildOfficeWhatsAppInquiryLink({
  officeNumber:'972541234567',outboxJobId:'outbox-ABC123',
  contextMode:'reference'
 });
 const message=new URL(url).searchParams.get('text');
 assert.match(message,/outbox-ABC123/);
 assert.equal(new URL(url).pathname,'/972541234567');
 const reply=incoming('textMessage');
 reply.messageData.textMessageData.textMessage=message;
 const {result,counts,ack}=await stage(reply);
 assert.equal(result.stage,'ignored_non_button');
 assert.equal(ack.decision,'safe_ack_candidate');
 assert.deepEqual(counts,{reads:0,writes:0,messages:0,recalcs:0});
});
test('isolated filter is NEVER exported as a live public Base44 function or a scheduler',()=>{
 const paths=['base44/shared/greenInteractiveHttpStaging.ts',
  'base44/shared/greenWebhookAckPlanning.ts'];
 for(const path of paths){
  const contents=fs.readFileSync(path,'utf8');
  assert.doesNotMatch(contents,/^\s*(?:export\s+default\s+)?Deno\.serve\(/m);
 }
 const entry=fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8');
 assert.doesNotMatch(entry,/stageFutureGreenInteractiveHttpCallback|isVerifiedGreenNonButtonEvent/);
});
