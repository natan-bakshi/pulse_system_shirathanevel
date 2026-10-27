import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {trustedGreenButtonQaConfig,greenButtonQaSafeSummary}
 from '../base44/shared/greenButtonQaLaunch.ts';
import {handleGreenButtonQaWebhook}
 from '../base44/shared/greenButtonQaWebhookHandler.ts';
import {stageFutureGreenInteractiveHttpCallback}
 from '../base44/shared/greenInteractiveHttpStaging.ts';
const INSTANCE='9903183013',ACCOUNT_TOKEN='GreenQaMockOnlyAccessToken-123456789',
 WEBHOOK='OnlyQaGreenWebhookBearer-123456789',
 SIGNING='OnlyQaSigningSecretSeparateFromGreenWebhook-123456789';
const CHAT='972501234567@c.us';
const control={id:'control-test',control_key:'global',enabled:true,paused:false,
 interactive_outbound_live_enabled:true,
 interactive_assignment_green_policy_json:JSON.stringify({
  companyId:'shirat_hanevel',provider:'green',messageKind:'assignment',
  version:3,officeNumber:'972551111111',
  policy:{enabled:false,quoteAssignment:false,buttons:[
   {action:'assignment_approve',label:'מאשר'},
   {action:'assignment_reject',label:'דוחה'},
   {action:'contact_office',label:'פנייה למשרד'}]}
 })
};
const secrets={
 GREEN_BUTTONS_QA_SEND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'verified',
 GREEN_BUTTONS_QA_OWNER_APPROVED:'approved',
 GREEN_BUTTONS_QA_ALLOWED_CHAT:CHAT,
 GREEN_BUTTONS_QA_EVENT_SERVICE_ID:'service-123',
 GREEN_BUTTONS_QA_SUPPLIER_ID:'supplier-123',
 GREEN_API_INSTANCE_ID:INSTANCE,GREEN_API_TOKEN:ACCOUNT_TOKEN,
 GREEN_API_WEBHOOK_TOKEN:WEBHOOK,WHATSAPP_INTERACTIVE_SIGNING_SECRET:SIGNING
};
const env=(overrides={})=>key=>({...secrets,...overrides})[key]||'';
const createRequest=(header='Bearer '+WEBHOOK)=>new Request(
 'https://example.invalid/qa',{method:'POST',
 headers:{'content-type':'application/json',Authorization:header},
 body:JSON.stringify({typeWebhook:'incomingMessageReceived',
  instanceData:{idInstance:Number(INSTANCE),typeInstance:'whatsapp'},
  senderData:{chatId:CHAT,sender:CHAT},
  idMessage:'synthetic-event-only',timestamp:Math.floor(Date.now()/1000),
  messageData:{typeMessage:'textMessage',
   textMessageData:{textMessage:'manual-only'}}})});
const sdk=activeControl=>{
 const counts={reads:0,dbWrites:0};
 const client={asServiceRole:{entities:{WhatsAppQueueControl:{
  filter:async query=>{
   counts.reads++;
   return query.control_key==='global'?[structuredClone(activeControl)]:[];
  }
 }}}};
 return {counts,client};
};
test('single chat QA is disabled by default and never activates from saved policy alone',()=>{
 const actual=trustedGreenButtonQaConfig({
  ...control,interactive_outbound_live_enabled:false},env());
 assert.equal(actual,null);
 for(const [key,value] of Object.entries({
  GREEN_BUTTONS_QA_SEND_ENABLED:'',
  GREEN_BUTTONS_QA_INBOUND_ENABLED:'',
  GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'',
  GREEN_BUTTONS_QA_OWNER_APPROVED:'',
  GREEN_BUTTONS_QA_ALLOWED_CHAT:'',
  GREEN_BUTTONS_QA_EVENT_SERVICE_ID:'',
  GREEN_BUTTONS_QA_SUPPLIER_ID:'',
  WHATSAPP_INTERACTIVE_SIGNING_SECRET:'bad',
  GREEN_API_WEBHOOK_TOKEN:'',
  GREEN_API_INSTANCE_ID:'not_an_instance',
  GREEN_API_TOKEN:'bad'
 })){
  assert.equal(trustedGreenButtonQaConfig(control,env({[key]:value})),null,key);
 }
 assert.equal(trustedGreenButtonQaConfig({
  ...control,interactive_assignment_green_policy_json:null
 },env()),null,'missing owner draft cannot activate beta sending');
 const report=greenButtonQaSafeSummary(control,env(),true);
 assert.equal(report.readyForQa,true);
 assert.equal(greenButtonQaSafeSummary(control,env(),false).readyForQa,false,
  'missing durable v2 assignment mode must not claim readiness');
 assert.equal(JSON.stringify(report).includes(CHAT),false);
 assert.equal(JSON.stringify(report).includes(SIGNING),false);
});
test('only trusted full suite yields two reply buttons and contact-office URL mode',()=>{
 const output=trustedGreenButtonQaConfig(control,env());
 assert.equal(output.enabled,true);
 assert.equal(output.accountCapabilityVerified,true);
 assert.equal(output.capability,'mixed_url');
 assert.equal(output.qaChatId,CHAT);
 assert.equal(output.qaEventServiceId,'service-123');
 assert.equal(output.qaSupplierId,'supplier-123');
 assert.equal(output.officeNumber,'972551111111');
 assert.equal(output.officeLabel,'פנייה למשרד');
 assert.equal(output.officeContextMode,'reference');
 assert.deepEqual(output.policy.buttons.map(x=>x.action),
  ['assignment_approve','assignment_reject','contact_office']);
 assert.equal(JSON.parse(control.interactive_assignment_green_policy_json)
  .policy.enabled,false,'persistent draft remains disabled');
});
test('incomplete/ambiguous office policy never enables signed beta transport',()=>{
 const bad=[
  {...control,interactive_assignment_green_policy_json:'{' },
  {...control,interactive_assignment_green_policy_json:JSON.stringify({
   ...JSON.parse(control.interactive_assignment_green_policy_json),
   officeNumber:''
  })},
  {...control,interactive_assignment_green_policy_json:JSON.stringify({
   ...JSON.parse(control.interactive_assignment_green_policy_json),
   policy:{enabled:false,quoteAssignment:false,buttons:[
    {action:'assignment_approve',label:'מאשר'}]}
  })}
 ];
 for(const setting of bad)assert.equal(trustedGreenButtonQaConfig(setting,env()),null);
});
test('HTTP QA endpoint is inert without every independent env approval: no DB or provider',async()=>{
 for(const [key,value] of [
  ['GREEN_BUTTONS_QA_SEND_ENABLED',''],
  ['GREEN_BUTTONS_QA_INBOUND_ENABLED',''],
  ['GREEN_BUTTONS_QA_ACCOUNT_VERIFIED',''],
  ['GREEN_BUTTONS_QA_OWNER_APPROVED','']
 ]){
  const db=sdk(control);
  const result=await handleGreenButtonQaWebhook(createRequest(),{
   env:env({[key]:value}),makeClient:()=>db.client,
   recalculateEventStatus:async()=>{throw Error('never called')}
  });
  assert.equal(result.httpStatus,404,key);
  assert.equal(db.counts.reads,0,key);
 }
});
test('wrong Green bearer never reads DB or body and is not ACKed',async()=>{
 const db=sdk(control);
 const r=await handleGreenButtonQaWebhook(createRequest('Bearer bad'),{
  env:env(),makeClient:()=>db.client,
  recalculateEventStatus:async()=>{throw Error('never called')}
 });
 assert.equal(r.httpStatus,401);
 assert.equal(r.body.received,false);
 assert.equal(db.counts.reads,0);
});
test('missing owner control, no draft, or no owner approved number prevents callback',async()=>{
 for(const variant of [
  {...control,interactive_outbound_live_enabled:false},
  {...control,interactive_assignment_green_policy_json:null}
 ]){
  const db=sdk(variant);
  const result=await handleGreenButtonQaWebhook(createRequest(),{
   env:env(),makeClient:()=>db.client,
   recalculateEventStatus:async()=>{throw Error('never called')}
  });
  assert.equal(result.httpStatus,404);
  assert.equal(db.counts.reads,1);
 }
});
test('one QA callback uses existing staging coordinator and returns 200 only on verified durable finish',async()=>{
 const db=sdk(control);let calls=0;
 const r=await handleGreenButtonQaWebhook(createRequest(),{
  env:env(),makeClient:()=>db.client,
  recalculateEventStatus:async()=>{throw Error('not reached in mock')},
  stage:async(_request,options)=>{
   calls++;
   assert.equal(options.expectedInstanceId,INSTANCE);
   assert.equal(options.qaChatId,CHAT);
   assert.equal(options.qaEventServiceId,'service-123');
   assert.equal(options.qaSupplierId,'supplier-123');
   assert.equal(options.webhookSecret,WEBHOOK);
   assert.equal(options.actionSigningSecret,SIGNING);
   assert.equal(options.encryptedUnknownRecovery,undefined);
   assert.equal(options.rolloutAuthorized,true);
   return {stage:'processed',result:'applied',reason:'applied'};
  }
 });
 assert.equal(r.httpStatus,200);
 assert.equal(r.body.received,true);
 assert.deepEqual(Object.keys(r.body),['received'],
  'no sender, action, office URL or secret may escape HTTP');
 assert.equal(db.counts.reads,1);
 assert.equal(calls,1);
});
test('ambiguous writes, unknown button, DB failure and plain rejected actions never get success ACK',async()=>{
 for(const outcome of [
  {stage:'processed',result:'held',reason:'existing_receipt_not_finalized'},
  {stage:'quarantined_unknown'},
  {stage:'quarantine_unavailable'},
  {stage:'processed',result:'refused',reason:'unverified_button_binding'}
 ]){
  const db=sdk(control);
  const r=await handleGreenButtonQaWebhook(createRequest(),{
   env:env(),makeClient:()=>db.client,
   recalculateEventStatus:async()=>null,stage:async()=>outcome
  });
  assert.equal(r.body.received,false);
  assert.notEqual(r.httpStatus,200);
 }
 const db=sdk(control);
 const err=await handleGreenButtonQaWebhook(createRequest(),{
  env:env(),makeClient:()=>db.client,
  recalculateEventStatus:async()=>null,
  stage:async()=>{throw Error('INTERNAL SECRET SHOULD NOT LEAK')}
 });
 assert.equal(err.httpStatus,503);
 assert.equal(JSON.stringify(err).includes('INTERNAL SECRET'),false);
});
test('authenticated outside-QA phone is refused BEFORE even a single inbound DB read',async()=>{
 let reads=0;
 const raw={typeWebhook:'incomingMessageReceived',
  idMessage:'QA_OUTSIDECHAT_PROVIDER_EVENT_12345',
  instanceData:{idInstance:Number(INSTANCE),typeInstance:'whatsapp'},
  timestamp:Math.floor(Date.now()/1000),
  senderData:{chatId:'972509999999@c.us',sender:'972509999999@c.us'},
  messageData:{typeMessage:'buttonsResponseMessage',
   buttonsResponseMessage:{selectedButtonId:'wa1_ABCDEFGHIJKLMNOPQRSTUV',
    stanzaId:'3EB0ORIGINALMESSAGE12345'}}};
 const request=new Request('https://example.invalid/qa',{
  method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+WEBHOOK},
  body:JSON.stringify(raw)});
 const client={asServiceRole:{entities:new Proxy({}, {
  get:()=>{reads++;throw Error('Database forbidden for other chat')}
 })}};
 const outcome=await stageFutureGreenInteractiveHttpCallback(request,{
  client,rolloutAuthorized:true,accountCapabilityVerified:true,
  webhookSecret:WEBHOOK,actionSigningSecret:SIGNING,
  expectedInstanceId:INSTANCE,qaChatId:CHAT,claimOwner:'qa-receiver',
  recalculateEventStatus:async()=>{throw Error('never update')}
 });
 assert.equal(outcome.stage,'qa_sender_outside_scope');
 assert.equal(reads,0);
 assert.equal(outcome.businessWritesAuthorized,false);
});
test('QA handler does not modify existing provider settings, add cron or send a message',()=>{
 const src=fs.readFileSync('base44/shared/greenButtonQaWebhookHandler.ts','utf8');
 const endpoint=fs.readFileSync('base44/functions/greenAssignmentButtonQaWebhook/entry.ts','utf8');
 const worker=fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8');
 assert.doesNotMatch(src,/\/setSettings\/|sendWhatsApp|setInterval/);
 assert.doesNotMatch(endpoint,/\/setSettings\/|sendWhatsApp|setInterval/);
 assert.match(worker,/trustedGreenButtonQaConfig/);
 assert.match(worker,/interactiveConfig:qaConfig/);
 assert.match(endpoint,/Deno\.serve/);
});
