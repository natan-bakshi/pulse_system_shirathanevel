// Pure policy validation; no provider traffic or state mutations.
// A provider capability check is required separately before activating a policy.
export const WHATSAPP_ACTIONS = Object.freeze([
  'assignment_approve','assignment_reject','contact_office'
] as const);
export type WhatsAppAction = typeof WHATSAPP_ACTIONS[number];
export type WhatsAppButton = {action:WhatsAppAction;label:string};
export type WhatsAppInteractivePolicy = {enabled:boolean;quoteAssignment:boolean;buttons:WhatsAppButton[]};
const allowed = new Set<string>(WHATSAPP_ACTIONS);
export function validateWhatsAppInteractivePolicy(input:any):WhatsAppInteractivePolicy {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid WhatsApp policy');
  if(typeof input.enabled!=='boolean'||typeof input.quoteAssignment!=='boolean')throw new Error('Invalid WhatsApp policy flags');
  if(!Array.isArray(input.buttons)||input.buttons.length>3)throw new Error('Invalid WhatsApp button count');
  const seen=new Set<string>();
  const buttons=input.buttons.map((b:any)=>{
    if(!b||typeof b!=='object'||!allowed.has(b.action)||seen.has(b.action))throw new Error('Unsupported or duplicate WhatsApp action');
    if(typeof b.label!=='string'||b.label.trim()!==b.label||b.label.length<1||b.label.length>20||/[\r\n\u0000-\u001f]/.test(b.label))throw new Error('Invalid WhatsApp button label');
    seen.add(b.action);
    return {action:b.action as WhatsAppAction,label:b.label};
  });
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
