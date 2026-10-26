// Future provider-button-ID bridge. Green API buttonId length is not fully
// specified, so do not embed a large signed action token in the WhatsApp
// payload. Send a short random opaque id and persist its HMAC-signed binding
// on the OUTBOUND job before the FIRST provider attempt. Never regenerate on
// retry/UNKNOWN: a callback must always resolve to the original exact job.
// This module does not modify Outbox or send any message.
import {createSignedWhatsAppAction,verifySignedWhatsAppAction} from './whatsappSignedAction.ts';
import {validateWhatsAppInteractivePolicy} from './whatsappInteractivePolicy.ts';

const BUTTON_ID=/^wa1_[A-Za-z0-9_-]{22}$/;
const ASSIGNMENT_ID=/^[A-Za-z0-9_-]{3,128}$/;
const POLICY_ACTIONS=new Set(['assignment_approve','assignment_reject']);
const MAX_JSON=8192;
const MAX_BINDINGS=2;
const SNAPSHOT_MAC=/^[A-Za-z0-9_-]{43}$/;
const encoder=new TextEncoder();
const snapshotContext='shirat-wa-frozen-button-snapshot:v1:';
async function macKey(secret:string,subtle:SubtleCrypto){
 if(typeof secret!=='string'||secret.length<32||secret.length>512)invalid('signing_secret');
 return subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function urlBase64(bytes:Uint8Array){
 let raw='';for(const b of bytes)raw+=String.fromCharCode(b);
 return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function verifyFutureButtonSnapshotMac(raw:string,secret:string,
 subtle:SubtleCrypto=crypto.subtle):Promise<boolean>{
 try{
  if(typeof raw!=='string'||raw.length>MAX_JSON)return false;
  const snapshot=JSON.parse(raw);
  if(!snapshot||!SNAPSHOT_MAC.test(snapshot.snapshotMac))return false;
  const {snapshotMac,...unsigned}=snapshot;
  const parsed=atob(snapshotMac.replace(/-/g,'+').replace(/_/g,'/')+'=');
  if(parsed.length!==32)return false;
  const sig=Uint8Array.from(parsed,x=>x.charCodeAt(0));
  return await subtle.verify('HMAC',await macKey(secret,subtle),sig,
    encoder.encode(snapshotContext+JSON.stringify(unsigned)));
 }catch{return false;}
}
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
   typeof data.snapshotMac!=='string'||!SNAPSHOT_MAC.test(data.snapshotMac)||
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
  if(!saved||!(await verifyFutureButtonSnapshotMac(
   job.interactive_button_bindings_json,input.signingSecret,subtle)))
   invalid('corrupt_existing_snapshot');
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
 const unsigned={version:1,jobId:origin.jobId,
  eventServiceId:origin.eventServiceId,supplierId:origin.supplierId,chatId:origin.chatId,
  provider:origin.provider,senderAccountId:origin.senderAccountId,
  revision:origin.revision,buttons};
 // Whole-snapshot HMAC covers labels/order and the action-token scope.
 // Changing a label, deleting a button or reordering cannot silently alter
 // what the provider will display after an unknown result or worker restart.
 const encoded=JSON.stringify(unsigned);
 const mac=await subtle.sign('HMAC',await macKey(input.signingSecret,subtle),
   encoder.encode(snapshotContext+encoded));
 const frozen=JSON.stringify({...unsigned,snapshotMac:urlBase64(new Uint8Array(mac))});
 if(frozen.length>MAX_JSON)invalid('oversized');
 return frozen;
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
// Future authenticated inbound adapter MUST use this async variant. The
// legacy sync lookup is only structural, not sufficient to authorize action.
export async function resolveVerifiedGreenActionForButton(job:any,click:{
 buttonId:string;provider:string;senderAccountId:string;
 originalProviderMessageId:string;senderChatId:string
},secret:string,subtle:SubtleCrypto=crypto.subtle,now=Date.now()):Promise<string|null>{
 const candidate=resolveSignedActionForGreenButton(job,click);
 if(!candidate||!(await verifyFutureButtonSnapshotMac(
   job.interactive_button_bindings_json,secret,subtle)))return null;
 const bound=await verifySignedWhatsAppAction({token:candidate,secret,now},subtle);
 if(!bound||bound.companyId!=='shirat_hanevel'||bound.provider!=='green'||
  bound.senderAccountId!==job.sender_account_id||
  bound.outboxJobId!==job.id||bound.eventServiceId!==job.event_service_id||
  bound.supplierId!==job.supplier_id||bound.revision!==job.assignment_revision)
  return null;
 return candidate;
}
