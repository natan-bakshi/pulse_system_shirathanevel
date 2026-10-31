// Proof that a supplier reminder acknowledgement was durably recorded from
// a verified signed V2 Green button. Separate HMAC domain from action token
// and frozen button snapshot. Only a matching, committed Outbox receipt may
// authorize a subsequent feedback message through the EXISTING queue.
const DOMAIN='pulse-shirat-whatsapp-reminder-ack-proof:v2\n';
export const V2_REMINDER_ACK_FEEDBACK_TEXT='אישור קבלת התזכורת נרשם בהצלחה. תודה! פרטי האירוע והעדכונים זמינים ביומן שלך במערכת Pulse.';
const ENC=new TextEncoder();
const MAC=/^[A-Za-z0-9_-]{43}$/;
const ID=/^[A-Za-z0-9_-]{3,180}$/;
const ACCOUNT=/^[0-9]{5,20}$/;
const JID=/^[1-9][0-9]{7,14}@c\.us$/;
function fail(message:string):never{throw Error('Invalid reminder acknowledgement proof: '+message);}
function toB64(bytes:Uint8Array){
 let text='';for(const b of bytes)text+=String.fromCharCode(b);
 return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromB64(str:string){
 if(!MAC.test(str))return null;
 try{
  const s=atob(str.replace(/-/g,'+').replace(/_/g,'/')+'=');
  const bytes=Uint8Array.from(s,x=>x.charCodeAt(0));
  return bytes.length===32&&toB64(bytes)===str?bytes:null;
 }catch{return null;}
}
async function key(secret:string,subtle:SubtleCrypto){
 if(typeof secret!=='string'||secret.length<32||secret.length>512)
  fail('secret');
 return subtle.importKey('raw',ENC.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function payload(row:any){
 if(!row||row.company_id!=='shirat_hanevel'||
  row.message_kind!=='supplier_reminder'||row.source_type!=='event_reminder'||
  row.status!=='accepted'||row.provider!=='green'||
  row.requested_provider!=='green'||row.recipient_audience!=='supplier'||
  row.recipient_id!==row.supplier_id||row.resource_id!==row.id||
  !ID.test(row.id||'')||!ID.test(row.supplier_id||'')||
  !ID.test(row.provider_message_id||'')||
  !ID.test(row.reminder_acknowledgement_event_id||'')||
  !ACCOUNT.test(row.sender_account_id||'')||!JID.test(row.chat_id||'')||
  !/^r[1-9][0-9]{0,12}$/.test(row.revision||'')||
  typeof row.reminder_acknowledged_at!=='string'||
  !Number.isFinite(Date.parse(row.reminder_acknowledged_at)))fail('identity');
 return JSON.stringify([
  2,'reminder_acknowledge',row.id,row.supplier_id,
  row.sender_account_id,row.chat_id,row.provider_message_id,
  row.reminder_acknowledgement_event_id,row.revision,
  new Date(row.reminder_acknowledged_at).toISOString()
 ]);
}
export async function signV2ReminderAckProof(row:any,secret:string,
 subtle:SubtleCrypto=crypto.subtle):Promise<string>{
 const message=payload(row);
 return toB64(new Uint8Array(await subtle.sign('HMAC',await key(secret,subtle),
  ENC.encode(DOMAIN+message))));
}
export async function verifyV2ReminderAckProof(row:any,secret:string,
 subtle:SubtleCrypto=crypto.subtle):Promise<boolean>{
 try{
  const sig=fromB64(row?.reminder_acknowledgement_proof);
  if(!sig)return false;
  return await subtle.verify('HMAC',await key(secret,subtle),sig,
   ENC.encode(DOMAIN+payload(row)));
 }catch{return false;}
}
