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
const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const SECRET_MIN=32;
const exactActions=['assignment_approve','assignment_reject','contact_office'];
const get=(env:(k:string)=>string|undefined,k:string)=>String(env(k)||'');
export function trustedGreenButtonQaConfig(control:any,env:(key:string)=>string|undefined):
 TrustedGreenInteractiveConfig|null{
 // No action when disabled, including no access to secrets and draft.
 if(control?.interactive_outbound_live_enabled!==true||
  get(env,'GREEN_BUTTONS_QA_SEND_ENABLED')!=='enabled'||
  get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')!=='enabled'||
  get(env,'GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')!=='verified'||
  get(env,'GREEN_BUTTONS_QA_OWNER_APPROVED')!=='approved')
  return null;
 const senderAccountId=get(env,'GREEN_API_INSTANCE_ID');
 const signingSecret=get(env,'WHATSAPP_INTERACTIVE_SIGNING_SECRET');
 const webhookSecret=get(env,'GREEN_API_WEBHOOK_TOKEN');
 const target=get(env,'GREEN_BUTTONS_QA_ALLOWED_CHAT');
 const token=get(env,'GREEN_API_TOKEN');
 if(!INSTANCE.test(senderAccountId)||!PRIVATE.test(target)||
  signingSecret.length<SECRET_MIN||webhookSecret.length<24||
  token.length<24||signingSecret===webhookSecret||
  target===senderAccountId+'@c.us')return null;
 const draft=parseSavedWhatsAppInteractivePolicy(control,'green');
 if(!draft.configured||draft.corrupt||!draft.setting.officeNumber)
  return null;
 // The UI and persistent policy intentionally stay disabled. Only a trusted,
 // explicit QA gate turns the immutable COPY enabled, not the stored draft.
 const policy=validateWhatsAppInteractivePolicy({
  ...draft.setting.policy,enabled:true
 });
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
  qaChatId:target
 };
}
// Safe, sanitized readiness metadata for admin UI: no secrets or phone.
// Not used to authorize sending or handling real callbacks.
export function greenButtonQaSafeSummary(control:any,env:(key:string)=>string|undefined){
 const config=trustedGreenButtonQaConfig(control,env);
 return {mode:'single_chat_qa',readyForQa:!!config,
  liveButtonsSentByThisCheck:false,
  restrictedToOnePrivateChat:true,
  requiresGreenWebhookRoutingReview:true,
  realCallbackRoundTripProven:false,
  noProviderCalls:true,
  noMessageSends:true};
}
