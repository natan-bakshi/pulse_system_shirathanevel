// Future Green native text quoting, fail-closed before any provider send.
// This helper makes NO network calls. The caller must obtain GetMessage from
// Green for the ORIGINAL chat/account, verify it here and only then consider
// quotedMessageId on sendMessage. NEVER attach to sendInteractiveButtons:
// Green's current interactive API does not document quotedMessageId.
// No production path calls this module yet; rollout requires owner consent
// for extra GetMessage reads and verified non-delivery-safe fallback.
import {resolveAssignmentQuote,type AssignmentMessageContext}
 from './whatsappInteractiveContext.ts';

const ACCOUNT=/^[0-9]{5,20}$/;
const CHAT=/^[1-9][0-9]{7,14}@c\.us$/;
const RECEIPT=/^[A-Za-z0-9_-]{8,180}$/;
const COMPANY='shirat_hanevel';

export type QuoteReplyContext={
 companyId:string;eventServiceId:string;supplierId:string;revision:string;
 chatId:string;provider:'green';senderAccountId:string;
};
export function verifyGreenQuoteJournal(journal:any,expected:{
 chatId:string;idMessage:string
}):{verified:boolean;reason:string}{
 if(!journal||typeof journal!=='object'||Array.isArray(journal))
  return {verified:false,reason:'journal_unavailable'};
 if(!CHAT.test(expected.chatId)||!RECEIPT.test(expected.idMessage)||
  journal.chatId!==expected.chatId||journal.idMessage!==expected.idMessage)
  return {verified:false,reason:'origin_mismatch'};
 if(journal.type!=='outgoing'||journal.sendByApi!==true)
  return {verified:false,reason:'not_own_api_message'};
 if(!['sent','delivered','read'].includes(journal.statusMessage))
  return {verified:false,reason:'not_verified_as_sent'};
 if(journal.isDeleted===true||journal.deletedMessageId)
  return {verified:false,reason:'origin_deleted'};
 return {verified:true,reason:'journal_confirmed'};
}
export function quoteCandidateFromAcceptedAssignment(outbox:any,
 reply:QuoteReplyContext):{origin:AssignmentMessageContext|null;reason:string}{
 if(!outbox||outbox.source_type!=='assignment_new'||
  outbox.status!=='accepted'||outbox.provider!=='green'||
  outbox.requested_provider!=='green'||!ACCOUNT.test(String(outbox.sender_account_id||''))||
  !CHAT.test(String(outbox.chat_id||''))||
  !RECEIPT.test(String(outbox.provider_message_id||''))||
  (outbox.company_id&&outbox.company_id!==COMPANY))
  return {origin:null,reason:'untrusted_assignment_origin'};
 const result:AssignmentMessageContext={
  companyId:COMPANY,eventServiceId:outbox.event_service_id,
  supplierId:outbox.supplier_id,revision:outbox.assignment_revision,
  chatId:outbox.chat_id,provider:'green',
  senderAccountId:outbox.sender_account_id,
  outboxJobId:outbox.id,providerMessageId:outbox.provider_message_id,
  status:'accepted'
 };
 const eligible=resolveAssignmentQuote(result,reply);
 return eligible.quoteMessageId
  ?{origin:result,reason:'same_revision_and_chat'}
  :{origin:null,reason:eligible.reason};
}
export function chooseVerifiedGreenNativeQuote(input:{
 origin:any;reply:QuoteReplyContext;journal:any;
 targetMethod:'sendMessage'|'sendInteractiveButtons'|'sendInteractiveButtonsReply'|string
}):{quotedMessageId:string|null;reason:string}{
 if(input?.targetMethod!=='sendMessage')
  return {quotedMessageId:null,reason:'interactive_quote_not_documented'};
 const candidate=quoteCandidateFromAcceptedAssignment(input.origin,input.reply);
 if(!candidate.origin)return {quotedMessageId:null,reason:candidate.reason};
 const result=verifyGreenQuoteJournal(input.journal,{
  chatId:input.reply.chatId,idMessage:candidate.origin.providerMessageId
 });
 return result.verified
  ?{quotedMessageId:candidate.origin.providerMessageId,reason:'verified_text_quote'}
  :{quotedMessageId:null,reason:result.reason};
}
// A bounded read, when opt-in has been granted. Do not query while creating
// the original assignment. Caller must still confirm the authoritative
// *current* EventService revision; no stale quote to a changed assignment.
export async function findCandidateForSupplierQuote(client:any,reply:QuoteReplyContext){
 if(!client?.asServiceRole?.entities?.WhatsAppOutbox||
  reply?.companyId!==COMPANY||reply?.provider!=='green'||
  !CHAT.test(reply.chatId)||!ACCOUNT.test(reply.senderAccountId)||
  !RECEIPT.test(reply.eventServiceId)||!RECEIPT.test(reply.supplierId))
  return {origin:null,reason:'invalid_query_scope'};
 const rows=await client.asServiceRole.entities.WhatsAppOutbox.filter({
  source_type:'assignment_new',event_service_id:reply.eventServiceId,
  supplier_id:reply.supplierId,status:'accepted'
 },'-created_date',3);
 if(!Array.isArray(rows)||!rows.length)return {origin:null,reason:'no_assignment_receipt'};
 // Do not select a conveniently matching older message when the newest
 // assignment attempt conflicts. This avoids quoting a stale revision.
 return quoteCandidateFromAcceptedAssignment(rows[0],reply);
}
