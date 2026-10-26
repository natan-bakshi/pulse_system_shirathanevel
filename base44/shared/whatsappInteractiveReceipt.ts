// Deterministic receipt identity and replay-state policy for future durable inbox.
// No provider callbacks are processed here. A real handler MUST authenticate
// provider and atomically claim the inbox event before changing EventService.
export function inboundReceiptKey(input:{provider:string;senderAccountId:string;providerEventId:string}){
 const values=[input.provider,input.senderAccountId,input.providerEventId];
 if(values.some(v=>typeof v!=='string'||!v.trim()||v.length>200))throw Error('Invalid receipt identity');
 return values.map(v=>encodeURIComponent(v)).join(':');
}
export function inboundReceiptDecision(input:{state:string|undefined;claimedBy:string|undefined;claimExpiresAt:string|undefined},now=Date.now()){
 if(input.state==='applied'||input.state==='rejected')return {action:'ignore',reason:'terminal_receipt'};
 if(input.state==='needs_review')return {action:'reconcile',reason:'manual_review_required'};
 if(input.state==='processing'){
  const expiry=Date.parse(input.claimExpiresAt||'');
  if(!Number.isFinite(expiry)||expiry>now)return {action:'ignore',reason:'active_or_uncertain_claim'};
  return {action:'reconcile',reason:'expired_claim_outcome_unknown'};
 }
 if(input.state==='pending')return {action:'claim',reason:'pending'};
 return {action:'reject',reason:'unknown_state'};
}
