// V2 opaque Green button bridge. The provider sees ONLY short random IDs.
// The long per-action HMAC tokens are kept in an immutable Outbox snapshot,
// signed as a whole and verified again upon a real callback. No effect on
// the production V1 assignment wire, worker, inbox or provider config.
// IMPORTANT: callers MUST atomically persist this snapshot on a queued job
// before its first provider attempt, using a compare-and-swap. This helper
// does not persist, send, enqueue, acknowledge or mutate any business row.
import {createSignedWhatsAppActionV2,verifySignedWhatsAppV2Origin,
 verifySignedWhatsAppActionV2} from './whatsappSignedActionV2.ts';
import {getInteractiveActionContract,getInteractiveMessageContract,
 type InteractiveActionRegistry} from './whatsappInteractiveActionRegistry.ts';
import {STAGED_V2_WHATSAPP_ACTIONS} from './whatsappV2StagedActionRegistry.ts';

const DOMAIN='pulse-shirat-opaque-button-map:v2\n';
const BYTE_ENCODER=new TextEncoder();
const BUTTON=/^wa2_[A-Za-z0-9_-]{22}$/;
const MAC=/^[A-Za-z0-9_-]{43}$/;
const LABEL=/^[^\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]{1,20}$/u;
const CHAT=/^[1-9][0-9]{7,14}@c\.us$/;
const ID=/^[A-Za-z0-9_-]{3,128}$/;
const INSTANCE=/^[0-9]{5,20}$/;
const MAX_BYTES=8500;
type ActionRow={buttonId:string;action:string;label:string;actionToken:string};
type Snapshot={
 version:2;jobId:string;messageKind:string;sourceType:string;
 senderAccountId:string;chatId:string;buttons:ActionRow[];snapshotMac:string
};
function fail(reason:string):never{
 throw Error('WhatsApp V2 button snapshot: '+reason);
}
function b64(bytes:Uint8Array):string{
 let binary='';for(const value of bytes)binary+=String.fromCharCode(value);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decodeMac(text:string):Uint8Array|null{
 if(!MAC.test(text))return null;
 try{
  const raw=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'=');
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  return bytes.length===32&&b64(bytes)===text?bytes:null;
 }catch{return null;}
}
async function key(secret:string,subtle:SubtleCrypto){
 if(typeof secret!=='string'||secret.length<32||secret.length>512)fail('secret');
 return subtle.importKey('raw',BYTE_ENCODER.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function opaqueId():string{
 return 'wa2_'+b64(crypto.getRandomValues(new Uint8Array(16)));
}
function eligibleJob(job:any){
 return !!job&&job.message_type==='text'&&
  job.requested_provider==='green'&&
  job.company_id==='shirat_hanevel'&&
  ID.test(job.id||'')&&
  ID.test(job.resource_id||'')&&ID.test(job.recipient_id||'')&&
  INSTANCE.test(job.sender_account_id||'')&&
  CHAT.test(job.chat_id||'')&&
  /^r[1-9][0-9]{0,12}$/.test(job.revision||'')&&
  job.status==='queued'&&Number(job.attempt_count||0)===0&&
  !job.send_started_at&&!job.provider_message_id;
}
function originMatches(job:any,messageKind:string,registry:InteractiveActionRegistry){
 const contract=getInteractiveMessageContract(messageKind,registry);
 return !!contract&&contract.sourceType===job.source_type&&
  contract.resourceType===job.resource_type&&contract.audience===job.recipient_audience&&
  job.message_kind===contract.messageKind&&
  job.resource_id===job.id&&
  job.recipient_id===job.supplier_id;
}
function identityMatches(job:any,snapshot:any,accepted:boolean){
 if(!job||!snapshot||snapshot.version!==2||
  snapshot.jobId!==job.id||snapshot.messageKind!==job.message_kind||
  snapshot.sourceType!==job.source_type||
  snapshot.senderAccountId!==job.sender_account_id||
  snapshot.chatId!==job.chat_id||
  job.company_id!=='shirat_hanevel'||job.requested_provider!=='green'||
  (accepted&&(job.status!=='accepted'||job.provider!=='green'||
   !ID.test(job.provider_message_id||''))))return false;
 return true;
}
export async function createV2OpaqueButtonSnapshot(input:{
 job:any;actions:readonly {action:string;label:string}[];
 signingSecret:string;now?:number;ttlMs?:number;
 registry?:InteractiveActionRegistry;subtle?:SubtleCrypto
}):Promise<string>{
 const job=input?.job,registry=input?.registry??STAGED_V2_WHATSAPP_ACTIONS;
 if(!eligibleJob(job)||!originMatches(job,job.message_kind,registry))
  fail('origin_not_eligible');
 if(job.interactive_v2_button_bindings_json)fail('snapshot_already_exists');
 const defs=input?.actions;
 if(!Array.isArray(defs)||defs.length<1||defs.length>2)
  fail('action_count');
 const now=input.now??Date.now(),ttl=input.ttlMs??86400000;
 if(!Number.isSafeInteger(ttl)||ttl<60000||ttl>7*86400000)
  fail('expiry');
 const subtle=input.subtle??crypto.subtle;
 const seen=new Set<string>(),buttonIds=new Set<string>(),buttons:ActionRow[]=[];
 for(const def of defs){
  if(!def||typeof def.action!=='string'||seen.has(def.action)||
   typeof def.label!=='string'||def.label.trim()!==def.label||
   !LABEL.test(def.label))fail('action_or_label');
  const contract=getInteractiveActionContract(job.message_kind,def.action,registry);
  if(!contract||contract.delivery!=='reply'||
   ['not_implemented','office_link'].includes(contract.handler))
   fail('action_not_implemented');
  seen.add(def.action);
  const binding={
   schemaVersion:2 as const,companyId:job.company_id,
   messageKind:job.message_kind,sourceType:job.source_type,
   resourceType:job.resource_type,resourceId:job.resource_id,
   audience:job.recipient_audience,recipientId:job.recipient_id,
   outboxJobId:job.id,provider:'green' as const,
   senderAccountId:job.sender_account_id,recipientChatId:job.chat_id,
   revision:job.revision,action:def.action,
   issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+ttl).toISOString()
  };
  const token=await createSignedWhatsAppActionV2({
   binding,secret:input.signingSecret,now,registry
  },subtle);
  const buttonId=opaqueId();
  if(buttonIds.has(buttonId))fail('opaque_collision');
  buttonIds.add(buttonId);
  buttons.push({buttonId,action:def.action,label:def.label,actionToken:token});
 }
 const unsigned={
  version:2 as const,jobId:job.id,messageKind:job.message_kind,
  sourceType:job.source_type,senderAccountId:job.sender_account_id,
  chatId:job.chat_id,buttons
 };
 const message=JSON.stringify(unsigned);
 const signature=await subtle.sign('HMAC',await key(input.signingSecret,subtle),
  BYTE_ENCODER.encode(DOMAIN+message));
 const frozen=JSON.stringify({...unsigned,
  snapshotMac:b64(new Uint8Array(signature))});
 if(frozen.length>MAX_BYTES)fail('snapshot_too_large');
 return frozen;
}
export async function verifyV2OpaqueButtonSnapshot(input:{
 job:any;raw:string;signingSecret:string;now?:number;
 registry?:InteractiveActionRegistry;subtle?:SubtleCrypto;
 accepted?:boolean
}):Promise<Snapshot|null>{
 const raw=input?.raw,job=input?.job,registry=input?.registry??STAGED_V2_WHATSAPP_ACTIONS;
 if(typeof raw!=='string'||raw.length<150||raw.length>MAX_BYTES||
  raw!==job?.interactive_v2_button_bindings_json)return null;
 let snapshot:any;
 try{snapshot=JSON.parse(raw);}catch{return null;}
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||
  Object.keys(snapshot).sort().join(',')!==
   'buttons,chatId,jobId,messageKind,senderAccountId,snapshotMac,sourceType,version'||
  !identityMatches(job,snapshot,input.accepted===true)||
  !Array.isArray(snapshot.buttons)||snapshot.buttons.length<1||
  snapshot.buttons.length>2||!MAC.test(snapshot.snapshotMac))return null;
 const {snapshotMac,...unsigned}=snapshot;
 const subtle=input.subtle??crypto.subtle;
 try{
  const mac=decodeMac(snapshotMac);
  if(!mac||!(await subtle.verify('HMAC',await key(input.signingSecret,subtle),
   mac,BYTE_ENCODER.encode(DOMAIN+JSON.stringify(unsigned)))))return null;
  const actions=new Set<string>(),ids=new Set<string>();
  for(const row of snapshot.buttons){
   if(!row||typeof row!=='object'||Array.isArray(row)||
    Object.keys(row).sort().join(',')!=='action,actionToken,buttonId,label'||
    !BUTTON.test(row.buttonId)||!LABEL.test(row.label)||
    row.label.trim()!==row.label||ids.has(row.buttonId)||
    actions.has(row.action))return null;
   const contract=getInteractiveActionContract(snapshot.messageKind,row.action,registry);
   if(!contract||contract.delivery!=='reply'||
    ['office_link','not_implemented'].includes(contract.handler))return null;
   const token=await verifySignedWhatsAppActionV2({
    token:row.actionToken,secret:input.signingSecret,
    now:input.now??Date.now(),registry
   },subtle);
   if(!token||token.outboxJobId!==job.id||token.action!==row.action||
    token.recipientChatId!==job.chat_id||
    token.recipientId!==job.recipient_id||
    token.senderAccountId!==job.sender_account_id||
    token.revision!==job.revision||
    token.resourceId!==job.resource_id||
    token.messageKind!==job.message_kind)return null;
   actions.add(row.action);ids.add(row.buttonId);
  }
  return Object.freeze(snapshot) as Snapshot;
 }catch{return null;}
}
export async function resolveAuthenticatedV2GreenButton(input:{
 job:any;click:any;signingSecret:string;now?:number;
 registry?:InteractiveActionRegistry;subtle?:SubtleCrypto
}){
 const {job,click}=input;
 if(!click||click.provider!=='green'||
  click.senderAccountId!==job?.sender_account_id||
  click.senderChatId!==job?.chat_id||
  click.originalProviderMessageId!==job?.provider_message_id||
  !BUTTON.test(click.buttonId||''))return null;
 const registry=input.registry??STAGED_V2_WHATSAPP_ACTIONS;
 const snapshot=await verifyV2OpaqueButtonSnapshot({
  job,raw:job?.interactive_v2_button_bindings_json,
  signingSecret:input.signingSecret,now:input.now,registry,
  subtle:input.subtle,accepted:true
 });
 const selected=snapshot?.buttons.find(row=>row.buttonId===click.buttonId);
 if(!selected)return null;
 const signed=await verifySignedWhatsAppV2Origin({
  token:selected.actionToken,secret:input.signingSecret,trustedOutbox:job,
  authenticatedProviderEvent:{...click,action:selected.action},
  now:input.now,registry
 },input.subtle??crypto.subtle);
 return signed?Object.freeze({
  action:signed.action,receiptKey:'v2:green:'+
   click.senderAccountId+':'+click.providerEventId,
  providerEventId:click.providerEventId,
  originOutboxId:job.id,resourceId:signed.resourceId,
  recipientId:signed.recipientId,recipientChatId:signed.recipientChatId,
  messageKind:signed.messageKind,revision:signed.revision,
  providerMessageId:job.provider_message_id
 }):null;
}
