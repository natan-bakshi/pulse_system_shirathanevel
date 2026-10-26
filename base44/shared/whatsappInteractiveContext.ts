// Pure, fail-closed context helpers. No network calls and no business mutations.
// The outbound job owns a frozen assignment revision and sender identity.
export type AssignmentMessageContext = {
 companyId:string;eventServiceId:string;supplierId:string;revision:string;chatId:string;
 provider:'green'|'wasender';senderAccountId:string;outboxJobId:string;
 providerMessageId:string;status:'accepted'|'queued'|'unknown'|'failed'|'cancelled';
};
const id=(v:unknown)=>typeof v==='string'&&v.trim().length>0&&v.length<=180&&!/[\r\n\u0000-\u001f]/.test(v);
export function validateAssignmentMessageContext(raw:any):AssignmentMessageContext {
 if(!raw||typeof raw!=='object')throw Error('Missing assignment context');
 for(const k of ['companyId','eventServiceId','supplierId','revision','senderAccountId','outboxJobId']){
  if(!id(raw[k]))throw Error('Invalid assignment context: '+k);
 }
 // Provider quoting is only safe in the exact original private chat. Green API
 // may return HTTP 200 for an invalid quote while NOT delivering the message.
 if(typeof raw.chatId!=='string'||!/^[1-9][0-9]{7,14}@c\.us$/.test(raw.chatId))
  throw Error('Invalid assignment chat identity');
 if(!['green','wasender'].includes(raw.provider))throw Error('Invalid assignment provider');
 if(!['accepted','queued','unknown','failed','cancelled'].includes(raw.status))throw Error('Invalid assignment receipt state');
 if(raw.status==='accepted'&&!id(raw.providerMessageId))throw Error('Accepted message requires provider receipt');
 if(raw.status!=='accepted'&&raw.providerMessageId)throw Error('Unverified message cannot own quote receipt');
 return {companyId:raw.companyId,eventServiceId:raw.eventServiceId,supplierId:raw.supplierId,
  revision:raw.revision,chatId:raw.chatId,provider:raw.provider,senderAccountId:raw.senderAccountId,
  outboxJobId:raw.outboxJobId,providerMessageId:raw.providerMessageId||'',status:raw.status};
}
export function resolveAssignmentQuote(original:AssignmentMessageContext|null|undefined,reply:{
 companyId:string;eventServiceId:string;supplierId:string;revision:string;chatId:string;
 provider:'green'|'wasender';senderAccountId:string
}):{quoteMessageId:string|null;reason:string}{
 if(!original)return {quoteMessageId:null,reason:'missing_origin'};
 let o:AssignmentMessageContext;
 try{o=validateAssignmentMessageContext(original);}catch{return {quoteMessageId:null,reason:'invalid_origin'};}
 if(o.status!=='accepted')return {quoteMessageId:null,reason:'origin_not_accepted'};
 if(o.companyId!==reply.companyId||o.eventServiceId!==reply.eventServiceId||o.supplierId!==reply.supplierId)
  return {quoteMessageId:null,reason:'assignment_mismatch'};
 if(o.revision!==reply.revision)return {quoteMessageId:null,reason:'stale_revision'};
 if(o.chatId!==reply.chatId)return {quoteMessageId:null,reason:'chat_mismatch'};
 if(o.provider!==reply.provider||o.senderAccountId!==reply.senderAccountId)
  return {quoteMessageId:null,reason:'sender_mismatch'};
 return {quoteMessageId:o.providerMessageId,reason:'matched'};
}
export function evaluateAssignmentResponse(input:{action:string;companyId:string;eventServiceId:string;
 supplierId:string;revision:string;activeRevision:string;currentStatus:string;assigned:boolean;
 authenticatedSupplierId:string;authenticatedCompanyId:string}){
 if(!['assignment_approve','assignment_reject'].includes(input.action))return {allowed:false,reason:'unsupported_action'};
 if(!input.authenticatedSupplierId||input.authenticatedSupplierId!==input.supplierId||
  !input.authenticatedCompanyId||input.authenticatedCompanyId!==input.companyId)return {allowed:false,reason:'unauthorized'};
 if(!input.assigned)return {allowed:false,reason:'not_assigned'};
 if(!input.revision||input.revision!==input.activeRevision)return {allowed:false,reason:'stale_revision'};
 if(input.currentStatus!=='pending')return {allowed:false,reason:'not_pending'};
 return {allowed:true,reason:'eligible',targetStatus:input.action==='assignment_approve'?'confirmed':'rejected'};
}
