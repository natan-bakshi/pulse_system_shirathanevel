import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {trustedGreenButtonQaConfig,trustedGreenButtonQaInboundConfig,
 greenButtonQaSafeSummary}
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
 GREEN_BUTTONS_QA_CREATE_ENABLED:'enabled',
 GREEN_BUTTONS_QA_POST_REBOOT_SETTINGS_VERIFIED:'confirmed',
 GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:'enabled',
 GREEN_BUTTONS_QA_EVENT_ID:'qa-event-123',
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
  messageData:{typeMessage:'interactiveButtonsResponse',
   interactiveButtonsResponse:{selectedId:'wa1_SYNTHETIC_BUTTON_ID',
    stanzaId:'3EB0SYNTHETICORIGINAL123456'}}})});
const sdk=(activeControl,flag='true')=>{
 const counts={reads:0,flagReads:0,dbWrites:0};
 const client={asServiceRole:{entities:{WhatsAppQueueControl:{
  filter:async query=>{
   counts.reads++;
   return query.control_key==='global'?[structuredClone(activeControl)]:[];
  }
 },AppSettings:{filter:async()=>{
  counts.flagReads++;
  return flag===null?[]:flag==='duplicate'?[
   {setting_key:'assignment_intent_v1_enabled',setting_value:'true'},
   {setting_key:'assignment_intent_v1_enabled',setting_value:'true'}
  ]:[{setting_key:'assignment_intent_v1_enabled',setting_value:flag}];
 }}}}};
 return {counts,client};
};
const notification=(opts={})=>{
 const chat=opts.chat||CHAT;
 const type=opts.type||'incomingMessageReceived';
 const body={
  typeWebhook:type,
  instanceData:{idInstance:Number(opts.instance||INSTANCE),typeInstance:'whatsapp'},
  idMessage:'synthetic-nonbutton-event-id-123456',
  timestamp:Math.floor(Date.now()/1000),
  senderData:{chatId:chat,sender:chat},
  messageData:opts.messageData??{typeMessage:'textMessage',
   textMessageData:{textMessage:'manual office content never persisted'}}
 };
 return new Request('https://example.invalid/qa',{method:'POST',
  headers:{Authorization:opts.bearer||'Bearer '+WEBHOOK,
   'content-type':'application/json'},
  body:JSON.stringify(body)});
};
test('authenticated ordinary office chat and known status are ACKed with zero DB cost',async()=>{
 for(const [type,chat] of [
  ['textMessage',CHAT],['extendedTextMessage','972509999999@c.us'],
  ['imageMessage','972509999999@c.us'],['statusInstanceChanged',CHAT]
 ]){
  const mock=sdk(control);let clientBuilt=0,staged=0;
  const request=notification({
   chat,type:type==='statusInstanceChanged'?type:'incomingMessageReceived',
   messageData:{typeMessage:type,textMessageData:{textMessage:'manual'}}
  });
  const response=await handleGreenButtonQaWebhook(request,{
   env:env(),makeClient:()=>{clientBuilt++;return mock.client;},
   recalculateEventStatus:async()=>{throw Error('No mutation allowed');},
   stage:async()=>{staged++;throw Error('Never stage ordinary chat');}
  });
  assert.equal(response.httpStatus,200,type);
  assert.equal(response.body.received,true);
  assert.equal(response.noProviderCalls,true);
  assert.equal(clientBuilt,0);
  assert.equal(staged,0);
  assert.deepEqual(mock.counts,{reads:0,flagReads:0,dbWrites:0});
 }
});
test('authenticated out-of-scope beta click uses only a bounded pilot-scope read and never mutates suppliers',async()=>{
 const mock=sdk(control);let built=0;
 const response=await handleGreenButtonQaWebhook(notification({
  chat:'972509999999@c.us',
  messageData:{typeMessage:'interactiveButtonsResponse',
   interactiveButtonsResponse:{selectedId:'wa1_SYNTHETIC_UNKNOWN',
    stanzaId:'3EB0ORIGINAL_OUTSIDE_QA'}}
 }),{env:env(),makeClient:()=>{built++;return mock.client;},
  recalculateEventStatus:async()=>{throw Error('Never mutate foreign sender');},
  stage:async()=>{throw Error('Never process foreign sender');}});
 assert.equal(response.httpStatus,200);
 assert.equal(built,1,'one scoped control read is needed to exclude a signed real pilot');
 assert.deepEqual(mock.counts,{reads:1,flagReads:0,dbWrites:0});
});
test('forged account, wrong bearer and bad JSON never ACK or touch DB',async()=>{
 for(const [request,expected] of [
  [notification({instance:'9903183014'}),422],
  [notification({bearer:'Bearer wrong-provider-token'}),401],
  [new Request('https://example.invalid/qa',{method:'POST',
   headers:{Authorization:'Bearer '+WEBHOOK,'content-type':'application/json'},
   body:'{this is intentionally invalid JSON over twenty bytes'}),400]
 ]){
  let clientBuilt=0;
  const response=await handleGreenButtonQaWebhook(request,{
   env:env(),makeClient:()=>{clientBuilt++;throw Error('No DB on bad input');},
   recalculateEventStatus:async()=>{throw Error('No mutation');}
  });
  assert.equal(response.httpStatus,expected);
  assert.equal(response.body.received,false);
  assert.equal(clientBuilt,0);
 }
});
test('passive receiver BEFORE Beta verification ACKs authenticated manual messages but NEVER business buttons',async()=>{
 const passive=env({GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'',
  GREEN_BUTTONS_QA_SEND_ENABLED:''});
 const mock=sdk({...control,interactive_outbound_live_enabled:false},null);
 let built=0;
 const options={
  env:passive,
  makeClient:()=>{built++;return mock.client;},
  recalculateEventStatus:async()=>{throw Error('No provider proof, no supplier mutation');},
  stage:async()=>{throw Error('No provider proof, no signed click processing');}
 };
 const ordinary=await handleGreenButtonQaWebhook(notification(),options);
 assert.equal(ordinary.httpStatus,200);
 assert.equal(ordinary.body.received,true);
 const unverifiedClick=await handleGreenButtonQaWebhook(createRequest(),options);
 assert.equal(unverifiedClick.httpStatus,503);
 assert.equal(unverifiedClick.body.received,false);
 assert.equal(built,0,'no database access before Beta verified');
 assert.deepEqual(mock.counts,{reads:0,flagReads:0,dbWrites:0});
 assert.equal(trustedGreenButtonQaInboundConfig(control,passive,true),null);
});
test('signed callbacks remain usable with outbound owner flag OFF and scoped V2 ON, global V2 OFF',async()=>{
 const mock=sdk({...control,interactive_outbound_live_enabled:false},null);
 let staged=0;
 const response=await handleGreenButtonQaWebhook(createRequest(),{
  env:env({GREEN_BUTTONS_QA_SEND_ENABLED:''}),
  makeClient:()=>mock.client,
  recalculateEventStatus:async()=>null,
  stage:async()=>{staged++;return {stage:'processed',result:'applied',reason:'applied'};}
 });
 assert.equal(response.httpStatus,200);
 assert.equal(response.body.received,true);
 assert.equal(staged,1);
 assert.deepEqual(mock.counts,{reads:1,flagReads:1,dbWrites:0});
});
test('single chat QA is disabled by default and never activates from saved policy alone',()=>{
 const actual=trustedGreenButtonQaConfig({
  ...control,interactive_outbound_live_enabled:false},env(),true);
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
  assert.equal(trustedGreenButtonQaConfig(control,env({[key]:value}),true),null,key);
 }
 assert.equal(trustedGreenButtonQaConfig({
  ...control,interactive_assignment_green_policy_json:null
 },env(),true),null,'missing owner draft cannot activate beta sending');
 const report=greenButtonQaSafeSummary(control,env(),true,0);
 assert.equal(report.readyForQa,true);
 assert.equal(greenButtonQaSafeSummary(control,env(),true,2).readyForQa,false,
  'unrelated global V2 work blocks pilot readiness');
 assert.equal(trustedGreenButtonQaConfig(control,env()),null,
  'even full Green secrets cannot turn on buttons while V2 flag is false');
 assert.equal(greenButtonQaSafeSummary(control,env(),false,0).readyForQa,false,
  'missing durable v2 assignment mode must not claim readiness');
 assert.equal(JSON.stringify(report).includes(CHAT),false);
 assert.equal(JSON.stringify(report).includes(SIGNING),false);
});
test('first Green Beta attempt is explicitly owner-approved but NEVER misreported as verified capability',()=>{
 const probe=env({GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'probe_authorized',
  GREEN_BUTTONS_QA_BETA_PROBE_ENABLED:'enabled'});
 const cfg=trustedGreenButtonQaConfig(control,probe,true);
 assert.ok(cfg);
 assert.equal(cfg.accountCapabilityVerified,false);
 assert.equal(cfg.qaBetaProbeApproved,true);
 assert.equal(cfg.qaEventServiceId,'service-123');
 assert.equal(cfg.qaSupplierId,'supplier-123');
 const summary=greenButtonQaSafeSummary(control,probe,true,0);
 assert.equal(summary.checks.find(x=>x.key==='provider_beta_verified').ready,false);
 assert.equal(summary.checks.find(x=>x.key==='one_message_beta_probe_approved').ready,true);
 assert.equal(trustedGreenButtonQaConfig(control,
  env({GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'probe_authorized'}),true),null);
 assert.equal(trustedGreenButtonQaConfig(control,
  env({GREEN_BUTTONS_QA_BETA_PROBE_ENABLED:'enabled'}),true).accountCapabilityVerified,true);
 assert.equal(trustedGreenButtonQaConfig(control,
  env({GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'probe_authorized',
   GREEN_BUTTONS_QA_BETA_PROBE_ENABLED:'enabled',
   GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:''}),true),null);
});
test('only trusted full suite yields two reply buttons and contact-office URL mode',()=>{
 const output=trustedGreenButtonQaConfig(control,env(),true);
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
 for(const setting of bad)assert.equal(trustedGreenButtonQaConfig(setting,env(),true),null);
});
test('HTTP QA endpoint is inert without every independent env approval: no DB or provider',async()=>{
 for(const [key,value] of [
  ['GREEN_BUTTONS_QA_INBOUND_ENABLED',''],
  ['GREEN_BUTTONS_QA_ACCOUNT_VERIFIED',''],
  ['GREEN_BUTTONS_QA_OWNER_APPROVED','']
 ]){
  const db=sdk(control);
  const result=await handleGreenButtonQaWebhook(createRequest(),{
   env:env({[key]:value}),makeClient:()=>db.client,
   recalculateEventStatus:async()=>{throw Error('never called')}
  });
  assert.equal(result.httpStatus,key==='GREEN_BUTTONS_QA_ACCOUNT_VERIFIED'?503:404,key);
  assert.equal(db.counts.reads,0,key);
 }
});
test('rollback stops NEW button sends but inbound remains available for previously sent signed QA buttons',async()=>{
 const stopped=env({GREEN_BUTTONS_QA_SEND_ENABLED:''});
 assert.equal(trustedGreenButtonQaConfig(control,stopped,true),null);
 const inbound=trustedGreenButtonQaInboundConfig(control,stopped,true);
 assert.equal(inbound.enabled,true);
 assert.equal(inbound.qaChatId,CHAT);
 assert.equal(inbound.qaEventServiceId,'service-123');
 assert.equal(inbound.qaSupplierId,'supplier-123');
 assert.equal(greenButtonQaSafeSummary(control,stopped,true,0).readyForQa,false);
 assert.equal(greenButtonQaSafeSummary(control,stopped,true,0).receivingExistingQaRepliesAvailable,true);
 const db=sdk({...control,interactive_outbound_live_enabled:false});let staged=0;
 const response=await handleGreenButtonQaWebhook(createRequest(),{
  env:stopped,makeClient:()=>db.client,
  recalculateEventStatus:async()=>null,
  stage:async(_request,opts)=>{
   staged++;
   assert.equal(opts.qaChatId,CHAT);
   return {stage:'processed',result:'applied',reason:'applied'};
  }
 });
 assert.equal(staged,1);
 assert.equal(response.httpStatus,200);
 assert.equal(db.counts.reads,1);
 assert.equal(db.counts.flagReads,1);
});
test('QA OFF still requires ONE bounded control read to distinguish previously enabled production replies, never supplier/business data',async()=>{
 for(const flag of ['false',null,'duplicate']){
  const db=sdk(control,flag);
  let staged=0;
  const r=await handleGreenButtonQaWebhook(createRequest(),{
   env:env({GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:''}),makeClient:()=>db.client,
   recalculateEventStatus:async()=>{throw Error('must not change status')},
   stage:async()=>{staged++;throw Error('must not enter coordinator')}
  });
  assert.equal(r.httpStatus,404);
  assert.equal(r.body.received,false);
  assert.equal(db.counts.reads,1,'trusted production history is stored on the existing singleton queue control');
  assert.equal(db.counts.flagReads,0,'no unrelated V2 feature-flag scan');
  assert.equal(db.counts.dbWrites,0);
  assert.equal(staged,0);
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
test('missing policy draft prevents callback even with independently armed inbound',async()=>{
 for(const variant of [
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
test('QA webhook forwards a previous exact QA service only as inbound-only scope (never changes sender scope)',async()=>{
 const db=sdk(control);
 let staged=0;
 const output=await handleGreenButtonQaWebhook(createRequest(),{
  env:env({GREEN_BUTTONS_QA_EVENT_SERVICE_ID:'service-current-qa',
   GREEN_BUTTONS_QA_PREVIOUS_EVENT_SERVICE_ID:'service-123'}),
  makeClient:()=>db.client,recalculateEventStatus:async()=>null,
  stage:async(_req,opts)=>{
   staged++;
   assert.equal(opts.qaEventServiceId,'service-current-qa');
   assert.equal(opts.qaPreviousEventServiceId,'service-123');
   assert.equal(opts.qaSupplierId,'supplier-123');
   assert.equal(opts.qaChatId,CHAT);
   return {stage:'processed',result:'rejected',reason:'business_conflict'};
  }
 });
 assert.equal(output.httpStatus,200);
 assert.equal(staged,1);
 assert.equal(db.counts.reads,1);
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
