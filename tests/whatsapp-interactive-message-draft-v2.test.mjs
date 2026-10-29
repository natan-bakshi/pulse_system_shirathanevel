import test from 'node:test';
import assert from 'node:assert/strict';
import {createInteractiveActionRegistry,REGISTERED_WHATSAPP_ACTIONS}
 from '../base44/shared/whatsappInteractiveActionRegistry.ts';
import {interactiveMessageDraftKey,normalizeMessageInteractiveDraftV2}
 from '../base44/shared/whatsappInteractiveMessageDraftV2.ts';

const registry=createInteractiveActionRegistry([
 ...REGISTERED_WHATSAPP_ACTIONS.messageKinds,
 {messageKind:'client_invitation',sourceType:'client_invitation',
  resourceType:'client_event',audience:'client',maxButtons:2,actions:[
   {action:'invitation_accept',delivery:'reply',handler:'not_implemented'},
   {action:'invitation_decline',delivery:'reply',handler:'not_implemented'}
  ]}
]);
const input=()=>({
 schemaVersion:2,companyId:'shirat_hanevel',provider:'green',
 messageKind:'client_invitation',audience:'client',version:1,officeNumber:'',
 policy:{enabled:false,messageKind:'client_invitation',buttons:[
  {action:'invitation_accept',label:'מגיעים'},
  {action:'invitation_decline',label:'לא מגיעים'}
 ]}
});
test('draft settings are separate by company, provider and message type',()=>{
 const a=input();
 const one=interactiveMessageDraftKey(a,registry);
 for(const patch of [
  {companyId:'other_tenant'},
  {provider:'wasender'},
  {messageKind:'assignment'}
 ])assert.notEqual(interactiveMessageDraftKey({...a,...patch},registry),one);
 assert.match(one,/^wa_interactive_draft:v2:shirat_hanevel:green:client_invitation$/);
 assert.equal(normalizeMessageInteractiveDraftV2(a,registry).audience,'client');
 assert.equal(normalizeMessageInteractiveDraftV2(a,registry).policy.enabled,false);
});
test('a newly designed client policy remains disabled and cannot cross into a supplier message',()=>{
 const a=input();
 assert.throws(()=>normalizeMessageInteractiveDraftV2({
  ...a,audience:'supplier'
 },registry),/audience mismatch/);
 assert.throws(()=>normalizeMessageInteractiveDraftV2({
  ...a,policy:{...a.policy,enabled:true}
 },registry),/cannot activate/);
 assert.throws(()=>normalizeMessageInteractiveDraftV2({
  ...a,policy:{...a.policy,buttons:[
   {action:'assignment_approve',label:'אישור'}
  ]}
 },registry),/Unsupported/);
 assert.throws(()=>normalizeMessageInteractiveDraftV2(a),
  /Invalid company, provider or message-kind draft scope/,
 'future test registration cannot enable anything in the live catalog');
});
test('draft policies refuse wrong version, invalid number and unsupported message kind',()=>{
 const a=input();
 for(const patch of [
  {schemaVersion:1},{version:0},{version:2.3},
  {provider:'unknown'},{companyId:'../bad'},
  {officeNumber:'+972501234567'}, {messageKind:'unregistered_message'}
 ])assert.throws(()=>normalizeMessageInteractiveDraftV2({...a,...patch},registry));
});
