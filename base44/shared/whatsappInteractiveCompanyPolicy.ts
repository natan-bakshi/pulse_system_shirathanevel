// Strict tenant-scoped configuration contract. Persistence and RBAC remain
// server-only; no caller may activate live buttons until the rollout gate exists.
import {validateWhatsAppInteractivePolicy,defaultAssignmentWhatsAppPolicy} from './whatsappInteractivePolicy.ts';
export type CompanyWhatsAppPolicy={companyId:string;version:number;messageKind:'assignment';
 provider:'green'|'wasender';officeNumber:string;policy:ReturnType<typeof validateWhatsAppInteractivePolicy>};
export function normalizeCompanyWhatsAppPolicy(input:any):CompanyWhatsAppPolicy{
 if(!input||typeof input!=='object'||typeof input.companyId!=='string'||
  !/^[A-Za-z0-9_-]{3,128}$/.test(input.companyId))throw Error('Invalid company id');
 if(!Number.isSafeInteger(input.version)||input.version<1)throw Error('Invalid policy version');
 if(input.messageKind!=='assignment'||!['green','wasender'].includes(input.provider))throw Error('Unsupported template or provider');
 if(typeof input.officeNumber!=='string'||(input.officeNumber!==''&&!/^[1-9][0-9]{7,14}$/.test(input.officeNumber)))
  throw Error('Office number must be E164 digits without +');
 const policy=validateWhatsAppInteractivePolicy(input.policy);
 if(policy.enabled)throw Error('Company WhatsApp interactive rollout remains disabled');
 return {companyId:input.companyId,version:input.version,messageKind:input.messageKind,
  provider:input.provider,officeNumber:input.officeNumber,policy};
}
export function defaultCompanyWhatsAppPolicy(companyId:string,provider:'green'|'wasender'){
 return normalizeCompanyWhatsAppPolicy({companyId,provider,version:1,messageKind:'assignment',officeNumber:'',policy:defaultAssignmentWhatsAppPolicy()});
}
export function companyPolicyKey(input:{companyId:string;provider:string;messageKind:string}){
 if(!/^[A-Za-z0-9_-]{3,128}$/.test(input.companyId)||!['green','wasender'].includes(input.provider)||input.messageKind!=='assignment')
  throw Error('Invalid company policy scope');
 return `wa_interactive:v1:${input.companyId}:${input.provider}:${input.messageKind}`;
}
