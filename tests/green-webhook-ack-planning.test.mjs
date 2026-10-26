import test from 'node:test';
import assert from 'node:assert/strict';
import {isVerifiedGreenNonButtonEvent,planFutureGreenWebhookAck}
 from '../base44/shared/greenWebhookAckPlanning.ts';
import {stageFutureGreenInteractiveHttpCallback}
 from '../base44/shared/greenInteractiveHttpStaging.ts';

const account='9903183013';
const webhook='fake-provider-credential-strong-1234567890';
const event=type=>({
 typeWebhook:'incomingMessageReceived',idMessage:'3EB0FAKE123456789',
 instanceData:{idInstance:Number(account),typeInstance:'whatsapp'},
 senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us'},
 messageData:{typeMessage:type,textMessageData:{textMessage:'מאשר'}}
});
test('only recognized ordinary message shapes from verified GREEN account are ignorable',()=>{
 for(const type of ['textMessage','extendedTextMessage','audioMessage','imageMessage',
  'videoMessage','documentMessage','stickerMessage','locationMessage','contactMessage'])
  assert.equal(isVerifiedGreenNonButtonEvent(event(type),account),true,type);
 for(const invalid of [
  {...event('textMessage'),instanceData:{idInstance:9900001111,typeInstance:'whatsapp'}},
  {...event('textMessage'),typeWebhook:'outgoingMessageStatus'},
  {...event('interactiveButtonsResponse')},
  {...event('templateButtonsReplyMessage')},
  {...event('textMessage'),messageData:{typeMessage:'textMessage',
   buttonsResponseMessage:{selectedButtonId:'wa1_fake'}}},
  {...event('textMessage'),messageData:{typeMessage:'newBetaButtonResponse'}}
 ])assert.equal(isVerifiedGreenNonButtonEvent(invalid,account),false);
});
test('real stage classifies ordinary authenticated chat as no-op with ZERO entity calls',async()=>{
 let reads=0,writes=0;
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{filter:async()=>{reads++;return [];},
   updateMany:async()=>{writes++;throw Error('never writes')}},
  WhatsAppOutbox:{get:async()=>{reads++;throw Error('never reads')}}
 }}};
 const raw=event('textMessage');
 const request=new Request('https://invalid.test/offline',{
  method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+webhook},
  body:JSON.stringify(raw)
 });
 const result=await stageFutureGreenInteractiveHttpCallback(request,{
  client,rolloutAuthorized:true,accountCapabilityVerified:true,
  webhookSecret:webhook,actionSigningSecret:'no-live-secret',
  expectedInstanceId:account,claimOwner:'fake-test-worker',
  recalculateEventStatus:async()=>{throw Error('must not recalc')}
 });
 assert.equal(result.stage,'invalid_selection');
 assert.equal(result.reason,'recognized_non_button_event');
 assert.equal(result.verifiedProviderAndAccount,true);
 assert.equal(reads,0);assert.equal(writes,0);
 const ack=planFutureGreenWebhookAck(result);
 assert.equal(ack.decision,'manual_reconcile_candidate',
  'Ordinary chat may still be needed by other existing consumers');
 assert.equal(ack.reason,'ordinary_inbound_routing_not_verified');
 assert.equal(ack.providerAckNotPublished,true);
 assert.equal(ack.mayRespond200AfterProviderQa,false);
 assert.equal(ack.providerHttpStatusNotChosen,true);
});
test('known plain chat can be considered ACK candidate ONLY after trusted separate routing assurance',()=>{
 const result={stage:'invalid_selection',reason:'recognized_non_button_event',
  verifiedProviderAndAccount:true,ordinaryInboundHandlingVerified:true};
 assert.equal(planFutureGreenWebhookAck(result).decision,'safe_ack_candidate');
 assert.equal(planFutureGreenWebhookAck(result).reason,'non_button_route_verified');
 assert.equal(planFutureGreenWebhookAck({...result,
  ordinaryInboundHandlingVerified:false}).mayRespond200AfterProviderQa,false);
});
test('authenticated but unsupported beta button is NOT considered safe text',()=>{
 const unknown={stage:'invalid_selection',reason:'unverified_green_button_shape',
  verifiedProviderAndAccount:false};
 assert.equal(planFutureGreenWebhookAck(unknown).decision,'no_ack_candidate');
 assert.equal(isVerifiedGreenNonButtonEvent(event('interactiveButtonsResponse'),account),false);
});
test('only demonstrably DURABLE terminal outcomes may qualify for an ACK candidate',()=>{
 const durable=[
  {stage:'processed',result:'applied',reason:'applied'},
  {stage:'processed',result:'applied',reason:'already_applied'},
  {stage:'processed',result:'rejected',reason:'business_conflict'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_finalized',
   terminalReceiptVerified:true,receiptState:'applied',resultCode:'applied'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_finalized',
   terminalReceiptVerified:true,receiptState:'rejected',resultCode:'business_conflict'},
  {stage:'processed',result:'needs_review',reason:'unknown_after_write'}
 ];
 for(const result of durable){
  const decision=planFutureGreenWebhookAck(result);
  assert.equal(decision.decision,'safe_ack_candidate',JSON.stringify(result));
  assert.equal(decision.mayRespond200AfterProviderQa,true);
  assert.equal(decision.automaticSupplierReplayAllowed,false);
 }
});
test('ambiguous, unverified and rate-limited outcomes NEVER silently ACK or replay',()=>{
 const unsafe=[
  {stage:'processed',result:'needs_review',reason:'receipt_finalization_unverified'},
  {stage:'processed',result:'needs_review',reason:'receipt_claim_unverified'},
  {stage:'processed',result:'held',reason:'concurrent_claim'},
  {stage:'processed',result:'held',reason:'existing_receipt_not_finalized'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_recorded'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_finalized',
   terminalReceiptVerified:false,receiptState:'applied',resultCode:'applied'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_finalized',
   terminalReceiptVerified:true,receiptState:'processing',resultCode:'applied'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_finalized',
   terminalReceiptVerified:true,receiptState:'applied',resultCode:'unknown_after_write'},
  {stage:'processed',result:'refused',reason:'receipt_registration_unverified'},
  {stage:'processed',result:'refused',reason:'outbox_lookup_unavailable'},
  {stage:'processed',result:'refused',reason:'unverified_button_binding'},
  {stage:'rate_guard_refused',reason:'rate_limited'},
  {stage:'request_refused',reason:'provider_authentication_failed'},
  {stage:'no_such_stage'}
 ];
 for(const result of unsafe){
  const decision=planFutureGreenWebhookAck(result);
  assert.equal(decision.mayRespond200AfterProviderQa,false,JSON.stringify(result));
  assert.equal(decision.automaticSupplierReplayAllowed,false);
  assert.equal(decision.providerHttpStatusNotChosen,true);
 }
});
