// Authenticated, read-only V2 Green callback admission. This is NOT
// the live assignment v1 webhook and does not install another webhook URL.
// HTTP bearer authentication, exact sender instance/private chat, server-
// signed short button snapshot, HMAC V2, original accepted Outbox identity,
// and provider event ID are required BEFORE any business effect.
// Unknown/manual/legacy events require the existing handler, not this one.
import {authenticateWhatsAppProviderCallback}
 from './whatsappProviderWebhookAuth.ts';
import {parseGreenButtonSelection} from './greenInteractiveCallback.ts';
import {resolveAuthenticatedV2GreenButton}
 from './whatsappV2OpaqueButtonBridge.ts';

const ADMITTED=Symbol('verified_green_v2_reminder_admission');
const BUTTON=/^wa2_[A-Za-z0-9_-]{22}$/;
const INSTANCE=/^[0-9]{5,20}$/;
const MAX_CALLBACK=32768;
const LOOKUP_FIELDS=[
 'id','company_id','message_kind','source_type','resource_type',
 'resource_id','recipient_audience','recipient_id','supplier_id',
 'message_type','requested_provider','provider','sender_account_id',
 'chat_id','revision','status','provider_message_id',
 'interactive_v2_button_bindings_json',
 'reminder_acknowledged_at','reminder_acknowledgement_event_id'
];
type Result={status:'refused'|'admitted';reason:string;
 providerCalls:0;outboxReads:0|1;admission?:any};
function refused(reason:string,reads:0|1=0):Result{
 return {status:'refused',reason,providerCalls:0,outboxReads:reads};
}
export async function admitAuthenticatedV2GreenReminder(input:{
 client:any;headers:any;rawCallback:any;callbackByteLength:number;
 expectedInstanceId:string;webhookSecret:string;signingSecret:string;
 rolloutAuthorized:boolean;providerCapabilityVerified:boolean;now?:number
}):Promise<Result>{
 if(input?.rolloutAuthorized!==true||
  input?.providerCapabilityVerified!==true)return refused('not_enabled');
 if(!Number.isSafeInteger(input.callbackByteLength)||
  input.callbackByteLength<30||input.callbackByteLength>MAX_CALLBACK)
  return refused('invalid_size');
 if(!INSTANCE.test(input.expectedInstanceId||'')||
  !authenticateWhatsAppProviderCallback({
   provider:'green',headers:input.headers,webhookSecret:input.webhookSecret
  }))return refused('unauthenticated');
 const click=parseGreenButtonSelection(
  input.rawCallback,input.expectedInstanceId,input.now??Date.now());
 if(!click)return refused('not_a_valid_green_button');
 if(!BUTTON.test(click.buttonId))return refused('not_a_v2_button');
 const db=input.client?.asServiceRole?.entities?.WhatsAppOutbox;
 if(!db||typeof db.filter!=='function')return refused('no_outbox_reader');
 let jobs:any;
 try{jobs=await db.filter({
  status:'accepted',provider:'green',requested_provider:'green',
  sender_account_id:input.expectedInstanceId,
  provider_message_id:click.originalProviderMessageId,
  chat_id:click.senderChatId,
  source_type:'event_reminder',message_kind:'supplier_reminder'
 },'-created_date',2,0,LOOKUP_FIELDS);}
 catch{return refused('outbox_read_uncertain',1);}
 if(!Array.isArray(jobs)||jobs.length!==1)
  return refused(jobs?.length>1?'ambiguous_origin':'unknown_origin',1);
 const job=jobs[0];
 if(job.resource_type!=='outbox_message'||job.resource_id!==job.id||
  job.recipient_audience!=='supplier'||job.recipient_id!==job.supplier_id)
  return refused('untrusted_reminder_scope',1);
 const signed=await resolveAuthenticatedV2GreenButton({
  job,click,signingSecret:input.signingSecret,now:input.now
 });
 if(!signed||signed.action!=='reminder_acknowledge'||
  signed.messageKind!=='supplier_reminder')return refused('unsigned_or_ineligible',1);
 // One returned capability token is created only by this module after all
 // checks above. It is NOT a public API credential or durable receipt.
 const admission=Object.freeze({
  [ADMITTED]:true,
  outboxId:job.id,providerEventId:click.providerEventId,
  senderAccountId:job.sender_account_id,providerMessageId:job.provider_message_id,
  chatId:job.chat_id,recipientId:job.recipient_id,
  revision:job.revision,action:'reminder_acknowledge' as const
 });
 return {status:'admitted',reason:'signed_original_proven',
  providerCalls:0,outboxReads:1,admission};
}
export function isAdmittedGreenV2Reminder(input:any):boolean{
 return input?.[ADMITTED]===true&&input.action==='reminder_acknowledge';
}
// Acknowledgement changes ONLY the source Outbox, not assignment/status.
// The old signed V1 inbox, producer/workers, feedback and calendar remain
// untouched. One CAS wins for an original message; retries/duplicate
// provider event IDs can only observe the durable original result.
// An uncertain update never causes an automatic second write in this call.
export async function recordVerifiedV2ReminderAcknowledgement(input:{
 client:any;admission:any;now?:number
}):Promise<{
 status:'recorded'|'already_recorded'|'already_acknowledged'|
  'needs_review'|'refused';reason:string;writesAuthorized:0|1
}>{
 const a=input?.admission;
 if(!isAdmittedGreenV2Reminder(a))
  return {status:'refused',reason:'not_verified',writesAuthorized:0};
 const db=input?.client?.asServiceRole?.entities?.WhatsAppOutbox;
 if(!db||typeof db.get!=='function'||typeof db.updateMany!=='function')
  return {status:'needs_review',reason:'outbox_unavailable',writesAuthorized:0};
 let job:any;
 try{job=await db.get(a.outboxId);}
 catch{return {status:'needs_review',reason:'origin_read_uncertain',writesAuthorized:0};}
 const matches=(row:any)=>!!row&&row.id===a.outboxId&&
  row.company_id==='shirat_hanevel'&&row.message_kind==='supplier_reminder'&&
  row.source_type==='event_reminder'&&row.provider==='green'&&
  row.requested_provider==='green'&&row.status==='accepted'&&
  row.sender_account_id===a.senderAccountId&&
  row.chat_id===a.chatId&&row.provider_message_id===a.providerMessageId&&
  row.recipient_id===a.recipientId&&row.supplier_id===a.recipientId&&
  row.revision===a.revision;
 if(!matches(job))
  return {status:'refused',reason:'original_message_changed',writesAuthorized:0};
 const observed=(row:any)=>row?.reminder_acknowledged_at?
  row.reminder_acknowledgement_event_id===a.providerEventId
   ?'already_recorded':'already_acknowledged':null;
 const existing=observed(job);
 if(existing)return {status:existing,reason:'durable_ack_exists',writesAuthorized:0};
 let changed:any;
 try{
  changed=await db.updateMany({
   id:job.id,status:'accepted',company_id:'shirat_hanevel',
   message_kind:'supplier_reminder',source_type:'event_reminder',
   provider:'green',requested_provider:'green',
   sender_account_id:a.senderAccountId,chat_id:a.chatId,
   provider_message_id:a.providerMessageId,
   recipient_id:a.recipientId,supplier_id:a.recipientId,
   revision:a.revision,
   reminder_acknowledged_at:job.reminder_acknowledged_at??null,
   reminder_acknowledgement_event_id:job.reminder_acknowledgement_event_id??null
  },{$set:{
   reminder_acknowledged_at:new Date(input.now??Date.now()).toISOString(),
   reminder_acknowledgement_event_id:a.providerEventId
  }});
  if(changed?.updated===1)
   return {status:'recorded',reason:'durable_ack_recorded',writesAuthorized:1};
 }catch{
  // A remote commit may have succeeded; never immediately repeat the CAS.
 }
 try{
  const refreshed=await db.get(a.outboxId);
  if(!matches(refreshed))
   return {status:'needs_review',reason:'origin_changed_during_ack',writesAuthorized:0};
  const previous=observed(refreshed);
  if(previous)return {status:previous,reason:'durable_ack_verified',
   writesAuthorized:0};
 }catch{}
 return {status:'needs_review',reason:'ack_commit_uncertain',writesAuthorized:0};
}
