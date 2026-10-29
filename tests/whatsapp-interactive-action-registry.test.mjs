import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createInteractiveActionRegistry,REGISTERED_WHATSAPP_ACTIONS,
 getInteractiveMessageContract,getInteractiveActionContract,
 allowedInboundActionIds,assignmentDecisionForAction,
 validateInteractiveButtonLayout,validateInteractiveMessagePolicyDraft
} from '../base44/shared/whatsappInteractiveActionRegistry.ts';

const fixture=()=>createInteractiveActionRegistry([
 ...REGISTERED_WHATSAPP_ACTIONS.messageKinds,
 {messageKind:'supplier_reminder',sourceType:'supplier_reminder',
  resourceType:'event_service',maxButtons:2,actions:[
   {action:'reminder_acknowledge',delivery:'reply',handler:'not_implemented'},
   {action:'contact_office',delivery:'url',handler:'office_link'}
  ]},
 {messageKind:'client_invitation',sourceType:'client_invitation',
  resourceType:'client_event',maxButtons:2,actions:[
   {action:'invitation_attending',delivery:'reply',handler:'not_implemented'},
   {action:'invitation_not_attending',delivery:'reply',handler:'not_implemented'}
  ]}
]);

test('current live catalog contains exactly the legacy assignment actions and status mappings',()=>{
 assert.deepEqual(REGISTERED_WHATSAPP_ACTIONS.messageKinds.map(k=>k.messageKind),['assignment']);
 assert.deepEqual(getInteractiveMessageContract('assignment')?.actions.map(a=>a.action),
  ['assignment_approve','assignment_reject','contact_office']);
 assert.deepEqual(allowedInboundActionIds('assignment'),
  ['assignment_approve','assignment_reject']);
 assert.equal(assignmentDecisionForAction('assignment_approve'),'confirmed');
 assert.equal(assignmentDecisionForAction('assignment_reject'),'rejected');
 assert.equal(assignmentDecisionForAction('contact_office'),null);
 assert.equal(assignmentDecisionForAction('reminder_acknowledge'),null);
});

test('two future message categories can reuse the same registry with isolated action namespaces',()=>{
 const registry=fixture();
 const reminder=validateInteractiveMessagePolicyDraft({enabled:false,
  messageKind:'supplier_reminder',buttons:[
   {action:'reminder_acknowledge',label:'קיבלתי'},
   {action:'contact_office',label:'למשרד'}
  ]},registry);
 assert.equal(reminder.messageKind,'supplier_reminder');
 assert.equal(reminder.enabled,false);
 assert.equal(getInteractiveActionContract('client_invitation','invitation_attending',registry)?.handler,
  'not_implemented');
 assert.equal(getInteractiveActionContract('assignment','invitation_attending',registry),null);
 assert.equal(getInteractiveActionContract('supplier_reminder','assignment_approve',registry),null);
 assert.deepEqual(allowedInboundActionIds('supplier_reminder',registry),[],
  'new draft action cannot mutate a supplier until a handler is explicitly implemented');
 assert.deepEqual(allowedInboundActionIds('client_invitation',registry),[]);
});

test('a new draft cannot turn on WhatsApp just by registering an action or saving settings',()=>{
 const registry=fixture();
 assert.throws(()=>validateInteractiveMessagePolicyDraft({
  enabled:true,messageKind:'supplier_reminder',
  buttons:[{action:'reminder_acknowledge',label:'קיבלתי'}]
 },registry),/cannot activate/);
 assert.throws(()=>validateInteractiveMessagePolicyDraft({
  enabled:false,messageKind:'undeclared_template',buttons:[]
 },registry),/Unsupported/);
 assert.equal(getInteractiveMessageContract('supplier_reminder'),null,
  'future extensions in tests never mutate the live catalog');
});

test('registry rejects malformed, overlapping or executable action definitions',()=>{
 const kinds=fixture().messageKinds;
 assert.throws(()=>createInteractiveActionRegistry([...kinds,kinds[0]]),/kind_or_origin/);
 assert.throws(()=>createInteractiveActionRegistry([{
  messageKind:'assignment',sourceType:'assignment_new',resourceType:'event_service',
  maxButtons:4,actions:[{action:'assignment_approve',delivery:'reply',
   handler:'supplier_status',targetStatus:'confirmed'}]
 }]),/button_limits/);
 const base={messageKind:'client_invitation',sourceType:'client_invitation',
  resourceType:'client_event',maxButtons:2};
 for(const actions of [
  [{action:'run_js',delivery:'reply',handler:'eval'}],
  [{action:'evil',delivery:'reply',handler:'office_link'}],
  [{action:'approve',delivery:'url',handler:'supplier_status',targetStatus:'confirmed'}],
  [{action:'approve',delivery:'reply',handler:'supplier_status',targetStatus:'admin'}],
  [{action:'a_one',delivery:'reply',handler:'not_implemented',targetStatus:'confirmed'}],
  [{action:'foo',delivery:'reply',handler:'not_implemented'},
   {action:'foo',delivery:'reply',handler:'not_implemented'}]
 ]) assert.throws(()=>createInteractiveActionRegistry([{...base,actions}]));
});

test('per-kind layout validation rejects cross-kind labels, duplicate action, oversized or dangerous names',()=>{
 const registry=fixture();
 for(const buttons of [
  [{action:'assignment_reject',label:'דוחה'}],
  [{action:'reminder_acknowledge',label:'A'},
   {action:'reminder_acknowledge',label:'B'}],
  [{action:'reminder_acknowledge',label:'\nunsafe'}],
  [{action:'reminder_acknowledge',label:'x'.repeat(21)}],
  [{action:'reminder_acknowledge',label:'ok'},
   {action:'contact_office',label:'ok'},
   {action:'reminder_acknowledge',label:'extra'}]
 ])assert.throws(()=>validateInteractiveButtonLayout('supplier_reminder',buttons,registry));
});

test('registry and action descriptors are deeply frozen; callers cannot add rights at runtime',()=>{
 const registry=fixture();
 assert.ok(Object.isFrozen(registry));
 assert.ok(Object.isFrozen(registry.messageKinds));
 assert.ok(Object.isFrozen(registry.messageKinds[0]));
 assert.ok(Object.isFrozen(registry.messageKinds[0].actions));
 assert.ok(Object.isFrozen(registry.messageKinds[0].actions[0]));
 assert.throws(()=>{registry.messageKinds.push({});},TypeError);
 assert.throws(()=>{registry.messageKinds[0].actions[0].handler='eval';},TypeError);
});
