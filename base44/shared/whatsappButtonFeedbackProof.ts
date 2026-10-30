// Domain-separated HMAC for a TERMINAL button-feedback intent, created
// only by the authenticated provider callback during durable receipt CAS.
// WhatsAppInboundReceipt currently has admin-readable/writable entity RLS:
// admin JSON edits must NEVER be able to create authorized outbound feedback.
const encoder=new TextEncoder();
const MAC=/^fb1_[A-Za-z0-9_-]{43}$/;
const SECRET=/^[\s\S]{32,512}$/;
const FIELDS=[
 'id','receipt_key','provider','sender_account_id','provider_event_id',
 'provider_message_id','company_id','event_service_id','supplier_id',
 'assignment_revision','outbox_job_id','action','state','result_code','completed_at'
] as const;
function canonical(row:any):string|null{
 if(!row||typeof row!=='object'||Array.isArray(row))return null;
 const values:string[]=[];
 for(const name of FIELDS){
  const value=row[name];
  if(typeof value!=='string'||value.trim()!==value||
   !value.length||value.length>700||/[\u0000-\u001f\u007f]/.test(value))return null;
  values.push(value);
 }
 if(row.company_id!=='shirat_hanevel'||row.provider!=='green'||
  !['assignment_approve','assignment_reject'].includes(row.action)||
  !['applied','rejected','needs_review'].includes(row.state)||
  !Number.isFinite(Date.parse(row.completed_at)))return null;
 const verdict=(row.state==='applied'&&['applied','already_applied'].includes(row.result_code))||
  (row.state==='rejected'&&[
   'business_conflict','stale_assignment','not_assigned','invalid_assignment',
   'unauthorized_sender','identity_mismatch'
  ].includes(row.result_code))||
  (row.state==='needs_review'&&row.result_code==='unknown_after_write');
 if(!verdict)return null;
 return 'pulse-green-button-feedback-terminal:v1:'+JSON.stringify(values);
}
const urlBase64=(bytes:Uint8Array)=>{
 let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
export async function signTerminalButtonFeedbackProof(
 row:any,secret:string,subtle:SubtleCrypto=crypto.subtle
):Promise<string|null>{
 if(typeof secret!=='string'||!SECRET.test(secret))return null;
 const message=canonical(row);if(!message)return null;
 try{
  const key=await subtle.importKey('raw',encoder.encode(secret),
   {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await subtle.sign('HMAC',key,encoder.encode(message));
  return 'fb1_'+urlBase64(new Uint8Array(signature));
 }catch{return null;}
}
export async function verifyTerminalButtonFeedbackProof(
 row:any,secret:string,subtle:SubtleCrypto=crypto.subtle
):Promise<boolean>{
 if(!row||typeof row.feedback_proof!=='string'||!MAC.test(row.feedback_proof)||
  typeof secret!=='string'||!SECRET.test(secret))return false;
 const message=canonical(row);if(!message)return false;
 try{
  const value=row.feedback_proof.slice(4);
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'=');
  const signature=Uint8Array.from(raw,x=>x.charCodeAt(0));
  if(signature.length!==32)return false;
  const key=await subtle.importKey('raw',encoder.encode(secret),
   {name:'HMAC',hash:'SHA-256'},false,['verify']);
  return await subtle.verify('HMAC',key,signature,encoder.encode(message));
 }catch{return false;}
}
