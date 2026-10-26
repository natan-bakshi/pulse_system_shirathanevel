// Opaque action binding for a future authenticated provider webhook. This
// contract intentionally does not sign tokens; server-side secret verification
// and durable single-use inbox must be implemented before activation.
export type InteractiveActionBinding={companyId:string;eventServiceId:string;supplierId:string;
 revision:string;outboxJobId:string;provider:'green'|'wasender';senderAccountId:string;
 action:'assignment_approve'|'assignment_reject'|'contact_office';expiresAt:string};
const valid=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=180&&!/[\r\n\u0000-\u001f]/.test(v);
export function validateInteractiveActionBinding(input:any,now=Date.now()):InteractiveActionBinding{
 if(!input||typeof input!=='object')throw Error('Invalid action binding');
 for(const k of ['companyId','eventServiceId','supplierId','revision','outboxJobId','senderAccountId']){
  if(!valid(input[k]))throw Error('Invalid action binding '+k);
 }
 if(!['green','wasender'].includes(input.provider))throw Error('Invalid action provider');
 if(!['assignment_approve','assignment_reject','contact_office'].includes(input.action))throw Error('Invalid action');
 const expiry=Date.parse(input.expiresAt);
 if(!Number.isFinite(expiry)||expiry<=now||expiry-now>30*86400000)throw Error('Expired or excessive action lifetime');
 return {companyId:input.companyId,eventServiceId:input.eventServiceId,supplierId:input.supplierId,
  revision:input.revision,outboxJobId:input.outboxJobId,provider:input.provider,
  senderAccountId:input.senderAccountId,action:input.action,expiresAt:new Date(expiry).toISOString()};
}
export function actionBindingMatches(input:InteractiveActionBinding,observed:{companyId:string;eventServiceId:string;
 supplierId:string;revision:string;outboxJobId:string;provider:string;senderAccountId:string},now=Date.now()){
 try{const binding=validateInteractiveActionBinding(input,now);
  return ['companyId','eventServiceId','supplierId','revision','outboxJobId','provider','senderAccountId']
   .every(k=>(binding as any)[k]===(observed as any)[k]);
 }catch{return false;}
}
