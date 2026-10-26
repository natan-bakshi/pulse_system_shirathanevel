// Strict normalization boundary AFTER authenticating the real provider payload.
// Does not infer supplier identity from a phone number or arbitrary message text.
import {validateInboundButtonEvent} from './whatsappInboundGuard.ts';
import {validateInteractiveActionBinding,actionBindingMatches} from './whatsappInteractiveActionToken.ts';
import {inboundReceiptKey} from './whatsappInteractiveReceipt.ts';
import type {WhatsAppInteractivePolicy} from './whatsappInteractivePolicy.ts';
export function validateBoundInboundEvent(input:any,policy:WhatsAppInteractivePolicy,now=Date.now()){
 const pre=validateInboundButtonEvent(input,policy);
 if(!pre.valid)return {valid:false,reason:pre.reason};
 let binding;
 try{binding=validateInteractiveActionBinding(input.binding,now);}catch{return {valid:false,reason:'invalid_or_expired_binding'};}
 if(binding.action!==pre.action)return {valid:false,reason:'action_mismatch'};
 const match=actionBindingMatches(binding,{
  companyId:input.companyId,eventServiceId:input.eventServiceId,supplierId:input.supplierId,
  revision:input.revision,outboxJobId:input.outboxJobId,provider:input.provider,
  senderAccountId:input.senderAccountId
 },now);
 if(!match)return {valid:false,reason:'origin_binding_mismatch'};
 if(input.providerMessageId!==input.originalProviderMessageId)return {valid:false,reason:'message_origin_mismatch'};
 return {valid:true,reason:'requires_durable_claim_and_identity',
  dedupeKey:inboundReceiptKey(input),action:pre.action,
  companyId:binding.companyId,eventServiceId:binding.eventServiceId,supplierId:binding.supplierId,
  revision:binding.revision,outboxJobId:binding.outboxJobId};
}
