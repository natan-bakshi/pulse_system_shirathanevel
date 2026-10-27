// DORMANT owner-only Green unknown-button RECOVERY TRIAGE: decrypt one exact
// record on the server and reveal only STRUCTURAL BOOLEAN HINTS, never callback,
// sender number, button label, selectedId, stanzaId, ciphertext or key.
// This does NOT convert provider data into an approved supplier action, and
// does NOT publish a new webhook/decrypt endpoint or modify any data.
// The caller (WhatsAppQueueAdmin) MUST enforce system-owner auth before call.
//
// The 48h retention window is enforced by decryptUnknownGreenRecovery. A
// rotated-out key or action signing secret fails closed. The owner needs an
// independent formal workflow if a callback requires manual intervention.
import {decryptUnknownGreenRecovery} from './greenUnknownRecoveryEnvelope.ts';
import {fingerprintUnknownGreenCallback}
 from './greenUnknownCallbackQuarantine.ts';
import {parseGreenButtonSelection}
 from './greenInteractiveCallback.ts';

const RECID=/^[a-zA-Z0-9_-]{3,128}$/;
const TAIL=/^[a-f0-9]{12}$/;
const HASH=/^gq1_[a-f0-9]{64}$/;
const COMPANY='shirat_hanevel';
const denied=()=>Object.assign(new Error('green_recovery_review_unavailable'),
 {code:'green_recovery_review_unavailable'});
function structuralHints(messageData:any){
 let nodes=0,selected=false,reference=false;
 const visit=(part:any,depth:number)=>{
  if(++nodes>180||depth>12)throw denied();
  if(!part||typeof part!=='object')return;
  if(Array.isArray(part)){
   for(const item of part.slice(0,60))visit(item,depth+1);
   return;
  }
  for(const [key,value] of Object.entries(part)){
   // Field names alone, NEVER values. We do not serialize provider content.
   if(['selectedId','selectedButtonId','selectedRowId','buttonId',
    'selectedButton'].includes(key))selected=true;
   if(['stanzaId','quotedMessageId','quotedStanzaId',
    'originalMessageId'].includes(key))reference=true;
   if(value&&typeof value==='object')visit(value,depth+1);
  }
 };
 visit(messageData,0);
 return {hasSelectionIdentifierHint:selected,hasOriginalMessageReferenceHint:reference};
}
function kindOf(typeMessage:unknown){
 if(typeof typeMessage!=='string')return 'unknown';
 if(/list/i.test(typeMessage))return 'list_like';
 if(/button|interactive|reply/i.test(typeMessage))return 'interactive_like';
 return 'unknown';
}
export async function inspectUnknownGreenRecoveryStructureReadOnly(
 client:any,request:{id?:string;reference?:string},opts:{
 expectedInstanceId:string;fingerprintSecret:string;
 encryptionKey:string;keyId:string;now?:number
 }){
 if(!RECID.test(request?.id||'')||!TAIL.test(request?.reference||'')||
  typeof opts?.expectedInstanceId!=='string'||
  typeof opts?.fingerprintSecret!=='string'||
  typeof opts?.encryptionKey!=='string'||
  typeof opts?.keyId!=='string')throw denied();
 const db=client?.asServiceRole?.entities?.WhatsAppInboundQuarantine;
 if(!db?.get)throw denied();
 const row=await db.get(request.id);
 if(!row||row.id!==request.id||
  row.provider!=='green'||row.company_id!==COMPANY||
  row.state!=='needs_review'||row.format_code!=='unrecognized_interactive'||
  !HASH.test(row.quarantine_key||'')||
  row.quarantine_key.slice(-12)!==request.reference||
  row.recovery_status!=='encrypted'||row.recovery_version!=='aes256gcm-v1'||
  typeof row.registered_at!=='string'||
  !Number.isFinite(Date.parse(row.registered_at)))throw denied();
 try{
  const recovered=await decryptUnknownGreenRecovery(row,{
   encryptionKey:opts.encryptionKey,keyId:opts.keyId,now:opts.now
  });
  const identity=await fingerprintUnknownGreenCallback(recovered.callback,{
   expectedInstanceId:opts.expectedInstanceId,
   fingerprintSecret:opts.fingerprintSecret,
   now:Date.parse(row.registered_at)
  });
  // The original payload_mac HMAC covers the FULL Green envelope, while the
  // encrypted recovery intentionally stores a MINIMAL subset. AES-GCM AAD
  // already authenticates the stored full-payload MAC and quarantine key;
  // recompute independent event identity/time/format from the minimal body.
  // Comparing a recomputed minimal HMAC to the original full HMAC would fail
  // for ordinary harmless senderName/provider metadata and is incorrect.
  if(identity.quarantine_key!==row.quarantine_key||
   identity.provider_event_at!==row.provider_event_at||
   identity.format_code!==row.format_code)throw denied();
  const source=recovered.callback;
  const hints=structuralHints(source.messageData);
  const recognized=!!parseGreenButtonSelection(source,opts.expectedInstanceId,
   opts.now??Date.now());
  return {
   reference:request.reference,
   class:kindOf(source.messageData.typeMessage),
   ...hints,
   formatRecognizedByCurrentParser:recognized,
   originalProviderIdentityReverified:true,
   encryptedPayloadIntegrityVerified:true,
   callbackReleasedToBrowser:false,containsPersonalData:false,
   onlyStructuralHintsReturned:true,
   neverApproveOrRejectSupplier:true,neverSendWhatsApp:true,
   neverReturn200ForUnknown:true,manualInvestigationRequired:true,
   noDatabaseWrites:true,noProviderCalls:true,
   liveInboundNotActivated:true
  };
 }catch{throw denied();}
}
