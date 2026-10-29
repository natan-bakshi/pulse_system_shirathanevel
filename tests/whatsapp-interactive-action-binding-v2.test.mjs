import test from 'node:test';
import assert from 'node:assert/strict';
import {createInteractiveActionRegistry,REGISTERED_WHATSAPP_ACTIONS}
 from '../base44/shared/whatsappInteractiveActionRegistry.ts';
import {validateInteractiveActionBindingV2,compareVerifiedInteractiveV2Origin}
 from '../base44/shared/whatsappInteractiveActionBindingV2.ts';

const now=Date.parse('2026-10-29T20:00:00.000Z');
const base=()=>({
 schemaVersion:2,companyId:'shirat_hanevel',messageKind:'assignment',
 sourceType:'assignment_new',resourceType:'event_service',
 resourceId:'service-0123',audience:'supplier',recipientId:'supplier-0123',
 outboxJobId:'outbox-0123',provider:'green',senderAccountId:'9903183013',
 recipientChatId:'972501234567@c.us',revision:'r7',
 action:'assignment_approve',issuedAt:'2026-10-29T19:59:00.000Z',
 expiresAt:'2026-10-31T20:00:00.000Z'
});
const accepted=()=>({
 id:'outbox-0123',company_id:'shirat_hanevel',message_kind:'assignment',
 source_type:'assignment_new',resource_type:'event_service',
 resource_id:'service-0123',recipient_audience:'supplier',recipient_id:'supplier-0123',
 requested_provider:'green',sender_account_id:'9903183013',
 chat_id:'972501234567@c.us',revision:'r7',
 status:'accepted',provider_message_id:'3EB0TEST123456789'
});
const event=()=>({
 provider:'green',senderAccountId:'9903183013',
 senderChatId:'972501234567@c.us',
 originalProviderMessageId:'3EB0TEST123456789',action:'assignment_approve'
});
const catalog=()=>createInteractiveActionRegistry([
 ...REGISTERED_WHATSAPP_ACTIONS.messageKinds,
 {messageKind:'client_invitation',sourceType:'client_invitation',
  resourceType:'client_event',audience:'client',maxButtons:2,actions:[
   {action:'invitation_accept',delivery:'reply',handler:'not_implemented'},
   {action:'invitation_decline',delivery:'reply',handler:'not_implemented'}
  ]}
]);

test('version 2 envelope binds origin, audience, action, revision and provider without effects',()=>{
 const binding=validateInteractiveActionBindingV2(base(),undefined,now);
 assert.equal(binding.audience,'supplier');
 assert.equal(binding.resourceType,'event_service');
 assert.ok(Object.isFrozen(binding));
 assert.equal(compareVerifiedInteractiveV2Origin(binding,accepted(),event(),undefined,now),true);
});

test('provider mismatch, another WhatsApp chat, another source message or tenant are not equivalent',()=>{
 const b=base(),job=accepted(),click=event();
 for(const patch of [
  {provider:'wasender'},{senderAccountId:'different123'},
  {senderChatId:'972509876543@c.us'},
  {originalProviderMessageId:'DIFFERENT123'},
  {action:'assignment_reject'}
 ])assert.equal(compareVerifiedInteractiveV2Origin(b,job,{...click,...patch},undefined,now),
  false,JSON.stringify(patch));
 for(const patch of [
  {company_id:'another_tenant'},
  {recipient_id:'different_supplier'},
  {resource_id:'another_service'},
  {message_kind:'client_invitation'},
  {source_type:'client_invitation'},
  {status:'queued'},
  {provider_message_id:''},
  {revision:'r8'}
 ])assert.equal(compareVerifiedInteractiveV2Origin(b,{...job,...patch},click,undefined,now),
  false,JSON.stringify(patch));
});

test('future client invitation may have a valid draft binding but cannot execute until handler implementation',()=>{
 const r=catalog();
 const binding={...base(),messageKind:'client_invitation',
  sourceType:'client_invitation',resourceType:'client_event',
  audience:'client',resourceId:'event-9876',recipientId:'client-9876',
  action:'invitation_accept',revision:'v2'};
 assert.equal(validateInteractiveActionBindingV2(binding,r,now).audience,'client');
 const job={...accepted(),message_kind:'client_invitation',
  source_type:'client_invitation',resource_type:'client_event',
  recipient_audience:'client',recipient_id:'client-9876',
  resource_id:'event-9876',revision:'v2'};
 assert.equal(compareVerifiedInteractiveV2Origin(binding,job,
  {...event(),action:'invitation_accept'},r,now),false,
 'not_implemented must never be interpreted as authorized just because envelope matches');
 assert.throws(()=>validateInteractiveActionBindingV2(binding,undefined,now),
  /registered message scope/,'future test catalog never changes real registry');
});

test('cross-audience and cross-message action cannot be bound to a different business object',()=>{
 const r=catalog();
 for(const patch of [
  {audience:'client'},
  {messageKind:'client_invitation'},
  {sourceType:'client_invitation'},
  {resourceType:'client_event'},
  {action:'invitation_accept'},
  {action:'contact_office'}
 ])assert.throws(()=>validateInteractiveActionBindingV2({...base(),...patch},r,now),
  /registered message scope/,JSON.stringify(patch));
});

test('unknown fields, unbounded expiry, group chats, arbitrary code and malformed identity are rejected',()=>{
 const b=base();
 for(const patch of [
  {execute:'delete_records'},
  {recipientChatId:'972501234567@g.us'},
  {resourceId:'../../secret'},
  {senderAccountId:'bad\nheader'},
  {schemaVersion:1},
  {expiresAt:'2026-11-30T20:00:00.000Z'},
  {expiresAt:'2026-10-29T19:59:00.000Z'},
  {issuedAt:'2026-10-30T19:59:00.000Z'},
  {revision:'r0'},
  {action:'run_code'}
 ])assert.throws(()=>validateInteractiveActionBindingV2({...b,...patch},undefined,now),
  undefined,JSON.stringify(patch));
 assert.equal(compareVerifiedInteractiveV2Origin({...b,action:'run_code'},
  accepted(),event(),undefined,now),false);
});
