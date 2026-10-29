// Pure policy validation; no provider traffic or state mutations.
import {getInteractiveMessageContract,validateInteractiveButtonLayout} from './whatsappInteractiveActionRegistry.ts';
// A provider capability check is required separately before activating a policy.
// v1 stays intentionally typed to the existing assignment actions. New
// message kinds use registry-scoped V2 contracts rather than widening v1.
export type WhatsAppAction='assignment_approve'|'assignment_reject'|'contact_office';
export const WHATSAPP_ACTIONS = Object.freeze(
 getInteractiveMessageContract('assignment')!.actions.map(a=>a.action) as WhatsAppAction[]);
export type WhatsAppButton = {action:WhatsAppAction;label:string};
export type WhatsAppInteractivePolicy = {enabled:boolean;quoteAssignment:boolean;buttons:WhatsAppButton[]};
export function validateWhatsAppInteractivePolicy(input:any):WhatsAppInteractivePolicy {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid WhatsApp policy');
  if(typeof input.enabled!=='boolean'||typeof input.quoteAssignment!=='boolean')throw new Error('Invalid WhatsApp policy flags');
  const buttons=validateInteractiveButtonLayout('assignment',input.buttons) as WhatsAppButton[];
  if(input.enabled&&!buttons.length)throw new Error('Enabled WhatsApp policy needs buttons');
  return {enabled:input.enabled,quoteAssignment:input.quoteAssignment,buttons};
}
export function resolveWhatsAppAction(policy:WhatsAppInteractivePolicy,action:any):WhatsAppAction|null {
  if(!policy.enabled||typeof action!=='string')return null;
  return policy.buttons.find(b=>b.action===action)?.action||null;
}
export function defaultAssignmentWhatsAppPolicy():WhatsAppInteractivePolicy {
  return {enabled:false,quoteAssignment:false,buttons:[
    {action:'assignment_approve',label:'אישור שיבוץ'},
    {action:'assignment_reject',label:'דחיית שיבוץ'},
    {action:'contact_office',label:'פנייה למשרד'}
  ]};
}
