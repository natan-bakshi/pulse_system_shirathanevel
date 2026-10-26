// Conservative capability negotiation. Never infer an interactive feature from
// the provider name alone: account/version capability must be verified.
export type InteractiveCapability = {buttons:boolean;urlButton:boolean;quote:boolean;inboundVerified:boolean};
export type CapabilityEvidence = {provider:'green'|'wasender';accountId:string;verifiedAt:string;features:InteractiveCapability};
export function effectiveInteractiveCapabilities(evidence:CapabilityEvidence|null|undefined,now=Date.now()):InteractiveCapability {
 const off={buttons:false,urlButton:false,quote:false,inboundVerified:false};
 if(!evidence||!['green','wasender'].includes(evidence.provider)||!evidence.accountId||
  !Number.isFinite(Date.parse(evidence.verifiedAt))||Date.parse(evidence.verifiedAt)>now||
  now-Date.parse(evidence.verifiedAt)>30*24*60*60*1000)return off;
 const f=evidence.features||off;
 return {buttons:f.buttons===true&&f.inboundVerified===true,
  urlButton:f.urlButton===true,quote:f.quote===true,inboundVerified:f.inboundVerified===true};
}
export function interactiveDeliveryPlan(input:{enabled:boolean;provider:'green'|'wasender';accountId:string;
 evidence:CapabilityEvidence|null;quoteRequested:boolean;buttonsRequested:boolean},now=Date.now()){
 if(!input.enabled)return {mode:'plain_text' as const,quote:false,reason:'feature_disabled'};
 if(input.evidence?.provider!==input.provider||input.evidence?.accountId!==input.accountId)
  return {mode:'plain_text' as const,quote:false,reason:'account_unverified'};
 const caps=effectiveInteractiveCapabilities(input.evidence,now);
 return {mode:input.buttonsRequested&&caps.buttons?'interactive' as const:'plain_text' as const,
  quote:input.quoteRequested&&caps.quote,
  reason:input.buttonsRequested&&!caps.buttons?'buttons_unsupported_or_unverified':'capability_checked'};
}
