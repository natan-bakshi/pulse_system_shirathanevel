// Future provider-button-ID bridge. Green API buttonId length is not fully
// specified, so do not embed a large signed action token in the WhatsApp
// payload. Send a short random opaque id and persist its HMAC-signed binding
// on the OUTBOUND job before the FIRST provider attempt. Never regenerate on
// retry/UNKNOWN: a callback must always resolve to the original exact job.
// This module does not modify Outbox or send any message.
import {createSignedWhatsAppAction} from './whatsappSignedAction.ts';
import {validateWhatsAppInteractivePolicy} from './whatsappInteractivePolicy.ts';

const BUTTON_ID=/^wa1_[A-Za-z0-9_-]{22}$/;
const ASSIGNMENT_ID=/^[A-Za-z0-9_-]{3,128}$/;
const POLICY_ACTIONS=new Set(['assignment_approve','assignment_reject']);
const MAX_JSON=8192;
const MAX_BINDINGS=2;
function invalid(message:string):never{throw Error('Invalid interactive button snapshot: '+message);}
function newButtonId(){
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 let chars='';for(const byte of bytes)chars+=String.fromCharCode(byte);
 return 'wa1_'+btoa(chars).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function originSnapshot(job:any){
 if(!job||job.source_type!=='assignment_new'||!ASSIGNMENT_ID.test(job.id||'')||
  !ASSIGNMENT_ID.test(job.event_service_id||'')||
  !ASSIGNMENT_ID.test(job.supplier_id||'')||
  !['green','wasender'].includes(job.requested_provider||job.provider)||
  !ASSIGNMENT_ID.test(job.sender_account_id||'')||
  !/^r[1-9][0-9]{0,12}$/.test(job.assignment_revision||'')||
  !/^[1-9][0-9]{7,14}@c\.us$/.test(job.chat_id||''))invalid('origin');
 return {jobId:job.id,eventServiceId:job.event_service_id,supplierId:job.supplier_id,
  provider:job.requested_provider||job.provider,senderAccountId:job.sender_account_id,
  revision:job.assignment_revision,chatId:job.chat_id};
}
function parseSnapshot(raw:any,expectedJob:any){
 if(typeof raw!=='string'||raw.length===0||raw.length>MAX_JSON)return null;
 try{
  const data=JSON.parse(raw),origin=originSnapshot(expectedJob);
  if(!data||data.version!==1||data.jobId!==origin.jobId||
   data.eventServiceId!==origin.eventServiceId||data.supplierId!==origin.supplierId||
   data.chatId!==origin.chatId||data.provider!==origin.provider||
   data.senderAccountId!==origin.senderAccountId||data.revision!==origin.revision||
   !Array.isArray(data.buttons)||data.buttons.length<1||data.buttons.length>MAX_BINDINGS)return null;
  const ids=new Set(),actions=new Set();
  for(const button of data.buttons){
   if(typeof button.buttonId!=='string'||!BUTTON_ID.test(button.buttonId)||
    !POLICY_ACTIONS.has(button.action)||actions.has(button.action)||
    ids.has(button.buttonId)||typeof button.actionToken!=='string'||
    button.actionToken.length<70||button.actionToken.length>2300||
    typeof button.label!=='string'||button.label.length<1||button.label.length>25)
    return null;
   ids.add(button.buttonId);actions.add(button.action);
  }
  return data;
 }catch{return null;}
}
export async function createFutureInteractiveButtonSnapshot(input:{
 job:any;policy:any;signingSecret:string;issuedAt?:number;nonceFactory?:()=>string
},subtle:SubtleCrypto=crypto.subtle){
 const job=input?.job;
 if(!job||!['queued','sending'].includes(job.status))invalid('not_pre_dispatch');
 const origin=originSnapshot(job);
 if(job.interactive_button_bindings_json){
  const saved=parseSnapshot(job.interactive_button_bindings_json,job);
  if(!saved)invalid('corrupt_existing_snapshot');
  // Immutable persisted binding must be used after any worker restart.
  return job.interactive_button_bindings_json;
 }
 const policy=validateWhatsAppInteractivePolicy(input.policy);
 if(!policy.enabled)invalid('feature_off');
 const reply=policy.buttons.filter(b=>POLICY_ACTIONS.has(b.action));
 if(!reply.length||reply.length>MAX_BINDINGS)invalid('unsupported_actions');
 const issuedAt=input.issuedAt??Date.now();
 const nonce=input.nonceFactory??(()=>crypto.randomUUID().replace(/-/g,''));
 const ttl=new Date(issuedAt+Math.min(7*86400000,2*86400000)).toISOString();
 const buttons=[];
 for(const button of reply){
  const actionToken=await createSignedWhatsAppAction({
   binding:{companyId:'shirat_hanevel',eventServiceId:origin.eventServiceId,
    supplierId:origin.supplierId,revision:origin.revision,outboxJobId:origin.jobId,
    provider:origin.provider,senderAccountId:origin.senderAccountId,
    action:button.action,expiresAt:ttl},
   nonce:nonce(),secret:input.signingSecret,issuedAt
  },subtle);
  buttons.push({buttonId:newButtonId(),action:button.action,
   label:button.label,actionToken});
 }
 const encoded=JSON.stringify({version:1,jobId:origin.jobId,
  eventServiceId:origin.eventServiceId,supplierId:origin.supplierId,chatId:origin.chatId,
  provider:origin.provider,senderAccountId:origin.senderAccountId,
  revision:origin.revision,buttons});
 if(encoded.length>MAX_JSON)invalid('oversized');
 return encoded;
}
export function resolveSignedActionForGreenButton(job:any,click:{
 buttonId:string;provider:string;senderAccountId:string;
 originalProviderMessageId:string;senderChatId:string}){
 if(!job||job.status!=='accepted'||job.source_type!=='assignment_new'||
  job.provider!=='green'||click.provider!=='green'||
  job.provider_message_id!==click.originalProviderMessageId||
  job.chat_id!==click.senderChatId||
  job.sender_account_id!==click.senderAccountId)return null;
 const saved=parseSnapshot(job.interactive_button_bindings_json,job);
 if(!saved)return null;
 const match=saved.buttons.find((button:any)=>button.buttonId===click.buttonId);
 return match?.actionToken||null;
}
