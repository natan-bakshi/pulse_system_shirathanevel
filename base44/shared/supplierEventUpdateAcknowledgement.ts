// Signed, receipt-only "קיבלתי" for administrator-approved event updates
// that DO NOT reset supplier statuses. Reuses the existing Green queue,
// V2 opaque button identity, signed webhook and one durable Outbox CAS.
// This module cannot update an EventService or a supplier's assignment status.
import {createV2OpaqueButtonSnapshot,verifyV2OpaqueButtonSnapshot,
 resolveAuthenticatedV2GreenButton} from './whatsappV2OpaqueButtonBridge.ts';
import {parseGreenButtonSelection} from './greenInteractiveCallback.ts';
import {authenticateWhatsAppProviderCallback}
 from './whatsappProviderWebhookAuth.ts';
const ID=/^[A-Za-z0-9_-]{3,128}$/;
const CHAT=/^[1-9][0-9]{7,14}@c\.us$/;
const ACCOUNT=/^[0-9]{5,20}$/;
const KEY=/^supplier-event-info-v1:[0-9a-f]{64}$/;
const BUTTON=/^wa2_[A-Za-z0-9_-]{22}$/;
const SIGNED='interactive_v2_button_bindings_json';
const ACK='event_update_acknowledged_at';
const EVENT='event_update_ack_event_id';
const PROOF='event_update_ack_proof';
const DOMAIN='pulse-shirat-supplier-event-ack:v1\n';
const ENC=new TextEncoder();
const fail=(reason:string)=>Object.assign(Error('Event update receipt: '+reason),{code:reason});
function validJob(job:any){
 return !!job&&job.source_type==='event_update'&&
  job.message_type==='text'&&job.requested_provider==='green'&&
  KEY.test(job.idempotency_key||'')&&
  ID.test(job.id||'')&&ID.test(job.source_id||'')&&
  ID.test(job.event_service_id||'')&&ID.test(job.supplier_id||'')&&
  ID.test(job.notification_template_id||'')&&
  CHAT.test(job.chat_id||'')&&!job.assignment_revision&&
  !job.interactive_button_bindings_json&&
  !job.interactive_qa_required;
}
function metadata(job:any,account:string){
 return {company_id:'shirat_hanevel',message_kind:'supplier_event_update',
  resource_type:'outbox_message',resource_id:job.id,
  recipient_audience:'supplier',recipient_id:job.supplier_id,
  revision:'r1',sender_account_id:account};
}
function equalMeta(row:any,expected:any){
 return Object.entries(expected).every(([k,v])=>row?.[k]===v);
}
function allowed(control:any,config:any){
 return control?.enabled===true&&control?.paused!==true&&
  control?.interactive_outbound_live_enabled===true&&
  control?.interactive_assignment_production_enabled===true&&
  config?.enabled===true&&config?.legacyProductionApproved===true&&
  config?.accountCapabilityVerified===true&&
  ACCOUNT.test(config.senderAccountId||'')&&
  typeof config.signingSecret==='string'&&config.signingSecret.length>=32;
}
export async function prepareEventUpdateAcknowledgement(input:{
 client:any;job:any;provider:string;control:any;config:any;now?:number
}):Promise<any>{
 const {client,job,provider,control,config}=input;
 if(provider!=='green'||!allowed(control,config)||!validJob(job))
  throw fail('buttons_not_authorized');
 const db=client?.asServiceRole?.entities;
 if(!db?.WhatsAppOutbox?.get||!db?.WhatsAppOutbox?.updateMany||
   !db?.EventService?.get)throw fail('source_unavailable');
 const service=await db.EventService.get(job.event_service_id);
 let ids:any;
 try{ids=JSON.parse(service?.supplier_ids||'[]');}catch{ids=[];}
 if(!service||service.is_external===true||service.event_id!==job.source_id||
  !Array.isArray(ids)||!ids.includes(job.supplier_id))
  throw fail('supplier_no_longer_assigned');
 const existing=typeof job[SIGNED]==='string'&&job[SIGNED].length>0;
 if(!existing&&!(job.status==='queued'&&Number(job.attempt_count||0)===0&&
  !job.send_started_at&&!job.provider_message_id&&!job.sender_account_id))
  throw fail('already_attempted');
 if(existing&&!(
  (job.status==='queued'&&Number(job.attempt_count||0)===0&&!job.send_started_at)||
  (job.status==='retry_wait'&&job.error_code===429&&
   Number(job.attempt_count||0)>0&&!job.provider_message_id)))
  throw fail('ambiguous_retry');
 const meta=metadata(job,config.senderAccountId);
 let frozen=existing?job[SIGNED]:'';
 if(!existing){
  frozen=await createV2OpaqueButtonSnapshot({
   job:{...job,...meta},actions:[{action:'event_update_acknowledge',label:'קיבלתי'}],
   signingSecret:config.signingSecret,now:input.now,ttlMs:7*86400000
  });
  let updated:any;
  try{
   updated=await db.WhatsAppOutbox.updateMany({
    id:job.id,status:'queued',source_type:'event_update',
    idempotency_key:job.idempotency_key,
    requested_provider:'green',supplier_id:job.supplier_id,
    attempt_count:job.attempt_count??null,
    send_started_at:job.send_started_at??null,
    sender_account_id:job.sender_account_id??null,
    [SIGNED]:job[SIGNED]??null
   },{$set:{...meta,[SIGNED]:frozen}});
  }catch{} // Remote CAS may have committed; verify by read before dispatch.
  if(updated?.updated!==1){
   const latest=await db.WhatsAppOutbox.get(job.id).catch(()=>null);
   if(!latest||latest[SIGNED]!==frozen||!equalMeta(latest,meta)||
    latest.status!=='queued')throw fail('snapshot_commit_uncertain');
  }
 }
 const saved=await db.WhatsAppOutbox.get(job.id).catch(()=>null);
 if(!saved||saved[SIGNED]!==frozen||!equalMeta(saved,meta)||
  saved.source_type!=='event_update'||saved.id!==job.id||
  saved.status!==job.status||saved.chat_id!==job.chat_id||
  saved.supplier_id!==job.supplier_id)throw fail('snapshot_identity_changed');
 const signed=await verifyV2OpaqueButtonSnapshot({
  job:saved,raw:frozen,signingSecret:config.signingSecret,now:input.now
 });
 if(!signed||signed.buttons.length!==1||
  signed.buttons[0].action!=='event_update_acknowledge')
  throw fail('snapshot_invalid');
 const b=signed.buttons[0];
 return {kind:'event_update_ack',reason:'signed_information_ack',
  job:saved,preview:{
   kind:'interactive_event_update_ack',method:'sendInteractiveButtons',
   body:{chatId:saved.chat_id,body:saved.message_text,
    buttons:[{type:'reply',buttonId:b.buttonId,buttonText:'קיבלתי'}]},
   providerRequestsMade:0
  }};
}
export async function verifyEventUpdateAckTransport(input:{
 job:any;provider:string;preview:any;secret:string;now?:number
}):Promise<boolean>{
 const {job,provider,preview}=input;
 if(provider!=='green'||job?.source_type!=='event_update'||
  job.status!=='sending'||job.provider!=='green'||
  job.requested_provider!=='green'||!KEY.test(job.idempotency_key||'')||
  preview?.kind!=='interactive_event_update_ack'||
  preview.method!=='sendInteractiveButtons'||
  preview.body?.chatId!==job.chat_id||
  preview.body?.body!==job.message_text||
  !Array.isArray(preview.body.buttons)||preview.body.buttons.length!==1)
  return false;
 const s=await verifyV2OpaqueButtonSnapshot({
  job,raw:job.interactive_v2_button_bindings_json,
  signingSecret:input.secret,now:input.now
 });
 if(!s||s.buttons.length!==1||s.buttons[0].action!=='event_update_acknowledge')
  return false;
 const b=preview.body.buttons[0],f=s.buttons[0];
 return b.type==='reply'&&b.buttonId===f.buttonId&&
  b.buttonText===f.label&&b.buttonText==='קיבלתי';
}
type Admission={status:'admitted'|'refused';reason:string;read:boolean;data?:any};
const rejected=(reason:string,read=false):Admission=>({status:'refused',reason,read});
export async function admitEventUpdateAcknowledgement(input:{
 client:any;headers:any;rawCallback:any;callbackByteLength:number;
 expectedInstanceId:string;webhookSecret:string;signingSecret:string;now?:number
}):Promise<Admission>{
 if(!ACCOUNT.test(input.expectedInstanceId||'')||
  !Number.isSafeInteger(input.callbackByteLength)||
  input.callbackByteLength<30||input.callbackByteLength>32768||
  !authenticateWhatsAppProviderCallback({
   provider:'green',headers:input.headers,webhookSecret:input.webhookSecret
  }))return rejected('unauthenticated');
 const click=parseGreenButtonSelection(input.rawCallback,input.expectedInstanceId,
  input.now??Date.now());
 if(!click||!BUTTON.test(click.buttonId||''))return rejected('not_v2_reply');
 const db=input.client?.asServiceRole?.entities?.WhatsAppOutbox;
 if(!db?.filter)return rejected('no_outbox');
 let jobs:any;
 try{jobs=await db.filter({
  status:'accepted',provider:'green',requested_provider:'green',
  sender_account_id:input.expectedInstanceId,
  provider_message_id:click.originalProviderMessageId,
  chat_id:click.senderChatId,source_type:'event_update',
  message_kind:'supplier_event_update'
 },'-created_date',2);}
 catch{return rejected('outbox_read_uncertain',true);}
 if(!Array.isArray(jobs)||jobs.length!==1)
  return rejected(jobs?.length>1?'ambiguous_origin':'unknown_origin',true);
 const job=jobs[0];
 if(!validJob({...job,interactive_v2_button_bindings_json:''})||
  job.resource_id!==job.id||job.recipient_id!==job.supplier_id||
  job.recipient_audience!=='supplier'||job.company_id!=='shirat_hanevel')
  return rejected('untrusted_outbox',true);
 const signed=await resolveAuthenticatedV2GreenButton({
  job,click,signingSecret:input.signingSecret,now:input.now
 });
 if(!signed||signed.action!=='event_update_acknowledge'||
  signed.messageKind!=='supplier_event_update')
  return rejected('invalid_signature',true);
 return {status:'admitted',reason:'verified_event_notice',read:true,
  data:{outboxId:job.id,providerEventId:click.providerEventId,
   chatId:job.chat_id,providerMessageId:job.provider_message_id,
   senderAccountId:job.sender_account_id,supplierId:job.supplier_id,
   revision:job.revision}};
}
function base64(buf:Uint8Array){
 let s='';for(const byte of buf)s+=String.fromCharCode(byte);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function proof(row:any,secret:string){
 const values=[row.id,row.source_id,row.supplier_id,row.sender_account_id,
  row.provider_message_id,row.event_update_ack_event_id,
  row.event_update_acknowledged_at];
 const k=await crypto.subtle.importKey('raw',ENC.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return base64(new Uint8Array(await crypto.subtle.sign('HMAC',k,
  ENC.encode(DOMAIN+JSON.stringify(values)))));
}
async function checkProof(row:any,secret:string){
 if(typeof row?.[PROOF]!=='string')return false;
 return row[PROOF]===await proof(row,secret);
}
export async function recordEventUpdateAcknowledgement(input:{
 client:any;admission:any;signingSecret:string;now?:number
}):Promise<'recorded'|'already_recorded'|'already_acknowledged'|'needs_review'|'refused'>{
 const a=input.admission;
 if(!a||!ID.test(a.outboxId||'')||!ID.test(a.providerEventId||'')||
  !ACCOUNT.test(a.senderAccountId||'')||
  typeof input.signingSecret!=='string'||input.signingSecret.length<32)
  return 'refused';
 const db=input.client?.asServiceRole?.entities?.WhatsAppOutbox;
 if(!db?.get||!db?.updateMany)return 'needs_review';
 const job=await db.get(a.outboxId).catch(()=>null);
 const match=(x:any)=>!!x&&x.id===a.outboxId&&x.source_type==='event_update'&&
  x.message_kind==='supplier_event_update'&&x.status==='accepted'&&
  x.provider==='green'&&x.requested_provider==='green'&&
  x.sender_account_id===a.senderAccountId&&x.chat_id===a.chatId&&
  x.provider_message_id===a.providerMessageId&&
  x.supplier_id===a.supplierId&&x.recipient_id===a.supplierId&&
  x.revision===a.revision;
 if(!match(job))return 'refused';
 if(job[ACK])return await checkProof(job,input.signingSecret)
   ?job[EVENT]===a.providerEventId?'already_recorded':'already_acknowledged'
   :'needs_review';
 const at=new Date(input.now??Date.now()).toISOString();
 const next={...job,[ACK]:at,[EVENT]:a.providerEventId};
 let signature:string;
 try{signature=await proof(next,input.signingSecret);}catch{return 'needs_review';}
 let modified:any;
 try{
  modified=await db.updateMany({
   id:job.id,status:'accepted',source_type:'event_update',
   message_kind:'supplier_event_update',
   provider_message_id:a.providerMessageId,chat_id:a.chatId,
   sender_account_id:a.senderAccountId,supplier_id:a.supplierId,
   revision:a.revision,[ACK]:job[ACK]??null,
   [EVENT]:job[EVENT]??null,[PROOF]:job[PROOF]??null
  },{$set:{[ACK]:at,[EVENT]:a.providerEventId,[PROOF]:signature}});
 }catch{}
 if(modified?.updated===1)return 'recorded';
 const latest=await db.get(a.outboxId).catch(()=>null);
 if(!match(latest)||!latest[ACK]||
  !await checkProof(latest,input.signingSecret))return 'needs_review';
 return latest[EVENT]===a.providerEventId?'already_recorded':'already_acknowledged';
}
