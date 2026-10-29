// READ-ONLY admission gate for the FUTURE provider-specific webhook adapter.
// Not a public backend function. No supplier status mutation, no inbox claim,
// and NO interactive feature activation here. The real adapter must normalize
// fields strictly from verified provider payloads, never user-supplied JSON.
import {authenticateWhatsAppProviderCallback} from './whatsappProviderWebhookAuth.ts';
import {verifySignedWhatsAppAction} from './whatsappSignedAction.ts';
import {assignmentOriginFromOutbox} from './whatsappInteractivePersistence.ts';
import {parseWhatsAppPhone} from './whatsappPhone.ts';
import {supplierAssigned} from './whatsappSupplierTransition.ts';
import {whatsappRevisionEligibility} from './supplierStatusPersistence.ts';
import {normalizeInboundReceipt} from './whatsappInboundInbox.ts';

const MAX_ACCOUNT=128;
const MAX_EVENT_ID=180;
const allowedId=(v:any,max=MAX_EVENT_ID)=>
 typeof v==='string'&&v.length>0&&v.length<=max&&
 v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);
const rejected=(reason:string)=>({admissible:false,reason,noMessagesSent:true} as const);
function supplierPending(row:any,id:string){
 let statuses;
 try{statuses=JSON.parse(row.supplier_statuses||'{}');}catch{return false;}
 return !!statuses&&typeof statuses==='object'&&!Array.isArray(statuses)&&
  (statuses[id]===undefined||statuses[id]==='pending');
}
export async function preflightWhatsAppAssignmentResponse(input:{
 provider:'green'|'wasender';headers:any;webhookSecret:string;
 actionToken:string;actionSigningSecret:string;
 senderAccountId:string;expectedSenderAccountId:string;
 senderChatId:string;providerEventId:string;originalProviderMessageId:string;
 now?:number;subtle?:SubtleCrypto
},serviceClient:any){
 if(!input||!['green','wasender'].includes(input.provider)||
  !allowedId(input.senderAccountId,MAX_ACCOUNT)||
  !allowedId(input.expectedSenderAccountId,MAX_ACCOUNT)||
  input.senderAccountId!==input.expectedSenderAccountId||
  !allowedId(input.providerEventId)||!allowedId(input.originalProviderMessageId))
  return rejected('invalid_provider_event');
 if(!authenticateWhatsAppProviderCallback({
  provider:input.provider,headers:input.headers,webhookSecret:input.webhookSecret
 }))return rejected('provider_authentication_failed');
 const signed=await verifySignedWhatsAppAction({
  token:input.actionToken,secret:input.actionSigningSecret,now:input.now
 },input.subtle??crypto.subtle);
 if(!signed)return rejected('action_signature_invalid');
 if(signed.provider!==input.provider||signed.senderAccountId!==input.senderAccountId)
  return rejected('provider_account_mismatch');
 const sender=parseWhatsAppPhone(input.senderChatId?.replace(/@c\.us$/,''));
 if(sender.status!=='VALID'||sender.chatId!==input.senderChatId)
  return rejected('sender_phone_invalid');
 const db=serviceClient?.entities;
 if(!db?.WhatsAppOutbox?.get||!db?.Supplier?.get||!db?.EventService?.get)
  return rejected('read_only_dependency_unavailable');
 try{
  const [job,supplier,service]=await Promise.all([
   db.WhatsAppOutbox.get(signed.outboxJobId),
   db.Supplier.get(signed.supplierId),
   db.EventService.get(signed.eventServiceId)
  ]);
  const origin=assignmentOriginFromOutbox(job,{
    companyId:signed.companyId,eventServiceId:signed.eventServiceId,
    supplierId:signed.supplierId,revision:signed.revision,
    outboxJobId:signed.outboxJobId,provider:signed.provider,
    senderAccountId:signed.senderAccountId,chatId:sender.chatId,
    providerMessageId:input.originalProviderMessageId
   });
  if(!origin||origin.status!=='accepted')return rejected('unverified_origin');
  // A message from another campaign (invoice, event reminder, etc.) cannot
  // authorize supplier assignment transitions, even with a valid receipt.
  if(job?.source_type!=='assignment_new')return rejected('wrong_message_kind');
  if(!supplier||supplier.is_active===false||
   parseWhatsAppPhone(supplier.phone).chatId!==sender.chatId)
   return rejected('supplier_sender_mismatch');
  if(!service||service.is_external===true)return rejected('supplier_not_assigned');
  // Once the signed original message, account and real supplier sender have
  // been verified, construct the unique provider-event identity BEFORE
  // checking today's business state. On a redelivery after a successful
  // approve/reject, the supplier is no longer pending; only an EXISTING
  // durable receipt with EXACTLY this identity may be classified as replay.
  // No writes, retries or transitions are allowed on this branch.
  const receipt=normalizeInboundReceipt({
   companyId:signed.companyId,eventServiceId:signed.eventServiceId,
   supplierId:signed.supplierId,revision:signed.revision,
   outboxJobId:signed.outboxJobId,provider:signed.provider,
   senderAccountId:signed.senderAccountId,providerEventId:input.providerEventId,
   providerMessageId:input.originalProviderMessageId,action:signed.action
  });
  const historicalOnly=(reason:string)=>({admissible:false,reason,
   verifiedReplayCandidate:receipt,
   // A signed, current-revision button on a resolved assignment may be
   // durably rejected and ACKed, NEVER applied as a new business decision.
   // All provider/origin/supplier checks above must have succeeded first.
   verifiedTerminalRejectionCandidate:[
    'assignment_not_pending','stale_assignment_revision',
    'assignment_intent_inactive','supplier_not_assigned'
   ].includes(reason),
   noMessagesSent:true} as const);
  if(!supplierAssigned(service.supplier_ids,signed.supplierId))
   return historicalOnly('supplier_not_assigned');
  const rev=whatsappRevisionEligibility(service,signed.supplierId,signed.revision);
  if(!rev.allowed)return historicalOnly(rev.reason);
  if(!supplierPending(service,signed.supplierId))
   return historicalOnly('assignment_not_pending');
  return {admissible:true,reason:'verified_read_only',
   receipt,action:signed.action,expiresAt:signed.expiresAt,noMessagesSent:true,
   // Deliberately cannot apply without durable inbox claim and deployment gate.
   requiresDurableClaim:true,requiresRolloutApproval:true};
 }catch{return rejected('context_unavailable');}
}
