// Owner-gated V2 "קיבלתי" supplier event-reminder outbound preparation.
// NO new worker/cron/provider call. Only existing queued, attributable Green
// supplier event reminders with owner-approved URL navigation are eligible.
// A fresh HMAC snapshot is atomically attached BEFORE any provider attempt.
// Known 429 retries reuse the same signed snapshot, never regenerate IDs.
// A signed/started/uncertain job can NEVER silently become plain text.
import {createV2OpaqueButtonSnapshot,verifyV2OpaqueButtonSnapshot}
 from './whatsappV2OpaqueButtonBridge.ts';
import {previewGreenSupplierNavigation} from './greenSupplierNavigation.ts';
import {isSafeTemplateId} from './greenSupplierTemplateButtonsPolicy.ts';

const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const ID=/^[A-Za-z0-9_-]{3,128}$/;
const INSTANCE=/^[0-9]{5,20}$/;
const SIGNED='interactive_v2_button_bindings_json';
const METADATA=['company_id','message_kind','resource_type','resource_id',
 'recipient_audience','recipient_id','revision','sender_account_id'] as const;
const fail=(why:string)=>Object.assign(new Error('V2 reminder send: '+why),{code:why});
export type ReminderV2Preview={
 kind:'interactive_reminder_v2';method:'sendInteractiveButtons';
 body:{chatId:string;body:string;buttons:any[]};
 navigation:any;providerRequestsMade:0
};
function authorized(control:any,config:any){
 return control?.interactive_reminder_v2_outbound_enabled===true&&
  control?.interactive_reminder_v2_inbound_ever_enabled===true&&
  control?.enabled===true&&control?.paused!==true&&
  control?.interactive_outbound_live_enabled===true&&
  control?.interactive_assignment_production_enabled===true&&
  config?.enabled===true&&config?.legacyProductionApproved===true&&
  config?.accountCapabilityVerified===true&&config?.capability==='mixed_url'&&
  INSTANCE.test(config.senderAccountId||'')&&
  typeof config.signingSecret==='string'&&config.signingSecret.length>=32;
}
function baseEligible(job:any){
 return job?.source_type==='event_reminder'&&job.message_type==='text'&&
  job.requested_provider==='green'&&
  PRIVATE.test(job.chat_id||'')&&
  ID.test(job.id||'')&&ID.test(job.supplier_id||'')&&
  isSafeTemplateId(job.notification_template_id)&&
  typeof job.supplier_buttons_snapshot_json==='string'&&
  job.supplier_buttons_snapshot_json.length>=70&&
  !job.interactive_button_bindings_json&&!job.assignment_revision&&
  !job.interactive_qa_required;
}
function fakeNavigationOrigin(job:any){
 // Pure navigation preview uses the original pre-signing job shape. Existing
 // URL policy was frozen at enqueue and is not fetched again on a 429 retry.
 return {...job,status:'queued',sender_account_id:'',
  interactive_v2_button_bindings_json:''};
}
function bindingMetadata(job:any,account:string){
 return {
  company_id:'shirat_hanevel',message_kind:'supplier_reminder',
  resource_type:'outbox_message',resource_id:job.id,
  recipient_audience:'supplier',recipient_id:job.supplier_id,
  revision:'r1',sender_account_id:account
 };
}
function exactMetadata(row:any,authored:any){
 return METADATA.every(key=>row?.[key]===authored?.[key]);
}
export async function prepareGreenV2ReminderWorkerCandidate(input:{
 client:any;job:any;provider:string;control:any;config:any;
 now?:number;subtle?:SubtleCrypto
}):Promise<{kind:'reminder_v2';reason:'supplier_reminder_signed_v2';
 job:any;preview:ReminderV2Preview}|null>{
 const {client,job,provider,control,config}=input;
 if(!authorized(control,config)||provider!=='green'||!baseEligible(job))return null;
 const existing=typeof job[SIGNED]==='string'&&job[SIGNED].length>0;
 if(!existing&&!(job.status==='queued'&&Number(job.attempt_count||0)===0&&
  !job.send_started_at&&!job.provider_message_id&&!job.sender_account_id))
  return null;
 if(existing&&!(
  (job.status==='queued'&&Number(job.attempt_count||0)===0&&!job.send_started_at)||
  (job.status==='retry_wait'&&job.error_code===429&&
   Number(job.attempt_count||0)>0&&!job.provider_message_id)))
  throw fail('signed_job_retry_requires_review');
 const nav=previewGreenSupplierNavigation({
  job:fakeNavigationOrigin(job),provider,control,config
 });
 // Honor prior per-NotificationTemplate URL button selection. No reply
 // button when the owner selected "no buttons" for that template.
 if(!nav||!Array.isArray(nav.body?.buttons)||nav.body.buttons.length>2)
  return existing?Promise.reject(fail('frozen_reminder_navigation_missing')):null;
 const db=client?.asServiceRole?.entities?.WhatsAppOutbox;
 if(!db?.get||!db?.updateMany)throw fail('outbox_storage_unavailable');
 const meta=bindingMetadata(job,config.senderAccountId);
 let frozen=existing?job[SIGNED]:'';
 if(!existing){
  frozen=await createV2OpaqueButtonSnapshot({
   job:{...job,...meta},actions:[{
    action:'reminder_acknowledge',label:'קיבלתי'
   }],signingSecret:config.signingSecret,now:input.now,subtle:input.subtle
  });
  let commit:any;
  try{
   commit=await db.updateMany({
    id:job.id,status:'queued',
    source_type:'event_reminder',requested_provider:'green',
    supplier_id:job.supplier_id,chat_id:job.chat_id,
    attempt_count:job.attempt_count??null,
    send_started_at:job.send_started_at??null,
    provider_message_id:job.provider_message_id??null,
    sender_account_id:job.sender_account_id??null,
    [SIGNED]:job[SIGNED]??null
   },{$set:{...meta,[SIGNED]:frozen}});
  }catch{
   // The DB may have committed before SDK timeout: verify it; do not create
   // fresh IDs or allow a plain-text send on this unknown result.
  }
  if(commit?.updated!==1){
   let peek:any;
   try{peek=await db.get(job.id);}catch{}
   if(!peek||peek[SIGNED]!==frozen||!exactMetadata(peek,meta)||
    peek.status!=='queued'||Number(peek.attempt_count||0)!==0)
    throw fail('snapshot_write_uncertain');
  }
 }
 let saved:any;
 try{saved=await db.get(job.id);}catch{throw fail('snapshot_read_unavailable');}
 if(!saved||saved[SIGNED]!==frozen||!exactMetadata(saved,meta)||
  saved.id!==job.id||saved.status!==job.status||
  saved.supplier_id!==job.supplier_id||saved.chat_id!==job.chat_id||
  saved.source_type!==job.source_type||saved.requested_provider!=='green')
  throw fail('snapshot_identity_changed');
 const verified=await verifyV2OpaqueButtonSnapshot({
  job:saved,raw:frozen,signingSecret:config.signingSecret,
  now:input.now,subtle:input.subtle
 });
 if(!verified||verified.buttons.length!==1||
  verified.buttons[0].action!=='reminder_acknowledge')
  throw fail('signed_snapshot_invalid');
 const button=verified.buttons[0];
 return {kind:'reminder_v2',reason:'supplier_reminder_signed_v2',job:saved,
  preview:{
   method:'sendInteractiveButtons',kind:'interactive_reminder_v2',
   body:{chatId:saved.chat_id,body:nav.body.body,buttons:[
    {type:'reply',buttonId:button.buttonId,buttonText:button.label},
    ...nav.body.buttons
   ]},navigation:nav,providerRequestsMade:0
  }};
}
// Defense in depth at the very final provider transport boundary.
// This check never trusts a button preview or JSON from the client.
export async function verifyV2ReminderTransport(input:{
 job:any;provider:string;preview:any;signingSecret:string;
 expectedSenderAccountId:string;now?:number;subtle?:SubtleCrypto;
 verifyNavigation:(job:any,provider:string,navigation:any)=>boolean
}):Promise<boolean>{
 const {job,preview,provider}=input;
 if(!job||provider!=='green'||job.status!=='sending'||
  job.message_kind!=='supplier_reminder'||job.source_type!=='event_reminder'||
  job.sender_account_id!==input.expectedSenderAccountId||
  !INSTANCE.test(job.sender_account_id||'')||
  preview?.kind!=='interactive_reminder_v2'||
  preview?.method!=='sendInteractiveButtons'||preview?.body?.chatId!==job.chat_id||
  !Array.isArray(preview.body.buttons)||preview.body.buttons.length<2||
  preview.body.buttons.length>3||
  !input.verifyNavigation(job,'green',preview.navigation)||
  preview.body.body!==preview.navigation.body.body)return false;
 const signed=await verifyV2OpaqueButtonSnapshot({
  job,raw:job.interactive_v2_button_bindings_json,
  signingSecret:input.signingSecret,now:input.now,subtle:input.subtle
 });
 if(!signed||signed.buttons.length!==1||
  signed.buttons[0].action!=='reminder_acknowledge')return false;
 const reply=preview.body.buttons[0],original=signed.buttons[0];
 if(!reply||reply.type!=='reply'||reply.buttonId!==original.buttonId||
  reply.buttonText!==original.label)return false;
 const urlButtons=preview.body.buttons.slice(1);
 return JSON.stringify(urlButtons)===JSON.stringify(preview.navigation.body.buttons);
}
