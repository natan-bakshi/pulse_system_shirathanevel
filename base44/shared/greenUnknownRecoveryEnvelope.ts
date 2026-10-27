// INTERNAL, dormant encrypted recovery envelope for unrecognized Green
// INTERACTIVE callbacks ONLY. No public route, no provider call, no DB write.
// This never authorizes a supplier transition or HTTP 200 by itself.
//
// Unlike an HMAC-only quarantine marker, this can be decrypted by a future
// independently authorized recovery worker BEFORE its fixed expiration.
// Encryption is OFF unless the owner has approved a separate retention policy
// and a dedicated, randomly generated, 32-byte AES-GCM secret is supplied from
// trusted SERVER configuration (never webhook JSON, browser or action HMAC key).
// Production enablement also requires verified physical deletion, key rotation
// and an operational review path. No such enablement exists today.
const EXPIRES_MS=48*60*60*1000;
const MAX_PLAINTEXT_BYTES=12*1024;
const KEY_ID=/^v[1-9][0-9]{0,2}-[a-z0-9_-]{3,32}$/;
const HEX=/^[a-f0-9]{64}$/;
const DIGEST=/^gq1_[a-f0-9]{64}$/;
const GCM_NONCE_BYTES=12;
const denied=()=>Object.assign(new Error('encrypted_unknown_recovery_unavailable'),
 {code:'encrypted_unknown_recovery_unavailable'});
const encoder=new TextEncoder();
const utf8=text=>encoder.encode(text);
const toB64Url=bytes=>{
 let encoded='';
 for(const n of bytes)encoded+=String.fromCharCode(n);
 return btoa(encoded).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const fromB64Url=text=>{
 if(typeof text!=='string'||!/^[a-zA-Z0-9_-]+$/.test(text))
  throw denied();
 try{
  const binary=atob(text.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(binary,ch=>ch.charCodeAt(0));
 }catch{throw denied();}
};
async function cryptoKey(encoded,subtle){
 const key=fromB64Url(encoded);
 if(key.length!==32||toB64Url(key)!==encoded)throw denied();
 return subtle.importKey('raw',key,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
// Stable key ordering prevents semantically identical provider redeliveries
// from appearing to contain a changed payload. Input is JSON from the bounded
// authenticated HTTP decoder: no functions, cycles or undefined values.
export function canonicalGreenCallbackJson(value){
 let visited=0;
 const walk=(current,depth)=>{
  if(++visited>2200||depth>28)throw denied();
  if(current===null||typeof current!=='object')return current;
  if(Array.isArray(current))return current.map(entry=>walk(entry,depth+1));
  const output={};
  for(const key of Object.keys(current).sort()){
   if(key==='__proto__'||key==='constructor'||key==='prototype')
    throw denied();
   output[key]=walk(current[key],depth+1);
  }
  return output;
 };
 try{return JSON.stringify(walk(value,0));}
 catch{throw denied();}
}
const INTERACTIVE_HINT=/button|interactive|list|reply/i;
export function looksLikeUnknownInteractiveGreenMessage(raw){
 const body=raw?.messageData;
 if(!body||typeof body!=='object'||Array.isArray(body))return false;
 if(typeof body.typeMessage==='string'&&
    INTERACTIVE_HINT.test(body.typeMessage))return true;
 const candidates=['buttonsResponseMessage','templateButtonReplyMessage',
  'interactiveButtonsResponse','interactiveButtonsReply','listResponseMessage',
  'buttonReplyMessage','selectedId','selectedButtonId'];
 return candidates.some(field=>Object.prototype.hasOwnProperty.call(body,field));
}
// Does NOT store senderName, outer provider device data or extra top-level
// metadata. Unknown future selection shape under messageData is kept intact
// inside AES-GCM, strictly capped by byte size.
export function minimalGreenRecoveryCallback(raw){
 if(!looksLikeUnknownInteractiveGreenMessage(raw))throw denied();
 const message={
  typeWebhook:raw.typeWebhook,
  idMessage:raw.idMessage,timestamp:raw.timestamp,
  instanceData:{idInstance:raw.instanceData?.idInstance,
   typeInstance:raw.instanceData?.typeInstance},
  senderData:{chatId:raw.senderData?.chatId,
   sender:raw.senderData?.sender},
  messageData:raw.messageData
 };
 const json=canonicalGreenCallbackJson(message);
 if(utf8(json).length>MAX_PLAINTEXT_BYTES)throw denied();
 return json;
}
function aad(data,expires,keyId){
 if(!DIGEST.test(data?.quarantine_key||'')||
  !HEX.test(data?.payload_mac||'')||
  !KEY_ID.test(keyId)||typeof expires!=='string'||
  !Number.isFinite(Date.parse(expires)))throw denied();
 return utf8(['shirat_hanevel','green','unknown-callback-recovery-v1',
  data.quarantine_key,data.payload_mac,keyId,expires].join('|'));
}
export async function encryptUnknownGreenRecovery(raw,data,opts){
 const now=opts?.now??Date.now();
 if(opts?.ownerRetentionApproved!==true||
  !Number.isSafeInteger(now)||now<0||
  !KEY_ID.test(opts?.keyId||'')||
  typeof opts?.encryptionKey!=='string')throw denied();
 const subtle=opts.subtle??crypto.subtle;
 const key=await cryptoKey(opts.encryptionKey,subtle);
 const payload=utf8(minimalGreenRecoveryCallback(raw));
 const expires=new Date(now+EXPIRES_MS).toISOString();
 const nonce=crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES));
 const ciphertext=await subtle.encrypt({
  name:'AES-GCM',iv:nonce,additionalData:aad(data,expires,opts.keyId),
  tagLength:128
 },key,payload);
 return {
  recovery_version:'aes256gcm-v1',recovery_status:'encrypted',
  recovery_key_id:opts.keyId,recovery_nonce:toB64Url(nonce),
  recovery_ciphertext:toB64Url(new Uint8Array(ciphertext)),
  recovery_expires_at:expires
 };
}
// Private helper for a future owner-reviewed backend recovery worker, NEVER
// called from UI or webhook automatically. Expired payloads fail even if the
// ciphertext remains at rest awaiting physical deletion. Successful decrypt
// is not authorization to apply the embedded click: the recovered callback
// MUST repeat provider, Outbox, HMAC, revision and receipt verification.
export async function decryptUnknownGreenRecovery(row,opts){
 const now=opts?.now??Date.now();
 if(!Number.isSafeInteger(now)||now<0||
  row?.recovery_version!=='aes256gcm-v1'||
  row?.recovery_status!=='encrypted'||
  !KEY_ID.test(row.recovery_key_id||'')||
  opts?.keyId!==row.recovery_key_id||
  typeof row.recovery_ciphertext!=='string'||
  row.recovery_ciphertext.length>25000||
  typeof opts?.encryptionKey!=='string')throw denied();
 const expires=Date.parse(row.recovery_expires_at||'');
 if(!Number.isFinite(expires)||now>=expires||
  expires-now>EXPIRES_MS)throw denied();
 const nonce=fromB64Url(row.recovery_nonce);
 if(nonce.length!==GCM_NONCE_BYTES)throw denied();
 const bytes=fromB64Url(row.recovery_ciphertext);
 if(bytes.length<17||bytes.length>MAX_PLAINTEXT_BYTES+16)throw denied();
 try{
  const subtle=opts.subtle??crypto.subtle;
  const key=await cryptoKey(opts.encryptionKey,subtle);
  const plaintext=await subtle.decrypt({
   name:'AES-GCM',iv:nonce,
   additionalData:aad(row,row.recovery_expires_at,row.recovery_key_id),
   tagLength:128
  },key,bytes);
  const json=new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
  const callback=JSON.parse(json);
  // Reject arbitrary decrypted JSON shape as an additional defense-in-depth
  // check. No unknown button is EVER directly applied here.
  if(!looksLikeUnknownInteractiveGreenMessage(callback)||
    callback?.typeWebhook!=='incomingMessageReceived')throw denied();
  return {callback,recoveryExpiresAt:row.recovery_expires_at,
   recoveredForManualReviewOnly:true,neverApplySupplierAutomatically:true,
   providerVerificationStillRequired:true};
 }catch{throw denied();}
}
export const UNKNOWN_RECOVERY_TTL_HOURS=48;
