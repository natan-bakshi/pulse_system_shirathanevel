// Owner-only, single-try Green API webhook provisioning for ONE WhatsApp
// buttons QA fixture. Intentionally NOT invoked by any background workflow.
// Every call requires a fresh provider GetSettings read and an exclusive
// database CAS claim BEFORE one SetSettings POST. Unknown POST outcomes NEVER
// trigger retry. The single Green instance WILL reboot on SetSettings.
import {greenApiOrigin,inspectGreenWebhookSettingsReadOnly}
 from './greenWebhookSettingsAudit.ts';
import {greenButtonQaScopedV2Enabled} from './greenButtonQaScopedV2.ts';
export const GREEN_BUTTON_QA_PROVISIONING_KEY=
 'green_buttons_qa_webhook_provisioning_once';
const APP='687d1de6659eff83e9c034f7';
const CALLBACK='https://pulse-system.base44.app/api/apps/'+APP+
 '/functions/greenAssignmentButtonQaWebhook';
const INSTANCE=/^[0-9]{5,20}$/;
const TOKEN=/^[A-Za-z0-9_-]{10,256}$/;
const safeError=(code:string)=>Object.assign(new Error(code),{code});
const get=(env:(k:string)=>string|undefined,key:string)=>
 String(env(key)||'');
export function greenButtonQaWebhookProvisioningGuard(
 env:(key:string)=>string|undefined,confirmation:string,
 control:any):{ready:boolean;reason:string}{
 if(confirmation!=='I_APPROVE_ONE_GREEN_REBOOT_FOR_BUTTONS'||
  get(env,'GREEN_BUTTONS_QA_SETTINGS_WRITE_ENABLED')!=='enabled'||
  get(env,'GREEN_BUTTONS_QA_OWNER_APPROVED')!=='approved')
  return {ready:false,reason:'owner_approval_required'};
 if(!greenButtonQaScopedV2Enabled(env)||
  get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')!=='enabled')
  return {ready:false,reason:'qa_receiver_not_armed'};
 if(get(env,'GREEN_BUTTONS_QA_SEND_ENABLED')==='enabled'||
  control?.interactive_outbound_live_enabled===true)
  return {ready:false,reason:'outbound_must_remain_disabled'};
 const instance=get(env,'GREEN_API_INSTANCE_ID');
 const token=get(env,'GREEN_API_TOKEN');
 const bearer=get(env,'GREEN_API_WEBHOOK_TOKEN');
 const signing=get(env,'WHATSAPP_INTERACTIVE_SIGNING_SECRET');
 if(!INSTANCE.test(instance)||!TOKEN.test(token)||
  bearer.length<24||signing.length<32||bearer===signing)
  return {ready:false,reason:'provider_credentials_incomplete'};
 try{greenApiOrigin(env('GREEN_API_URL'));}
 catch{return {ready:false,reason:'provider_host_invalid'};}
 return {ready:true,reason:'await_provider_read'};
}
export async function applyOneGreenButtonQaWebhookProvisioning(client:any,opts:{
 env:(key:string)=>string|undefined;
 confirmation:string;
 fetchFn?:(url:string,init:any)=>Promise<any>;
 timeoutMs?:number;
}):Promise<any>{
 const db=client?.asServiceRole?.entities;
 if(!db?.AppSettings?.filter||!db?.AppSettings?.updateMany||
  !db?.WhatsAppQueueControl?.filter)
  throw safeError('qa_provisioning_storage_unavailable');
 const controlRows=await db.WhatsAppQueueControl.filter({
  control_key:'global'
 },'-created_date',2);
 if(controlRows.length!==1)
  throw safeError('qa_provisioning_queue_control_ambiguous');
 const guard=greenButtonQaWebhookProvisioningGuard(
  opts.env,opts.confirmation,controlRows[0]);
 if(!guard.ready)throw safeError(guard.reason);
 const timeout=opts.timeoutMs??10000;
 if(!Number.isInteger(timeout)||timeout<500||timeout>15000)
  throw safeError('qa_provisioning_timeout_invalid_no_write');
 // The singleton is provisioned by the system owner ahead of the write.
 // No on-demand create and no duplicate process can claim it twice.
 const lockRows=await db.AppSettings.filter({
  setting_key:GREEN_BUTTON_QA_PROVISIONING_KEY
 },'-created_date',2);
 if(lockRows.length!==1||lockRows[0].setting_value!=='ready')
  throw safeError('qa_provisioning_one_shot_unavailable');
 let summary:any;
 try{
  summary=await inspectGreenWebhookSettingsReadOnly({
   instanceId:get(opts.env,'GREEN_API_INSTANCE_ID'),
   apiToken:get(opts.env,'GREEN_API_TOKEN'),
   apiBaseUrl:opts.env('GREEN_API_URL'),
   fetchFn:opts.fetchFn
  });
 }catch{
  // Provider GET never authorizes a write on uncertainty, timeout or 404.
  throw safeError('qa_provider_settings_read_failed_no_write');
 }
 // Green has one webhookUrl per instance. Never overwrite a nonempty URL,
 // bearer ****** or other active notification type: these may belong to others.
 if(summary.webhookConfigured||summary.webhookTokenConfigured||
  !summary.notificationFlags||
  !Object.values(summary.notificationFlags).every(flag=>flag==='no')||
  summary.activeCategories!==0||
  summary.providerReadCalls!==1)
  throw safeError('qa_existing_green_configuration_requires_review');
 // A successful CAS blocks double-clicks and transport-retry uncertainty.
 // If this crashes after claiming but before posting, manual review is needed.
 let claimed:any;
 try{
  claimed=await db.AppSettings.updateMany({
   id:lockRows[0].id,
   setting_key:GREEN_BUTTON_QA_PROVISIONING_KEY,
   setting_value:'ready'
  },{$set:{setting_value:'attempted'}});
 }catch{throw safeError('qa_provisioning_claim_uncertain_no_auto_retry');}
 if(claimed?.updated!==1)
  throw safeError('qa_provisioning_claim_conflict');
 const url=greenApiOrigin(opts.env('GREEN_API_URL'))+
  '/waInstance'+get(opts.env,'GREEN_API_INSTANCE_ID')+
  '/setSettings/'+encodeURIComponent(get(opts.env,'GREEN_API_TOKEN'));
 const body={
  webhookUrl:CALLBACK,
  webhookUrlToken:get(opts.env,'GREEN_API_WEBHOOK_TOKEN'),
  incomingWebhook:'yes'
 };
 // POST sent ONCE, no retry and no redirects (which could leak credentials).
 const fetchFn=opts.fetchFn||fetch;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);
 let accepted=false;
 try{
  const response=await fetchFn(url,{
   method:'POST',redirect:'manual',signal:controller.signal,
   headers:{'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify(body)
  });
  if(response?.status!==200||response?.ok!==true)
   throw safeError('qa_provisioning_post_outcome_requires_review');
  // Bounded response; NEVER return provider raw content.
  const responseText=await response.text();
  if(typeof responseText!=='string'||responseText.length>2048)
   throw safeError('qa_provisioning_post_outcome_requires_review');
  let result:any;
  try{result=JSON.parse(responseText);}
  catch{throw safeError('qa_provisioning_post_outcome_requires_review');}
  if(result?.saveSettings!==true)
   throw safeError('qa_provisioning_post_outcome_requires_review');
  accepted=true;
 }catch{
  // The provider MAY have applied the settings before losing the response.
  // The one-shot record stays "attempted"; NEVER resend without manual audit.
  throw safeError('qa_provisioning_post_outcome_requires_review');
 }finally{clearTimeout(timer);}
 if(accepted){
  try{
   await db.AppSettings.updateMany({
    id:lockRows[0].id,
    setting_key:GREEN_BUTTON_QA_PROVISIONING_KEY,
    setting_value:'attempted'
   },{$set:{setting_value:'provider_accepted'}});
  }catch{
   // No retry: prior CAS already fences a duplicate reboot.
  }
 }
 return {success:true,providerAccepted:true,
  incomingWebhookRequested:true,oneShotConsumed:true,
  requiresReadOnlyVerificationAfterReboot:true,
  buttonCapabilityNotProven:true,realCallbackNotProven:true,
  whatsappMessagesSent:0,providerSettingWrites:1,
  noOtherSettingsChangedByRequest:true,
  noClientSecretsOrUrlsReturned:true};
}
