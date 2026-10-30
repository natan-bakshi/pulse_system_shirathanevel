// INTERNAL future GREEN API webhook adapter; NOT a Base44 public function.
// This file never registers Deno.serve or schedules any workflow. It is
// intentionally opt-in, and may not be wired to a live callback until
// account-level beta and real payload QA, explicit owner approval, and
// safe provider callback acknowledgement/rate limit strategy are complete.
// A provider's authenticated callback is parsed, matched to the *single*
// original accepted Outbox job, and only then handed to the durable coordinator.
// No duplicate-send, no message-body logging, no arbitrary user-facing input.
import {authenticateWhatsAppProviderCallback} from './whatsappProviderWebhookAuth.ts';
import {parseGreenButtonSelection} from './greenInteractiveCallback.ts';
import {resolveVerifiedGreenActionForButton} from './whatsappButtonBindings.ts';
import {processVerifiedWhatsAppAssignmentResponse} from './whatsappInboundCoordinator.ts';
import {legacyRevisionFromOutboxKey} from './legacyAssignmentButtonScope.ts';

const allowedFields=[
 'id','status','source_type','provider','requested_provider','provider_message_id',
 'sender_account_id','assignment_revision','event_service_id','supplier_id',
 'chat_id','interactive_button_bindings_json','interactive_qa_required',
 'idempotency_key'
] as const;
const closed=(reason:string)=>({status:'refused',reason,
 providerCalls:0,supplierWritesAuthorized:false});
export async function processFutureGreenButtonCallback(input:{
 client:any;headers:any;rawCallback:any;callbackByteLength:number;
 expectedInstanceId:string;webhookSecret:string;actionSigningSecret:string;
 trustedRolloutEnabled:boolean;accountCapabilityVerified:boolean;
 claimOwner:string;recalculateEventStatus:(eventId:string)=>Promise<any>;
 qaEventServiceId?:string;qaPreviousEventServiceId?:string;qaSupplierId?:string;
 legacyCanaryApproved?:true;
 now?:number;subtle?:SubtleCrypto
}){
 // Feature disabled => zero reads. Reject invalid size BEFORE parsing JSON.
 if(input?.trustedRolloutEnabled!==true||input?.accountCapabilityVerified!==true)
  return closed('rollout_disabled');
 if(!Number.isSafeInteger(input.callbackByteLength)||
  input.callbackByteLength<20||input.callbackByteLength>32768)
  return closed('invalid_callback_size');
 if(!authenticateWhatsAppProviderCallback({
  provider:'green',headers:input.headers,webhookSecret:input.webhookSecret
 }))return closed('provider_authentication_failed');
 const now=input.now??Date.now();
 const click=parseGreenButtonSelection(input.rawCallback,input.expectedInstanceId,now);
 if(!click)return closed('invalid_green_callback_shape');
 const db=input?.client?.asServiceRole?.entities?.WhatsAppOutbox;
 if(!db||typeof db.filter!=='function')
  return closed('outbox_lookup_unavailable');
 let jobs:any[];
 try{
  jobs=await db.filter({
   source_type:'assignment_new',status:'accepted',provider:'green',
   sender_account_id:input.expectedInstanceId,
   provider_message_id:click.originalProviderMessageId,
   chat_id:click.senderChatId
  },'-created_date',2,0,[...allowedFields]);
 }catch{return closed('outbox_lookup_unavailable');}
 if(!Array.isArray(jobs)||jobs.length!==1)
  return closed(jobs?.length>1?'ambiguous_original_message':'original_message_not_found');
 const original=jobs[0];
 // Isolated QA may change only ONE specifically authorized supplier/service.
 // This identity comes from trusted server settings, never the provider body.
 // Reject before action parsing, receipt creation or EventService CAS.
 if(input.qaEventServiceId!==undefined||input.qaSupplierId!==undefined||
  input.qaPreviousEventServiceId!==undefined){
  const VALID_ID=/^[A-Za-z0-9_-]{3,128}$/;
  const previous=input.qaPreviousEventServiceId;
  const current=input.qaEventServiceId||'';
  // The previous fixture is INBOUND ONLY, scoped to the same supplier,
  // chat, provider account and signed original Outbox. Never broaden send.
  if(!VALID_ID.test(current)||!VALID_ID.test(input.qaSupplierId||'')||
   (previous!==undefined&&(!VALID_ID.test(previous)||previous===current))||
   ![current,...(previous?[previous]:[])].includes(original.event_service_id)||
   original.supplier_id!==input.qaSupplierId||
   (original.interactive_qa_required!==true&&
    !(input.legacyCanaryApproved===true&&original.event_service_id===current&&
      original.assignment_revision===legacyRevisionFromOutboxKey(original))))
   return closed('qa_assignment_outside_scope');
 }
 const token=await resolveVerifiedGreenActionForButton(
  original,click,input.actionSigningSecret,input.subtle??crypto.subtle,now);
 if(!token)return closed('unverified_button_binding');
 return processVerifiedWhatsAppAssignmentResponse({
  client:input.client,trustedRolloutEnabled:true,
  providerCapabilityVerified:true,claimOwner:input.claimOwner,
  recalculateEventStatus:input.recalculateEventStatus,
  providerEvent:{
   provider:'green',headers:input.headers,webhookSecret:input.webhookSecret,
   actionToken:token,actionSigningSecret:input.actionSigningSecret,
   senderAccountId:click.senderAccountId,
   expectedSenderAccountId:input.expectedInstanceId,
   senderChatId:click.senderChatId,providerEventId:click.providerEventId,
   originalProviderMessageId:click.originalProviderMessageId,
   now,subtle:input.subtle??crypto.subtle
  }
 });
}
