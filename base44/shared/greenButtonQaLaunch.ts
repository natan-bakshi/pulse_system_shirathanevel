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
import {SUPPLIER_PORTAL_URL} from './supplierPortalLink.ts';
import {
 LEGACY_GREEN_PILOT_FIELD,verifyLegacyGreenPilotState,
 outboundLegacyPilotTarget,inboundLegacyPilotTarget
} from './legacyGreenPilotScope.ts';
const INSTANCE=/^[0-9]{5,20}$/;
const ENTITY=/^[A-Za-z0-9_-]{3,128}$/;
const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const SECRET_MIN=32;
const exactActions=['assignment_approve','assignment_reject','contact_office'];
const get=(env:(k:string)=>string|undefined,k:string)=>String(env(k)||'');
// Passive receiver may ACK known ordinary Green events BEFORE the first
// beta button proof. No supplier mutation or button acceptance in this mode.
// Distinct from the send gate and from proof of provider beta support.
export function greenButtonQaPassiveInboundReady(
 env:(key:string)=>string|undefined):boolean{
 const signing=get(env,'WHATSAPP_INTERACTIVE_SIGNING_SECRET');
 const bearer=get(env,'GREEN_API_WEBHOOK_TOKEN');
 const id=get(env,'GREEN_API_INSTANCE_ID');
 const token=get(env,'GREEN_API_TOKEN');
 return get(env,'GREEN_BUTTONS_QA_OWNER_APPROVED')==='approved'&&
  get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')==='enabled'&&
  get(env,'GREEN_BUTTONS_QA_SCOPED_V2_ENABLED')==='enabled'&&
  INSTANCE.test(id)&&token.length>=24&&
  ENTITY.test(get(env,'GREEN_BUTTONS_QA_EVENT_ID'))&&
  ENTITY.test(get(env,'GREEN_BUTTONS_QA_EVENT_SERVICE_ID'))&&
  ENTITY.test(get(env,'GREEN_BUTTONS_QA_SUPPLIER_ID'))&&
  PRIVATE.test(get(env,'GREEN_BUTTONS_QA_ALLOWED_CHAT'))&&
  signing.length>=SECRET_MIN&&bearer.length>=24&&signing!==bearer;
}
function trustedGreenButtonQaConfigForMode(control:any,
 env:(key:string)=>string|undefined,durableAssignmentIntentEnabled:boolean,
 requireSendEnabled:boolean):TrustedGreenInteractiveConfig|null{
 // A single owner-approved Beta PROBE may precede real provider verification.
 // This is NOT capability proof, never enables any other service/chat and
 // remains fenced by independent SEND, inbound, owner, control and V2 gates.
 const betaProof=get(env,'GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')==='verified';
 const betaProbe=get(env,'GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')==='probe_authorized'&&
  get(env,'GREEN_BUTTONS_QA_BETA_PROBE_ENABLED')==='enabled'&&
  get(env,'GREEN_BUTTONS_QA_SCOPED_V2_ENABLED')==='enabled';
 if(durableAssignmentIntentEnabled!==true||
  (requireSendEnabled&&control?.interactive_outbound_live_enabled!==true)||
  (requireSendEnabled&&get(env,'GREEN_BUTTONS_QA_SEND_ENABLED')!=='enabled')||
  get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')!=='enabled'||
  (!betaProof&&!betaProbe)||
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
  enabled:true,accountCapabilityVerified:betaProof,
  ...(betaProbe?{qaBetaProbeApproved:true as const}:{}),
  capability:'mixed_url',
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
// Production setup reuses the already verified Green credentials, signed
// buttons, queue policy, and durable receipt processing. Scope is broadened
// ONLY by the owner-controlled queue flag. Inbound stays available after OFF.
export function trustedGreenAssignmentProductionConfig(control:any,
 env:(key:string)=>string|undefined,mode:'outbound'|'inbound'):TrustedGreenInteractiveConfig|null{
 // Production is NOT a single-chat QA experiment. Requiring QA event/chat/
 // supplier pins here silently downgraded genuine new assignments to text
 // after the owner switched on production. Keep every verified security gate
 // but derive no production authorization from obsolete QA targeting secrets.
 if(!control||control.enabled!==true||control.paused===true||
  control.interactive_outbound_live_enabled!==true||
  get(env,'GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')!=='verified'||
  get(env,'GREEN_BUTTONS_QA_OWNER_APPROVED')!=='confirmed'||
  get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')!=='enabled'||
  (mode==='outbound'&&(
   get(env,'GREEN_BUTTONS_QA_SEND_ENABLED')!=='enabled'||
   control.interactive_assignment_production_enabled!==true))||
  (mode==='inbound'&&
   control.interactive_assignment_production_enabled!==true&&
   control.interactive_assignment_production_ever_enabled!==true))
  return null;
 const senderAccountId=get(env,'GREEN_API_INSTANCE_ID');
 const token=get(env,'GREEN_API_TOKEN');
 const signingSecret=get(env,'WHATSAPP_INTERACTIVE_SIGNING_SECRET');
 const webhookSecret=get(env,'GREEN_API_WEBHOOK_TOKEN');
 if(!INSTANCE.test(senderAccountId)||token.length<24||
  signingSecret.length<SECRET_MIN||webhookSecret.length<24||
  webhookSecret===signingSecret)return null;
 let policy:any,officeNumber='';
 try{
  const stored=parseSavedWhatsAppInteractivePolicy(control,'green');
  if(!stored.configured||stored.corrupt||!stored.setting.officeNumber)return null;
  officeNumber=stored.setting.officeNumber;
  policy=validateWhatsAppInteractivePolicy({
   ...stored.setting.policy,enabled:true
  });
 }catch{return null;}
 if(!/^[1-9][0-9]{7,14}$/.test(officeNumber)||
  policy.buttons.length!==3||
  !exactActions.every(action=>policy.buttons.some((b:any)=>b.action===action)))
  return null;
 return {enabled:true,accountCapabilityVerified:true,
  legacyProductionApproved:true,
  capability:'mixed_url',senderAccountId,signingSecret,policy,
  officeNumber,officeLabel:policy.buttons.find((b:any)=>
   b.action==='contact_office')!.label,
  officeContextMode:'reference',
  supplierPortalUrl:SUPPLIER_PORTAL_URL,supplierPortalLabel:'כניסה למערכת'};
}
// A signed, explicitly owner-armed SINGLE REAL assignment replaces only
// the targeting metadata for a narrow legacy pilot. All Green QA credentials,
// provider beta proof, owner send/inbound gates and URL policy remain unchanged.
// The HMAC is checked on every worker/receiver invocation: normal admin RLS
// cannot turn an arbitrary JSON row into a new WhatsApp authorization.
export async function trustedGreenLegacyPilotConfig(control:any,
 env:(key:string)=>string|undefined,
 mode:'outbound'|'inbound',senderChatId='',now=Date.now()
):Promise<TrustedGreenInteractiveConfig|null>{
 const raw=control?.[LEGACY_GREEN_PILOT_FIELD];
 if(!raw)return null;
 const base=trustedGreenButtonQaConfigForMode(control,env,true,mode==='outbound');
 if(!base||base.accountCapabilityVerified!==true)return null;
 const previous=await verifyLegacyGreenPilotState(raw,base.signingSecret,now);
 const target=mode==='outbound'?outboundLegacyPilotTarget(previous,now):
  inboundLegacyPilotTarget(previous,senderChatId,now);
 if(!target)return null;
 return {...base,legacyCanaryApproved:true,
  legacyPilotArmedAt:target.createdAt,
  qaEventServiceId:target.eventServiceId,qaSupplierId:target.supplierId,
  qaChatId:target.chatId};
}
// Safe, sanitized readiness metadata for admin UI: no secrets or phone.
// Not used to authorize sending or handling real callbacks.
export function greenButtonQaSafeSummary(control:any,env:(key:string)=>string|undefined,
 assignmentIntentEnabled=false,otherPendingCount:null|number=null){
 const config=trustedGreenButtonQaConfig(control,env,assignmentIntentEnabled);
 const inbound=trustedGreenButtonQaInboundConfig(control,env,assignmentIntentEnabled);
 const draft=parseSavedWhatsAppInteractivePolicy(control,'green');
 return {mode:'single_chat_qa',readyForQa:!!config&&assignmentIntentEnabled&&
  otherPendingCount===0&&
  get(env,'GREEN_BUTTONS_QA_POST_REBOOT_SETTINGS_VERIFIED')==='confirmed'&&
  get(env,'GREEN_BUTTONS_QA_CREATE_ENABLED')==='enabled',
  receivingExistingQaRepliesAvailable:!!inbound,
  webhookProvisioningOwnerActionAvailable:
   greenButtonQaPassiveInboundReady(env)&&
   get(env,'GREEN_BUTTONS_QA_SETTINGS_WRITE_ENABLED')==='enabled'&&
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
   {key:'create_env_gate',ready:get(env,'GREEN_BUTTONS_QA_CREATE_ENABLED')==='enabled'},
   {key:'post_reboot_settings_gate',ready:
     get(env,'GREEN_BUTTONS_QA_POST_REBOOT_SETTINGS_VERIFIED')==='confirmed'},
   {key:'inbound_env_gate',ready:get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')==='enabled'},
   {key:'owner_env_gate',ready:get(env,'GREEN_BUTTONS_QA_OWNER_APPROVED')==='approved'},
   {key:'provider_beta_verified',ready:get(env,'GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')==='verified'},
   {key:'one_message_beta_probe_approved',ready:
     get(env,'GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')==='probe_authorized'&&
     get(env,'GREEN_BUTTONS_QA_BETA_PROBE_ENABLED')==='enabled'}, 
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
