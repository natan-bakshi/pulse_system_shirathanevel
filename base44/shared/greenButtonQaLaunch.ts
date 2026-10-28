// Shirat HaNevel: narrow GREEN beta button QA activation wiring.
// NOT an automatic rollout. A saved DRAFT cannot activate anything.
// ALL four independent server environment gates + the owner-only queue
// control flag must be enabled, with exactly one allowed private test chat.
// Defaults OFF, no database/provider calls in this function.
// The only allowed mode before full QA is a 2-reply + 1-office-URL message.
import {parseSavedWhatsAppInteractivePolicy}
 from './whatsappInteractiveSettingsStore.ts';
import {validateWhatsAppInteractivePolicy}
 from './whatsappInteractivePolicy.ts';
import type {TrustedGreenInteractiveConfig}
 from './whatsappInteractiveWorkerBridge.ts';
const INSTANCE=/^[0-9]{5,20}$/;
const ENTITY=/^[A-Za-z0-9_-]{3,128}$/;
const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const SECRET_MIN=32;
const exactActions=['assignment_approve','assignment_reject','contact_office'];
const get=(env:(k:string)=>string|undefined,k:string)=>String(env(k)||'');
function trustedGreenButtonQaConfigForMode(control:any,
 env:(key:string)=>string|undefined,durableAssignmentIntentEnabled:boolean,
 requireSendEnabled:boolean):TrustedGreenInteractiveConfig|null{
 // No action when disabled, including no access to secrets and draft.
 if(durableAssignmentIntentEnabled!==true||
  control?.interactive_outbound_live_enabled!==true||
  (requireSendEnabled&&get(env,'GREEN_BUTTONS_QA_SEND_ENABLED')!=='enabled')||
  get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')!=='enabled'||
  get(env,'GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')!=='verified'||
  get(env,'GREEN_BUTTONS_QA_OWNER_APPROVED')!=='approved')
  return null;
 const senderAccountId=get(env,'GREEN_API_INSTANCE_ID');
 const signingSecret=get(env,'WHATSAPP_INTERACTIVE_SIGNING_SECRET');
 const webhookSecret=get(env,'GREEN_API_WEBHOOK_TOKEN');
 const target=get(env,'GREEN_BUTTONS_QA_ALLOWED_CHAT');
 const serviceId=get(env,'GREEN_BUTTONS_QA_EVENT_SERVICE_ID');
 const supplierId=get(env,'GREEN_BUTTONS_QA_SUPPLIER_ID');
 const token=get(env,'GREEN_API_TOKEN');
 if(!INSTANCE.test(senderAccountId)||!PRIVATE.test(target)||
  !ENTITY.test(serviceId)||!ENTITY.test(supplierId)||
  signingSecret.length<SECRET_MIN||webhookSecret.length<24||
  token.length<24||signingSecret===webhookSecret||
  target===senderAccountId+'@c.us')return null;
 // Malformed draft must never crash the central queue worker. Even when an
 // owner accidentally enables a QA flag, missing settings mean NO beta send.
 let draft:any,policy:any;
 try{
  draft=parseSavedWhatsAppInteractivePolicy(control,'green');
  if(!draft.configured||draft.corrupt||!draft.setting.officeNumber)
   return null;
  // Persistent policy remains disabled; only trusted QA code makes a COPY.
  policy=validateWhatsAppInteractivePolicy({
   ...draft.setting.policy,enabled:true
  });
 }catch{return null;}
 if(policy.buttons.length!==3||
  !exactActions.every(action=>
   policy.buttons.some(button=>button.action===action)))return null;
 const officeNumber=draft.setting.officeNumber;
 if(!/^[1-9][0-9]{7,14}$/.test(officeNumber))return null;
 return {
  enabled:true,accountCapabilityVerified:true,capability:'mixed_url',
  senderAccountId,signingSecret,
  policy,officeNumber,officeLabel:policy.buttons.find(
   button=>button.action==='contact_office')!.label,
  officeContextMode:'reference',
  qaChatId:target,qaEventServiceId:serviceId,qaSupplierId:supplierId
 };
}
export function trustedGreenButtonQaConfig(control:any,
 env:(key:string)=>string|undefined,durableAssignmentIntentEnabled=false){
 return trustedGreenButtonQaConfigForMode(control,env,
  durableAssignmentIntentEnabled,true);
}
export function trustedGreenButtonQaInboundConfig(control:any,
 env:(key:string)=>string|undefined,durableAssignmentIntentEnabled=false){
 // Send-new may be OFF while old accepted interactive messages still need
 // authenticated supplier responses; all other controls remain mandatory.
 return trustedGreenButtonQaConfigForMode(control,env,
  durableAssignmentIntentEnabled,false);
}
// Safe, sanitized readiness metadata for admin UI: no secrets or phone.
// Not used to authorize sending or handling real callbacks.
export function greenButtonQaSafeSummary(control:any,env:(key:string)=>string|undefined,
 assignmentIntentEnabled=false,otherPendingCount:null|number=null){
 const config=trustedGreenButtonQaConfig(control,env,assignmentIntentEnabled);
 const inbound=trustedGreenButtonQaInboundConfig(control,env,assignmentIntentEnabled);
 const draft=parseSavedWhatsAppInteractivePolicy(control,'green');
 return {mode:'single_chat_qa',readyForQa:!!config&&assignmentIntentEnabled&&
  otherPendingCount===0,
  receivingExistingQaRepliesAvailable:!!inbound,
  webhookProvisioningOwnerActionAvailable:
   get(env,'GREEN_BUTTONS_QA_SETTINGS_WRITE_ENABLED')==='enabled'&&
   get(env,'GREEN_BUTTONS_QA_OWNER_APPROVED')==='approved'&&
   get(env,'GREEN_BUTTONS_QA_SCOPED_V2_ENABLED')==='enabled'&&
   get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')==='enabled'&&
   get(env,'GREEN_BUTTONS_QA_SEND_ENABLED')!=='enabled'&&
   control?.interactive_outbound_live_enabled!==true,
  unrelatedV2PendingPresent:otherPendingCount===null?'not_checked':otherPendingCount>0,
  unrelatedV2PendingAuditIsBounded:true,
  creationActionConfigured:!!config&&otherPendingCount===0&&
   ENTITY.test(get(env,'GREEN_BUTTONS_QA_EVENT_ID'))&&
   get(env,'GREEN_BUTTONS_QA_CREATE_ENABLED')==='enabled',
  checks:[
   {key:'qa_global_v2_backlog_clear',ready:otherPendingCount===0},
   {key:'durable_assignment_intent',ready:assignmentIntentEnabled===true},
   {key:'owner_queue_gate',ready:control?.interactive_outbound_live_enabled===true},
   {key:'send_env_gate',ready:get(env,'GREEN_BUTTONS_QA_SEND_ENABLED')==='enabled'},
   {key:'inbound_env_gate',ready:get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')==='enabled'},
   {key:'owner_env_gate',ready:get(env,'GREEN_BUTTONS_QA_OWNER_APPROVED')==='approved'},
   {key:'provider_beta_verified',ready:get(env,'GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')==='verified'},
   {key:'one_qa_chat',ready:PRIVATE.test(get(env,'GREEN_BUTTONS_QA_ALLOWED_CHAT'))},
   {key:'one_qa_assignment',ready:
     ENTITY.test(get(env,'GREEN_BUTTONS_QA_EVENT_SERVICE_ID'))&&
     ENTITY.test(get(env,'GREEN_BUTTONS_QA_SUPPLIER_ID'))},
   {key:'qa_event_approved',ready:ENTITY.test(get(env,'GREEN_BUTTONS_QA_EVENT_ID'))},
   {key:'green_credentials',ready:INSTANCE.test(get(env,'GREEN_API_INSTANCE_ID'))&&
     get(env,'GREEN_API_TOKEN').length>=24},
   {key:'signing_secret',ready:get(env,'WHATSAPP_INTERACTIVE_SIGNING_SECRET').length>=32},
   {key:'webhook_bearer',ready:get(env,'GREEN_API_WEBHOOK_TOKEN').length>=24},
   {key:'office_draft_saved',ready:draft.configured&&!draft.corrupt&&
     !!draft.setting.officeNumber&&draft.setting.policy.buttons.length===3}
  ],
  liveButtonsSentByThisCheck:false,
  restrictedToOnePrivateChat:true,
  requiresGreenWebhookRoutingReview:true,
  realCallbackRoundTripProven:false,
  noProviderCalls:true,noMessageSends:true};
}
