// Pure, provider-specific rendering for future GREEN API interactive sends.
// Never fetch(), never creates an Outbox job and never modifies a supplier.
// Must be called by a guarded worker ONLY after account-level beta capability
// QA, a frozen Outbox snapshot CAS and explicit owner rollout permission.
// Official beta methods (2026-10): sendInteractiveButtonsReply (reply buttons)
// or sendInteractiveButtons (mixed reply + URL). Old sendButtons returns 403.
import {verifyFutureButtonSnapshotMac} from './whatsappButtonBindings.ts';
import {verifySignedWhatsAppAction} from './whatsappSignedAction.ts';
import {buildOfficeWhatsAppInquiryLink,type OfficeContextMode} from './whatsappOfficeInquiryLink.ts';

const PRIVATE_CHAT=/^[1-9][0-9]{7,14}@c\.us$/;
const OFFICE=/^[1-9][0-9]{7,14}$/;
const BUTTON=/^wa1_[A-Za-z0-9_-]{22}$/;
const allowed=new Set(['assignment_approve','assignment_reject']);
const fail=(reason:string)=>Object.assign(new Error(reason),{code:reason});
type Mode='reply_only'|'mixed_url'|'plain_fallback';
export type GreenOutboundPreview={
 method:'sendInteractiveButtonsReply'|'sendInteractiveButtons'|'sendMessage';
 body:any;kind:'interactive_reply'|'interactive_mixed'|'plain_text';
 fallbackReason:string;providerRequestsMade:0
};
function textBody(job:any){
 const text=job?.message_text;
 if(typeof text!=='string'||!text.trim()||text.length>4096)
  throw fail('invalid_assignment_message_text');
 return text;
}
function officeUrl(digits:string,job:any,mode:OfficeContextMode){
 if(digits===''||digits===undefined)return '';
 if(typeof digits!=='string'||!OFFICE.test(digits))
  throw fail('invalid_office_number');
 return buildOfficeWhatsAppInquiryLink({
  officeNumber:digits,outboxJobId:job.id,messageText:job.message_text,
  contextMode:mode
 });
}
function appendOfficeToText(text:string,url:string){
 const suffix=url?'\n\nליצירת קשר עם המשרד: '+url:'';
 if(text.length+suffix.length>4096)throw fail('fallback_message_too_long');
 return text+suffix;
}
export async function previewGreenInteractiveAssignment(input:{
 job:any;frozenSnapshot?:string;signingSecret?:string;
 capability:'reply_only'|'mixed_url'|'unknown';
 rolloutEnabled:boolean;officeNumber?:string;officeLabel?:string;
 officeContextMode?:OfficeContextMode;
 now?:number;subtle?:SubtleCrypto
}):Promise<GreenOutboundPreview>{
 const job=input?.job;
 if(!job||job.source_type!=='assignment_new'||
  job.message_type!=='text'||job.requested_provider!=='green'||
  !PRIVATE_CHAT.test(job.chat_id||''))throw fail('ineligible_interactive_job');
 const text=textBody(job);
 // Context is opt-in. The link opens an editable draft in the office chat,
 // not a native quoted reply across chats or a supplier approval action.
 const url=officeUrl(input.officeNumber??'',job,input.officeContextMode??'none');
 const fallback=(reason:string,includeOfficeLink:boolean):GreenOutboundPreview=>({
  method:'sendMessage',body:{chatId:job.chat_id,
   // An inactive feature MUST leave existing plain-text sends unchanged.
   message:includeOfficeLink?appendOfficeToText(text,url):text},
  kind:'plain_text',fallbackReason:reason,providerRequestsMade:0
 });
 // Unknown capabilities or disabled rollout MUST retain existing delivery.
 // A draft settings record can never turn on beta methods by itself.
 if(input.rolloutEnabled!==true)return fallback('interactive_rollout_disabled',false);
 if(!['reply_only','mixed_url'].includes(input.capability))
  return fallback('provider_capability_unverified',true);
 if(job.status!=='sending')throw fail('interactive_job_not_claimed');
 if(typeof input.frozenSnapshot!=='string'||input.frozenSnapshot!==job.interactive_button_bindings_json)
  throw fail('frozen_snapshot_missing_or_changed');
 const subtle=input.subtle??crypto.subtle,now=input.now??Date.now();
 if(!await verifyFutureButtonSnapshotMac(input.frozenSnapshot,input.signingSecret||'',subtle))
  throw fail('invalid_snapshot_signature');
 let saved:any;
 try{saved=JSON.parse(input.frozenSnapshot);}catch{throw fail('invalid_frozen_snapshot');}
 if(saved.version!==1||saved.jobId!==job.id||saved.eventServiceId!==job.event_service_id||
  saved.supplierId!==job.supplier_id||saved.provider!=='green'||
  saved.senderAccountId!==job.sender_account_id||saved.revision!==job.assignment_revision||
  saved.chatId!==job.chat_id||
  !Array.isArray(saved.buttons)||saved.buttons.length<1||saved.buttons.length>2)
  throw fail('snapshot_origin_mismatch');
 const buttons=[];
 const actions=new Set();
 for(const b of saved.buttons){
  if(!b||typeof b.buttonId!=='string'||!BUTTON.test(b.buttonId)||
   typeof b.label!=='string'||!b.label.trim()||b.label.length>25||
   !allowed.has(b.action)||actions.has(b.action))
   throw fail('invalid_interactive_button');
  const token=await verifySignedWhatsAppAction({
   token:b.actionToken,secret:input.signingSecret||'',now
  },subtle);
  if(!token||token.companyId!=='shirat_hanevel'||token.provider!=='green'||
   token.outboxJobId!==job.id||token.supplierId!==job.supplier_id||
   token.eventServiceId!==job.event_service_id||token.revision!==job.assignment_revision||
   token.senderAccountId!==job.sender_account_id||token.action!==b.action)
   throw fail('button_action_signature_invalid');
  actions.add(b.action);
  buttons.push({buttonId:b.buttonId,buttonText:b.label});
 }
 if(input.capability==='mixed_url'&&url){
  if(typeof input.officeLabel!=='string'||!input.officeLabel.trim()||
   input.officeLabel.trim()!==input.officeLabel||
   input.officeLabel.length>25||/[\r\n\u0000-\u001f\u007f]/.test(input.officeLabel))
   throw fail('invalid_office_button_label');
  return {method:'sendInteractiveButtons',body:{
   chatId:job.chat_id,body:text,buttons:[
    ...buttons.map(b=>({...b,type:'reply'})),
    {type:'url',buttonId:'contact_office',buttonText:input.officeLabel,url}
   ]},kind:'interactive_mixed',fallbackReason:'',providerRequestsMade:0};
 }
 return {method:'sendInteractiveButtonsReply',body:{
  chatId:job.chat_id,body:appendOfficeToText(text,url),buttons
 },kind:'interactive_reply',fallbackReason:url?'office_link_in_body':'',
 providerRequestsMade:0};
}
