// Server-owned catalog of interactive WhatsApp action contracts.
// PURPOSE: future messages (reminders, customers, confirmations) reuse the
// same policy/identity vocabulary without copying arbitrary switch statements.
// No database, network, imports from UI, provider calls or dynamic handlers.
// IMPORTANT: registration is a CODE CHANGE, not a capability granted by a
// saved policy, external payload, message label or a button id.
export type InteractiveActionHandler =
 'supplier_status'|'office_link'|'notification_ack'|'not_implemented';
export type InteractiveActionContract={
 action:string;delivery:'reply'|'url';handler:InteractiveActionHandler;
 targetStatus?:'confirmed'|'rejected'
};
export type InteractiveMessageContract={
 messageKind:string;sourceType:string;resourceType:string;
 audience:'supplier'|'client'|'admin';maxButtons:number;
 actions:readonly InteractiveActionContract[]
};
export type InteractiveActionRegistry={
 messageKinds:readonly InteractiveMessageContract[];
 schemaVersion:1
};
const IDENTIFIER=/^[a-z][a-z0-9_]{2,63}$/;
const fail=(reason:string):never=>{throw new Error('Invalid WhatsApp action registry: '+reason);};
const validId=(s:unknown)=>typeof s==='string'&&IDENTIFIER.test(s);
export function createInteractiveActionRegistry(specs:readonly InteractiveMessageContract[]):InteractiveActionRegistry{
 if(!Array.isArray(specs)||specs.length<1||specs.length>24)fail('message_kinds');
 const kinds=new Set<string>(),sources=new Set<string>();
 const messageKinds=specs.map(raw=>{
  if(!raw||!validId(raw.messageKind)||!validId(raw.sourceType)||
   !validId(raw.resourceType)||!['supplier','client','admin'].includes(raw.audience)||
   kinds.has(raw.messageKind)||
   sources.has(raw.sourceType))fail('kind_or_origin');
  if(!Number.isSafeInteger(raw.maxButtons)||raw.maxButtons<1||raw.maxButtons>3||
   !Array.isArray(raw.actions)||!raw.actions.length||raw.actions.length>12)
   fail('button_limits');
  kinds.add(raw.messageKind);sources.add(raw.sourceType);
  const actions=new Set<string>();
  const definitions=raw.actions.map(spec=>{
   if(!spec||!validId(spec.action)||actions.has(spec.action)||
    !['reply','url'].includes(spec.delivery)||
    !['supplier_status','office_link','notification_ack','not_implemented'].includes(spec.handler))
    fail('action_definition');
   if(spec.handler==='supplier_status'&&
    (spec.delivery!=='reply'||!['confirmed','rejected'].includes(spec.targetStatus||'')))
    fail('supplier_status_requires_reply_and_target');
   if(spec.handler==='office_link'&&spec.delivery!=='url')
    fail('office_link_requires_url');
   if(spec.handler==='notification_ack'&&spec.delivery!=='reply')
    fail('notification_ack_requires_reply');
   if(spec.handler!=='supplier_status'&&spec.targetStatus!==undefined)
    fail('unbound_business_status');
   actions.add(spec.action);
   return Object.freeze({
    action:spec.action,delivery:spec.delivery,handler:spec.handler,
    ...(spec.handler==='supplier_status'?{targetStatus:spec.targetStatus}: {})
   }) as InteractiveActionContract;
  });
  return Object.freeze({messageKind:raw.messageKind,sourceType:raw.sourceType,
   resourceType:raw.resourceType,audience:raw.audience,maxButtons:raw.maxButtons,
   actions:Object.freeze(definitions)}) as InteractiveMessageContract;
 });
 return Object.freeze({schemaVersion:1,messageKinds:Object.freeze(messageKinds)});
}
// This is the only active, source-code-registered message kind TODAY.
// No new kind or handler may be activated merely by writing an AppSettings
// value. Assignment's v1 signed token, Outbox and webhook stay unchanged.
export const REGISTERED_WHATSAPP_ACTIONS=createInteractiveActionRegistry([{
 messageKind:'assignment',sourceType:'assignment_new',
 resourceType:'event_service',audience:'supplier',maxButtons:3,
 actions:[
  {action:'assignment_approve',delivery:'reply',
   handler:'supplier_status',targetStatus:'confirmed'},
  {action:'assignment_reject',delivery:'reply',
   handler:'supplier_status',targetStatus:'rejected'},
  {action:'contact_office',delivery:'url',handler:'office_link'}
 ]
}]);
export function getInteractiveMessageContract(messageKind:unknown,
 registry:InteractiveActionRegistry=REGISTERED_WHATSAPP_ACTIONS):InteractiveMessageContract|null{
 if(typeof messageKind!=='string')return null;
 return registry.messageKinds.find(x=>x.messageKind===messageKind)||null;
}
export function getInteractiveActionContract(messageKind:unknown,action:unknown,
 registry:InteractiveActionRegistry=REGISTERED_WHATSAPP_ACTIONS):InteractiveActionContract|null{
 if(typeof action!=='string')return null;
 return getInteractiveMessageContract(messageKind,registry)?.actions.find(x=>x.action===action)||null;
}
// Only actions with a real, explicitly bound business implementation may
// reach the legacy signed v1 callback. 'not_implemented' and office URLs
// cannot be processed as inbound supplier-status decisions.
export function allowedInboundActionIds(messageKind:string,
 registry:InteractiveActionRegistry=REGISTERED_WHATSAPP_ACTIONS):readonly string[]{
 const contract=getInteractiveMessageContract(messageKind,registry);
 return Object.freeze((contract?.actions||[])
  .filter(x=>x.delivery==='reply'&&x.handler==='supplier_status')
  .map(x=>x.action));
}
export function assignmentDecisionForAction(action:unknown):'confirmed'|'rejected'|null{
 const contract=getInteractiveActionContract('assignment',action);
 return contract?.delivery==='reply'&&contract.handler==='supplier_status'
  ?contract.targetStatus||null:null;
}
// Generic per-message button layout. This is deliberately POLICY-ONLY:
// it has no trusted rollout switch, provider credentials, signed payload or
// backend executor. Actual send + callback admission require separate gates.
export function validateInteractiveButtonLayout(messageKind:string,buttons:any,
 registry:InteractiveActionRegistry=REGISTERED_WHATSAPP_ACTIONS){
 const contract=getInteractiveMessageContract(messageKind,registry);
 if(!contract||!Array.isArray(buttons)||buttons.length>contract.maxButtons)
  throw Error('Unsupported WhatsApp message kind or button count');
 const seen=new Set<string>();
 return buttons.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
   !getInteractiveActionContract(messageKind,raw.action,registry)||
   seen.has(raw.action))throw Error('Unsupported or duplicate WhatsApp action');
  if(typeof raw.label!=='string'||raw.label.trim()!==raw.label||
   raw.label.length<1||raw.label.length>20||
   /[\r\n\u0000-\u001f\u007f]/.test(raw.label))
   throw Error('Invalid WhatsApp button label');
  seen.add(raw.action);
  return {action:raw.action,label:raw.label};
 });
}
// Future message-kind policies can be authored and reviewed without allowing
// any tenant / provider to turn them on automatically.
export function validateInteractiveMessagePolicyDraft(input:any,
 registry:InteractiveActionRegistry=REGISTERED_WHATSAPP_ACTIONS){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  typeof input.enabled!=='boolean'||input.enabled)
  throw Error('Interactive message draft cannot activate delivery');
 const buttons=validateInteractiveButtonLayout(input.messageKind,input.buttons,registry);
 return {schemaVersion:1,messageKind:input.messageKind,enabled:false,buttons};
}
