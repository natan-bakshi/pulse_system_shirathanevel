// Preflight for an authenticated inbound adapter. It NEVER authenticates a webhook
// on its own; the provider-specific endpoint must verify signature/secret first.
import {resolveWhatsAppAction,type WhatsAppInteractivePolicy} from './whatsappInteractivePolicy.ts';
import {allowedInboundActionIds} from './whatsappInteractiveActionRegistry.ts';
export function validateInboundButtonEvent(input:any,policy:WhatsAppInteractivePolicy){
 if(input?.providerAuthenticated!==true)return {valid:false,reason:'provider_not_authenticated'};
 if(typeof input.providerEventId!=='string'||!input.providerEventId.trim()||input.providerEventId.length>200)
  return {valid:false,reason:'invalid_event_id'};
 if(typeof input.providerMessageId!=='string'||!input.providerMessageId.trim()||input.providerMessageId.length>200)
  return {valid:false,reason:'invalid_message_id'};
 const action=resolveWhatsAppAction(policy,input.action);
 // An office URL or a future unimplemented reply is NEVER a business callback.
 if(!action||!allowedInboundActionIds('assignment').includes(action))
  return {valid:false,reason:'action_not_enabled'};
 if(typeof input.companyId!=='string'||!input.companyId.trim()||typeof input.senderAccountId!=='string'||!input.senderAccountId.trim())
  return {valid:false,reason:'missing_tenant_or_sender'};
 if(!['green','wasender'].includes(input.provider))return {valid:false,reason:'invalid_provider'};
 return {valid:true,reason:'preflight_only',action,
  dedupeKey:[input.provider,input.senderAccountId,input.providerEventId].map(v=>encodeURIComponent(v)).join(':')};
}
