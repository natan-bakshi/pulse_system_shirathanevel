// DURABLE, PRIVACY-MINIMIZED staging quarantine for unknown Green button
// callback shapes. No public endpoint imports this yet. NEVER replays an
// event, sends a message, modifies a supplier or turns metadata into approval.
// Unlike a receipt for an authenticated signed button, this record CANNOT
// receive a safe HTTP 200 ACK: raw content is not stored, so a future parser
// cannot recover an unknown button solely from this metadata. The provider
// must retry or a human must investigate separately. This is intentional.
//
// Store two DOMAIN-SEPARATED HMACs only; NEVER raw phone, message/chat text,
// sender contact, selectedId, stanzaId, original JSON or provider event ID.
// Create race safety: independent control-row CAS lease + durable pre-CREATE
// guard. A timed-out create leaves its guard for OWNER review; it NEVER
// auto-clears when the lease expires. Does not block known-button receipts.
import {readWhatsAppQueueControl} from './whatsappOutbox.ts';
import {canonicalGreenCallbackJson,encryptUnknownGreenRecovery,
 looksLikeUnknownInteractiveGreenMessage} from './greenUnknownRecoveryEnvelope.ts';

const COMPANY='shirat_hanevel';
const ID=/^[A-Za-z0-9_-]{5,180}$/;
const CHAT=/^[1-9][0-9]{7,14}@c\.us$/;
const INSTANCE=/^[0-9]{5,20}$/;
const LEASE_MS=25000;
const FIELDS=[
 'id','quarantine_key','payload_mac','provider','company_id','format_code',
 'state','provider_event_at','registered_at','review_code',
 'recovery_status','recovery_expires_at'
];
// ONLY individual exact receipt verification can access ciphertext. The
// owner audit uses FIELDS and never projects encrypted payload or nonce.
const VERIFY_FIELDS=[...FIELDS,'recovery_version','recovery_key_id',
 'recovery_nonce','recovery_ciphertext'];
const denied=(code:string)=>Object.assign(new Error(code),{code});
const iso=(n:number)=>new Date(n).toISOString();
const tagFormat=(value:unknown)=>{
 if(typeof value==='string'&&/button|interactive|list|reply/i.test(value))
  return 'unrecognized_interactive';
 return 'unrecognized_incoming';
};
export function isEligibleUnknownGreenCallback(raw:any,expectedInstanceId:string,
 now=Date.now()):boolean{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  !INSTANCE.test(expectedInstanceId||'')||
  raw.typeWebhook!=='incomingMessageReceived'||
  String(raw.instanceData?.idInstance)!==expectedInstanceId||
  raw.instanceData?.typeInstance!=='whatsapp'||
  typeof raw.idMessage!=='string'||!ID.test(raw.idMessage)||
  !CHAT.test(raw.senderData?.chatId||'')||
  raw.senderData?.sender!==raw.senderData?.chatId||
  !raw.messageData||typeof raw.messageData!=='object'||
  Array.isArray(raw.messageData)||
  !Number.isSafeInteger(now)||now<0||
  !Number.isSafeInteger(raw.timestamp)||raw.timestamp<0)
  return false;
 const millis=raw.timestamp*1000;
 return Number.isSafeInteger(millis)&&
  now-millis<=48*3600000&&millis<=now+300000;
}
export async function fingerprintUnknownGreenCallback(raw:any,opts:{
 expectedInstanceId:string;fingerprintSecret:string;now?:number;
 subtle?:SubtleCrypto
}){
 const now=opts?.now??Date.now();
 if(!isEligibleUnknownGreenCallback(raw,opts?.expectedInstanceId,now)||
  typeof opts?.fingerprintSecret!=='string'||
  opts.fingerprintSecret.length<32||opts.fingerprintSecret.length>4096)
  throw denied('unknown_callback_unverified');
 const subtle=opts.subtle??crypto.subtle;
 const key=await subtle.importKey('raw',new TextEncoder().encode(opts.fingerprintSecret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const hmac=async(value:string)=>{
  const output=await subtle.sign('HMAC',key,new TextEncoder().encode(value));
  return [...new Uint8Array(output)].map(b=>b.toString(16).padStart(2,'0')).join('');
 };
 // The domain separation and keyed digest resist enumeration of event IDs
 // and low-entropy supplier contact data if an admin can read the entity.
 const quarantineKey='gq1_'+await hmac(
  'shirat/unknown-event/v1\u0000'+opts.expectedInstanceId+'\u0000'+raw.idMessage);
 const payloadMac=await hmac(
  'shirat/unknown-payload/v1\u0000'+canonicalGreenCallbackJson(raw));
 return {
  quarantine_key:quarantineKey,payload_mac:payloadMac,
  provider:'green',company_id:COMPANY,
  format_code:tagFormat(raw.messageData.typeMessage),
  state:'needs_review',provider_event_at:iso(raw.timestamp*1000),
  review_code:'unrecognized_button_format'
 };
}
function exact(row:any,data:any){
 const encryptedFields=['recovery_version','recovery_status','recovery_key_id',
  'recovery_nonce','recovery_ciphertext','recovery_expires_at'];
 if(data.recovery_version&&encryptedFields.some(key=>row?.[key]!==data[key]))
  return false;
 return !!row&&!!row.id&&row.quarantine_key===data.quarantine_key&&
  row.payload_mac===data.payload_mac&&row.provider==='green'&&
  row.company_id===COMPANY&&row.format_code===data.format_code&&
  row.state==='needs_review'&&
  row.review_code==='unrecognized_button_format'&&
  row.provider_event_at===data.provider_event_at&&
  Number.isFinite(Date.parse(row.registered_at||''));
}
async function findOne(db:any,key:string,verifyEncrypted=false){
 const rows=await db.filter({quarantine_key:key},'-created_date',2,0,
  verifyEncrypted?VERIFY_FIELDS:FIELDS);
 if(!Array.isArray(rows)||rows.length>1)
  throw denied('unknown_quarantine_duplicate_rows');
 return rows[0]||null;
}
async function reserve(client:any){
 const db=client.asServiceRole.entities.WhatsAppQueueControl;
 const owner=crypto.randomUUID();
 for(let i=0;i<5;i++){
  const control=await readWhatsAppQueueControl(client);
  if(control.unknown_guard_key)
   throw denied('unknown_quarantine_create_requires_review');
  const current=Date.now();
  const expired=Date.parse(control.unknown_create_until||'');
  if(!control.unknown_create_owner||!Number.isFinite(expired)||expired<=current){
   const won=await db.updateMany({
    id:control.id,control_key:'global',
    unknown_create_owner:control.unknown_create_owner??null,
    unknown_create_until:control.unknown_create_until??null,
    unknown_guard_key:control.unknown_guard_key??null
   },{$set:{unknown_create_owner:owner,
    unknown_create_until:iso(current+LEASE_MS)}});
   if(won?.updated===1)
    return {db,id:control.id,owner,oldGuard:control.unknown_guard_key??null};
  }
  if(i<4)await new Promise(resolve=>setTimeout(resolve,15+10*i));
 }
 throw denied('unknown_quarantine_busy');
}
async function release(lease:any,guard:string|null){
 try{
  const match:any={id:lease.id,unknown_create_owner:lease.owner};
  if(guard!==null)match.unknown_guard_key=guard;
  const fields:any={unknown_create_owner:'',unknown_create_until:''};
  if(guard!==null)fields.unknown_guard_key='';
  const result=await lease.db.updateMany(match,{$set:fields});
  return result?.updated===1;
 }catch{return false;}
}
export async function registerUnknownGreenCallbackQuarantine(client:any,raw:any,opts:{
 expectedInstanceId:string;fingerprintSecret:string;now?:number;
 subtle?:SubtleCrypto;
 // Feature is OFF unless BOTH a trusted owner-approved policy and a dedicated
 // server-side recovery secret are supplied. Never passed from provider body.
 encryptedRecovery?:{ownerRetentionApproved:boolean;encryptionKey:string;keyId:string}
}){
 const identity=await fingerprintUnknownGreenCallback(raw,opts);
 const entities=client?.asServiceRole?.entities;
 if(!entities?.WhatsAppInboundQuarantine?.filter||
  !entities?.WhatsAppInboundQuarantine?.create||
  !entities?.WhatsAppQueueControl?.updateMany)
  throw denied('unknown_quarantine_storage_unavailable');
 const lease=await reserve(client);
 let written=false,guard:string|null=null,result:any=null;
 let encryptedRecoveryRecorded=false;
 try{
  const found=await findOne(entities.WhatsAppInboundQuarantine,identity.quarantine_key);
  if(found){
   if(!exact(found,identity))
    throw denied('unknown_quarantine_identity_conflict');
   // Metadata-only projection avoids retrieving private ciphertext on
   // duplicate callbacks; presence is an indicator, NOT decrypt proof.
   encryptedRecoveryRecorded=found.recovery_status==='encrypted';
   result={kind:'duplicate',id:found.id};
  }else{
   // Prepare and authenticate the optional envelope BEFORE taking the
   // irreversible pre-CREATE fence. If encryption fails, no CREATE or
   // persistent guard is needed. Metadata-only remains the default.
   const envelope=opts.encryptedRecovery&&
    looksLikeUnknownInteractiveGreenMessage(raw)?
    await encryptUnknownGreenRecovery(raw,identity,{
     ...opts.encryptedRecovery,now:opts.now??Date.now(),subtle:opts.subtle
    }):{};
   const q=await lease.db.updateMany({
    id:lease.id,unknown_create_owner:lease.owner,
    unknown_guard_key:lease.oldGuard
   },{$set:{unknown_guard_key:identity.quarantine_key}});
   if(q?.updated!==1)throw denied('unknown_quarantine_guard_unverified');
   guard=identity.quarantine_key;
   const complete={...identity,...envelope};
   const created=await entities.WhatsAppInboundQuarantine.create({
    ...complete,registered_at:iso(opts.now??Date.now())
   });
   if(!exact(created,complete))throw denied('unknown_quarantine_create_unverified');
   // Do not consider a returned CREATE response as durability proof; reread
   // exact unique row before clearing the pre-create guard.
   const persisted=await findOne(entities.WhatsAppInboundQuarantine,
    identity.quarantine_key,!!envelope.recovery_version);
   if(!persisted||persisted.id!==created.id||!exact(persisted,complete))
    throw denied('unknown_quarantine_persistence_unverified');
   encryptedRecoveryRecorded=!!envelope.recovery_version;
   written=true;
   result={kind:'stored',id:created.id};
  }
 }finally{
  const released=await release(lease,written?guard:null);
  if(!released&&result)throw denied('unknown_quarantine_release_unverified');
 }
 return {
  kind:result.kind,
  // Unknown future format may still contain an actionable button. No action
  // or HTTP ACK until owner investigates and provider shape is supported.
  state:'needs_review',manualReviewRequired:true,canAcknowledge:false,
  encryptedRecoveryRecorded,terminalReceiptVerified:false,providerCalls:0,
  supplierWritesAuthorized:false,noMessagesSent:true
 };
}
export function summarizeUnknownGreenQuarantine(rows:any[],limit=40,now=Date.now()){
 if(!Array.isArray(rows)||!Number.isSafeInteger(now)||now<0)
  throw denied('unknown_quarantine_audit_unavailable');
 const output=[];
 const retention={encryptedInSample:0,expiredInSample:0,
  invalidExpiryInSample:0,expiringWithin12hInSample:0,
  sampledOnly:true,allRecordsAudited:false,physicalBackupErasureNotVerified:true};
 for(const row of rows.slice(0,limit)){
  if(!row||row.provider!=='green'||row.company_id!==COMPANY||
   !/^gq1_[a-f0-9]{64}$/.test(row.quarantine_key||''))continue;
  if(row.recovery_status==='encrypted'){
   retention.encryptedInSample++;
   const expiry=Date.parse(row.recovery_expires_at||'');
   if(!Number.isFinite(expiry))retention.invalidExpiryInSample++;
   else if(expiry<=now)retention.expiredInSample++;
   else if(expiry<=now+12*3600000)retention.expiringWithin12hInSample++;
  }
  output.push({
   // Internal Base44 entity ID is an opaque lookup handle, not the Green
   // provider event ID. Owner-only: used solely for one exact projected read
   // during a separate user-requested structural review. No phone/chat ID.
   reviewRecordId:typeof row.id==='string'&&
    /^[a-zA-Z0-9_-]{3,128}$/.test(row.id)?row.id:null,
   reference:row.quarantine_key.slice(-12),state:row.state==='needs_review'
    ?'needs_review':'unverified',
   format:row.format_code==='unrecognized_interactive'
    ?'unrecognized_interactive':'unrecognized_incoming',
   receivedAt:Number.isFinite(Date.parse(row.registered_at||''))
    ?row.registered_at:null,
   eventAt:Number.isFinite(Date.parse(row.provider_event_at||''))
    ?row.provider_event_at:null,
   mayChangeSupplier:false,bodyStored:false,
   encryptedRecoveryRecorded:row.recovery_status==='encrypted',
   encryptedRecoveryExpiresAt:row.recovery_status==='encrypted'&&
    Number.isFinite(Date.parse(row.recovery_expires_at||''))
     ?row.recovery_expires_at:null,
   manualReviewRequired:true
  });
 }
 return {sampleCount:output.length,sampleTruncated:rows.length>=limit,
  pendingReview:output.filter(x=>x.state==='needs_review').length,
  noRawMessagesStored:true,unknownButtonsNeverAutoApproved:true,
  retentionSample:retention,list:output};
}
export async function inspectUnknownGreenQuarantineReadOnly(client:any){
 const db=client?.asServiceRole?.entities?.WhatsAppInboundQuarantine;
 if(!db?.list)throw denied('unknown_quarantine_audit_unavailable');
 const rows=await db.list('-created_date',40,0,FIELDS);
 return summarizeUnknownGreenQuarantine(rows,40);
}
