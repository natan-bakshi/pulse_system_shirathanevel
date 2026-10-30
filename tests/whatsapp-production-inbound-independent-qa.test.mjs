import test from 'node:test';
import assert from 'node:assert/strict';
import {
 greenProductionPassiveInboundReady,greenButtonQaPassiveInboundReady,
 trustedGreenAssignmentProductionConfig
} from '../base44/shared/greenButtonQaLaunch.ts';
import {handleGreenButtonQaWebhook} from '../base44/shared/greenButtonQaWebhookHandler.ts';
const bearer='offline-webhook-bearer-not-production-0123456789';
const settings={
 GREEN_BUTTONS_QA_OWNER_APPROVED:'approved',
 GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'verified',
 GREEN_BUTTONS_QA_SEND_ENABLED:'',
 GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:'',
 GREEN_BUTTONS_QA_EVENT_ID:'',
 GREEN_BUTTONS_QA_EVENT_SERVICE_ID:'',
 GREEN_BUTTONS_QA_SUPPLIER_ID:'',
 GREEN_BUTTONS_QA_ALLOWED_CHAT:'',
 GREEN_API_INSTANCE_ID:'9903183013',
 GREEN_API_TOKEN:'offline-green-api-key-01234567890123456789',
 GREEN_API_WEBHOOK_TOKEN:bearer,
 WHATSAPP_INTERACTIVE_SIGNING_SECRET:'offline-prod-signing-secret-012345678901234567890'
};
const env=k=>settings[k]||'';
const control={
 id:'global-queue-control',control_key:'global',enabled:false,paused:true,
 interactive_outbound_live_enabled:false,
 interactive_assignment_production_enabled:false,
 interactive_assignment_production_ever_enabled:true,
 interactive_assignment_green_policy_json:JSON.stringify({
  companyId:'shirat_hanevel',provider:'green',messageKind:'assignment',
  version:1,officeNumber:'972551111111',
  policy:{enabled:false,quoteAssignment:false,buttons:[
   {action:'assignment_approve',label:'מאשר'},
   {action:'assignment_reject',label:'דוחה'},
   {action:'contact_office',label:'למשרד'}
  ]}
 })
};
test('signed historical real-supplier reply is allowed after send OFF and removal of obsolete QA pins',()=>{
 assert.equal(greenButtonQaPassiveInboundReady(env),false);
 assert.equal(greenProductionPassiveInboundReady(env),true);
 assert.equal(trustedGreenAssignmentProductionConfig(control,env,'outbound'),null);
 assert.ok(trustedGreenAssignmentProductionConfig(control,env,'inbound'),
  'inbound must not be disabled by queue paused, outbound OFF or absent QA pins');
});
test('authenticated real supplier button is routed to the existing verifier with no QA-only recipient clamp',async()=>{
 const chat='972521234567@c.us',instance='9903183013';
 const raw={
  typeWebhook:'incomingMessageReceived',
  idMessage:'C0CD39BB261589D5C98412D255CD00AB',
  timestamp:Math.floor(Date.now()/1000),
  instanceData:{idInstance:Number(instance),typeInstance:'whatsapp'},
  senderData:{chatId:chat,sender:chat},
  messageData:{typeMessage:'templateButtonsReplyMessage',
   templateButtonReplyMessage:{stanzaId:'3EB0ORIGINALASSIGNMENT0123456789',
    selectedId:'wa1_ABCDEFGHIJKLMNOPQRSTUV',selectedDisplayText:'מאשר'}}
 };
 const request=new Request('https://mock.test/green-buttons',{
  method:'POST',headers:{Authorization:'Bearer '+bearer,
   'content-type':'application/json'},body:JSON.stringify(raw)
 });
 let admitted=null,reads=0;
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{filter:async()=>{reads++;return [control];}}
 }}};
 const response=await handleGreenButtonQaWebhook(request,{
  env,makeClient:()=>client,
  recalculateEventStatus:async()=>{throw Error('unverified mock must not mutate');},
  stage:async(_req,details)=>{
   admitted=details;
   return {stage:'processed',result:'applied',
    terminalReceiptVerified:true,receiptState:'applied',
    providerCalls:0,supplierWritesAuthorized:false};
  }
 });
 assert.ok(admitted,'existing trusted callback verifier must run');
 assert.equal(admitted.expectedInstanceId,instance);
 assert.equal(admitted.qaChatId,undefined);
 assert.equal(admitted.qaEventServiceId,undefined);
 assert.equal(admitted.qaSupplierId,undefined);
 assert.equal(reads,1);
 assert.equal(response.noProviderCalls,true);
});
test('production passive route refuses changed verified account, bearer or owner consent',()=>{
 for(const key of [
  'GREEN_BUTTONS_QA_OWNER_APPROVED','GREEN_BUTTONS_QA_INBOUND_ENABLED',
  'GREEN_BUTTONS_QA_ACCOUNT_VERIFIED','GREEN_API_INSTANCE_ID',
  'GREEN_API_TOKEN','GREEN_API_WEBHOOK_TOKEN',
  'WHATSAPP_INTERACTIVE_SIGNING_SECRET'
 ]){
  const bad=k=>k===key?'':env(k);
  assert.equal(greenProductionPassiveInboundReady(bad),false,key);
 }
});
