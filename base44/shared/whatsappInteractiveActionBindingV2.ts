// V2 STRUCTURAL binding for multiple WhatsApp message kinds and audiences.
// This is a future signing/verification contract, NOT a signed token,
// not an authentication result, not a public API, and never a business handler.
// V1 assignment tokens and their live QA remain unchanged. New kinds require
// explicit code registration, a domain-specific handler, audited HMAC v2,
// durable receipt and separate owner-controlled rollout before activation.
import {getInteractiveActionContract,getInteractiveMessageContract,
 type InteractiveActionRegistry,REGISTERED_WHATSAPP_ACTIONS}
 from './whatsappInteractiveActionRegistry.ts';

const ID=/^[A-Za-z0-9_-]{3,128}$/;
const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const REVISION=/^[rv][1-9][0-9]{0,12}$/;
const LIFETIME=7*24*60*60*1000;
const SKEW=120000;
export type InteractiveActionBindingV2={
 schemaVersion:2;companyId:string;messageKind:string;sourceType:string;
 resourceType:string;resourceId:string;audience:'supplier'|'client'|'admin';
 recipientId:string;outboxJobId:string;provider:'green'|'wasender';
 senderAccountId:string;recipientChatId:string;revision:string;
 action:string;issuedAt:string;expiresAt:string
};
export function validateInteractiveActionBindingV2(raw:any,
 registry:InteractiveActionRegistry=REGISTERED_WHATSAPP_ACTIONS,
 now=Date.now()):InteractiveActionBindingV2{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.schemaVersion!==2)
  throw Error('Invalid V2 action binding version');
 // No executable text, arbitrary metadata, callback, or user-defined function
 // may be smuggled into an envelope intended for signing.
 const fields=['schemaVersion','companyId','messageKind','sourceType',
  'resourceType','resourceId','audience','recipientId','outboxJobId',
  'provider','senderAccountId','recipientChatId','revision','action',
  'issuedAt','expiresAt'];
 if(Object.keys(raw).length!==fields.length||
  Object.keys(raw).some(key=>!fields.includes(key)))
  throw Error('Unexpected V2 action binding field');
 const kind=getInteractiveMessageContract(raw.messageKind,registry);
 const action=getInteractiveActionContract(raw.messageKind,raw.action,registry);
 if(!kind||kind.sourceType!==raw.sourceType||
  kind.resourceType!==raw.resourceType||kind.audience!==raw.audience||
  !action||action.delivery!=='reply')
  throw Error('V2 action outside registered message scope');
 for(const key of ['companyId','resourceId','recipientId','outboxJobId','senderAccountId'])
  if(typeof raw[key]!=='string'||!ID.test(raw[key]))
   throw Error('Invalid V2 scoped identity');
 if(!['green','wasender'].includes(raw.provider)||
  typeof raw.recipientChatId!=='string'||!PRIVATE.test(raw.recipientChatId)||
  typeof raw.revision!=='string'||!REVISION.test(raw.revision))
  throw Error('Invalid V2 provider or recipient');
 const issued=Date.parse(raw.issuedAt),expires=Date.parse(raw.expiresAt);
 if(typeof raw.issuedAt!=='string'||typeof raw.expiresAt!=='string'||
  !Number.isFinite(issued)||!Number.isFinite(expires)||
  issued>now+SKEW||now-issued>LIFETIME||
  expires<=issued||expires-issued>LIFETIME||expires<=now)
  throw Error('Invalid V2 lifetime');
 return Object.freeze({
  schemaVersion:2,companyId:raw.companyId,messageKind:kind.messageKind,
  sourceType:kind.sourceType,resourceType:kind.resourceType,
  resourceId:raw.resourceId,audience:kind.audience,recipientId:raw.recipientId,
  outboxJobId:raw.outboxJobId,provider:raw.provider,
  senderAccountId:raw.senderAccountId,recipientChatId:raw.recipientChatId,
  revision:raw.revision,action:action.action,
  issuedAt:new Date(issued).toISOString(),expiresAt:new Date(expires).toISOString()
 }) as InteractiveActionBindingV2;
}
// Comparison only. Call this AFTER independently verifying a future HMAC v2,
// authenticated provider callback and trusted Outbox read. Matching alone
// NEVER authorizes a business transition or proves a provider event was real.
export function compareVerifiedInteractiveV2Origin(
 rawBinding:any,trustedOutbox:any,verifiedProviderEvent:any,
 registry:InteractiveActionRegistry=REGISTERED_WHATSAPP_ACTIONS,
 now=Date.now()):boolean{
 try{
  const binding=validateInteractiveActionBindingV2(rawBinding,registry,now);
  const action=getInteractiveActionContract(binding.messageKind,binding.action,registry);
  if(!action||action.handler==='not_implemented')return false;
  if(!trustedOutbox||trustedOutbox.status!=='accepted'||
   !ID.test(String(trustedOutbox.id||''))||
   typeof trustedOutbox.provider_message_id!=='string'||
   trustedOutbox.provider_message_id.length<5||
   trustedOutbox.provider_message_id.length>180)return false;
  const expect={
   id:binding.outboxJobId,company_id:binding.companyId,
   message_kind:binding.messageKind,source_type:binding.sourceType,
   resource_type:binding.resourceType,resource_id:binding.resourceId,
   recipient_audience:binding.audience,recipient_id:binding.recipientId,
   requested_provider:binding.provider,sender_account_id:binding.senderAccountId,
   chat_id:binding.recipientChatId,revision:binding.revision
  };
  if(Object.entries(expect).some(([key,value])=>trustedOutbox[key]!==value))return false;
  if(!verifiedProviderEvent||verifiedProviderEvent.provider!==binding.provider||
   verifiedProviderEvent.senderAccountId!==binding.senderAccountId||
   verifiedProviderEvent.senderChatId!==binding.recipientChatId||
   verifiedProviderEvent.originalProviderMessageId!==
    trustedOutbox.provider_message_id||
   verifiedProviderEvent.action!==binding.action)return false;
  return true;
 }catch{return false;}
}
