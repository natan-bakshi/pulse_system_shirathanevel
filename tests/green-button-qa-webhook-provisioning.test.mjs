import test from 'node:test';
import assert from 'node:assert/strict';
import {
 applyOneGreenButtonQaWebhookProvisioning,greenButtonQaWebhookProvisioningGuard,
 GREEN_BUTTON_QA_PROVISIONING_KEY
} from '../base44/shared/greenButtonQaWebhookProvisioning.ts';
const SERVICE='qa-service-123456',EVENT='qa-event-123456',SUPPLIER='qa-supplier-123456';
const INSTANCE='9903183013';
const TOKEN='SYNTHETIC-ONLY-GREEN-API-TOKEN-123456789';
const BEARER='SYNTHETIC-WEBHOOK-BEARER-NOT-REAL-123456789';
const SIGNING='SYNTHETIC-SIGNING-KEY-NOT-REAL-123456789';
const constants={
 GREEN_BUTTONS_QA_SETTINGS_WRITE_ENABLED:'enabled',
 GREEN_BUTTONS_QA_OWNER_APPROVED:'approved',
 GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:'enabled',
 GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_SEND_ENABLED:'',
 GREEN_BUTTONS_QA_EVENT_ID:EVENT,
 GREEN_BUTTONS_QA_EVENT_SERVICE_ID:SERVICE,
 GREEN_BUTTONS_QA_SUPPLIER_ID:SUPPLIER,
 GREEN_BUTTONS_QA_ALLOWED_CHAT:'972501234567@c.us',
 GREEN_API_INSTANCE_ID:INSTANCE,
 GREEN_API_TOKEN:TOKEN,
 GREEN_API_WEBHOOK_TOKEN:BEARER,
 WHATSAPP_INTERACTIVE_SIGNING_SECRET:SIGNING,
 GREEN_API_URL:'https://api.green-api.com'
};
const confirm='I_APPROVE_ONE_GREEN_REBOOT_FOR_BUTTONS';
const env=(x={})=>k=>({...constants,...x})[k]||'';
const noWebhooks=Object.fromEntries(
 ['incomingWebhook','outgoingWebhook','outgoingMessageWebhook',
 'outgoingAPIMessageWebhook','stateWebhook','deviceWebhook',
 'pollMessageWebhook','editedMessageWebhook','deletedMessageWebhook',
 'incomingCallWebhook','incomingMessageStatusWebhook'].map(k=>[k,'no'])
);
function response(data,status=200){
 return {ok:status===200,status,headers:{get:()=>null},
  text:async()=>JSON.stringify(data)};
}
function fixture(opts={}){
 const calls={get:0,post:0,cas:0,control:0,lockReads:0};
 const singleton={id:'pilot-one-shot-lock-123',setting_key:GREEN_BUTTON_QA_PROVISIONING_KEY,
  setting_value:'ready'};
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{
   filter:async()=>{calls.control++;return [{
    id:'global-control-123',interactive_outbound_live_enabled:false,
    enabled:true,paused:false
   }]}
  },
  AppSettings:{
   filter:async()=>{calls.lockReads++;return [singleton]},
   updateMany:async(query,update)=>{
    calls.cas++;
    if(singleton.id!==query.id||singleton.setting_key!==query.setting_key||
      singleton.setting_value!==query.setting_value)return{updated:0};
    singleton.setting_value=update.$set.setting_value;
    return{updated:1};
   }
  }
 }}};
 const fetchFn=async(url,init)=>{
  if(init.method==='GET'){
   calls.get++;
   assert.equal(init.redirect,'manual');
   if(opts.getFailure)throw Error('SYNTHETIC GET failure - contains no real token');
   return response({
    webhookUrl:opts.existingWebhook?'https://existing.example.invalid/webhook':'',
    webhookUrlToken:'',
    ...noWebhooks,...opts.providerSettings
   });
  }
  assert.equal(init.method,'POST');
  calls.post++;
  assert.equal(init.redirect,'manual');
  assert.match(url,/^https:\/\/api\.green-api\.com\/waInstance[0-9]+\/setSettings\//);
  const body=JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(),
   ['incomingWebhook','webhookUrl','webhookUrlToken'].sort(),
   'only 3 Green fields may be set');
  assert.equal(body.incomingWebhook,'yes');
  assert.equal(body.webhookUrlToken,BEARER);
  assert.match(body.webhookUrl,/\/functions\/greenAssignmentButtonQaWebhook$/);
  assert.equal(body.webhookUrl.startsWith('https://pulse-system.base44.app/'),true);
  assert.equal(body.delaySendMessagesMilliseconds,undefined);
  if(opts.postFailure)throw Error('SYNTHETIC provider accepted but connection lost');
  if(opts.postBadResponse)return response({saveSettings:false});
  return response({saveSettings:true});
 };
 return{client,calls,singleton,fetchFn};
}
test('one owner action: one GetSettings, one narrow SetSettings, one CAS claim, no message send',async()=>{
 const f=fixture();
 const out=await applyOneGreenButtonQaWebhookProvisioning(f.client,{
  env:env(),confirmation:confirm,fetchFn:f.fetchFn
 });
 assert.equal(out.success,true);
 assert.equal(out.providerAccepted,true);
 assert.equal(out.realCallbackNotProven,true);
 assert.equal(out.buttonCapabilityNotProven,true);
 assert.equal(out.providerSettingWrites,1);
 assert.equal(out.whatsappMessagesSent,0);
 assert.equal(out.requiresReadOnlyVerificationAfterReboot,true);
 assert.deepEqual(f.calls,{get:1,post:1,cas:2,control:1,lockReads:1});
 assert.equal(f.singleton.setting_value,'provider_accepted');
 const output=JSON.stringify(out);
 for(const sensitive of [TOKEN,BEARER,SIGNING,INSTANCE,'972501234567',
  'pulse-system.base44.app',SERVICE,SUPPLIER,EVENT]){
  assert.equal(output.includes(sensitive),false);
 }
});
test('missing owner-specific gate, confirmation or QA scope means ZERO provider calls and ZERO writes',async()=>{
 const scenarios=[
  {e:{GREEN_BUTTONS_QA_SETTINGS_WRITE_ENABLED:''}},
  {e:{GREEN_BUTTONS_QA_OWNER_APPROVED:''}},
  {e:{GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:''}},
  {e:{GREEN_BUTTONS_QA_INBOUND_ENABLED:''}},
  {e:{GREEN_BUTTONS_QA_SEND_ENABLED:'enabled'}},
  {e:{GREEN_API_TOKEN:'short'}},
  {e:{GREEN_API_URL:'https://bad-webhook.example.invalid'}},
  {e:{GREEN_BUTTONS_QA_ALLOWED_CHAT:'12345@g.us'}},
  {confirmation:'OTHER'},
  {control:{interactive_outbound_live_enabled:true}}
 ];
 for(const s of scenarios){
  const f=fixture();
  if(s.control){
   const actual=f.client.asServiceRole.entities.WhatsAppQueueControl;
   actual.filter=async()=>[s.control];
  }
  await assert.rejects(applyOneGreenButtonQaWebhookProvisioning(f.client,{
   env:env(s.e||{}),confirmation:s.confirmation||confirm,fetchFn:f.fetchFn
  }),err=>!!err.code);
  assert.equal(f.calls.get,0);
  assert.equal(f.calls.post,0);
  assert.equal(f.calls.cas,0);
 }
 assert.equal(greenButtonQaWebhookProvisioningGuard(env(),confirm,{
  interactive_outbound_live_enabled:false
 }).ready,true);
});
test('pre-existing provider webhook or any active category blocks reboot and preserves one-shot',async()=>{
 for(const opts of [{existingWebhook:true},
  {providerSettings:{outgoingAPIMessageWebhook:'yes'}},
  {providerSettings:{incomingWebhook:'unknown'}},
  {providerSettings:{editedMessageWebhook:'unknown'}}]){
  const f=fixture(opts);
  await assert.rejects(applyOneGreenButtonQaWebhookProvisioning(f.client,{
   env:env(),confirmation:confirm,fetchFn:f.fetchFn
  }),err=>err.code==='qa_existing_green_configuration_requires_review');
  assert.equal(f.calls.get,1);
  assert.equal(f.calls.post,0);
  assert.equal(f.calls.cas,0);
  assert.equal(f.singleton.setting_value,'ready');
 }
});
test('provider GET failure does not claim or POST, and never reveals raw provider exception',async()=>{
 const f=fixture({getFailure:true});
 await assert.rejects(applyOneGreenButtonQaWebhookProvisioning(f.client,{
  env:env(),confirmation:confirm,fetchFn:f.fetchFn
 }),err=>{
  assert.equal(err.code,'qa_provider_settings_read_failed_no_write');
  assert.equal(JSON.stringify(err).includes('SYNTHETIC GET failure'),false);
  return true;
 });
 assert.deepEqual({get:f.calls.get,post:f.calls.post,cas:f.calls.cas},
  {get:1,post:0,cas:0});
});
test('concurrent owner actions: both may GET but ONLY ONE SetSettings POST after exclusive claim',async()=>{
 const f=fixture();
 const two=await Promise.allSettled([0,1].map(()=>applyOneGreenButtonQaWebhookProvisioning(
  f.client,{env:env(),confirmation:confirm,fetchFn:f.fetchFn}
 )));
 assert.equal(two.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(two.filter(x=>x.status==='rejected').length,1);
 assert.equal(f.calls.post,1);
 assert.equal(f.singleton.setting_value,'provider_accepted');
});
test('unknown provider POST outcome burns one-shot and NEVER automatically repeats a reboot',async()=>{
 for(const opts of [{postFailure:true},{postBadResponse:true}]){
  const f=fixture(opts);
  await assert.rejects(applyOneGreenButtonQaWebhookProvisioning(f.client,{
   env:env(),confirmation:confirm,fetchFn:f.fetchFn
  }),err=>err.code==='qa_provisioning_post_outcome_requires_review');
  assert.equal(f.calls.get,1);
  assert.equal(f.calls.post,1);
  assert.equal(f.singleton.setting_value,'attempted');
  await assert.rejects(applyOneGreenButtonQaWebhookProvisioning(f.client,{
   env:env(),confirmation:confirm,fetchFn:f.fetchFn
  }),err=>err.code==='qa_provisioning_one_shot_unavailable');
  assert.equal(f.calls.post,1);
 }
});
test('bad timeout is detected BEFORE claiming one-shot and no provider request is made',async()=>{
 const f=fixture();
 await assert.rejects(applyOneGreenButtonQaWebhookProvisioning(f.client,{
  env:env(),confirmation:confirm,fetchFn:f.fetchFn,timeoutMs:1
 }),err=>err.code==='qa_provisioning_timeout_invalid_no_write');
 assert.equal(f.calls.get,0);
 assert.equal(f.calls.cas,0);
 assert.equal(f.calls.post,0);
});
