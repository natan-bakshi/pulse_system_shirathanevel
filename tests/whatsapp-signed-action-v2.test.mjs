import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 createSignedWhatsAppActionV2,verifySignedWhatsAppActionV2,
 verifySignedWhatsAppV2Origin
} from '../base44/shared/whatsappSignedActionV2.ts';
import {createSignedWhatsAppAction} from '../base44/shared/whatsappSignedAction.ts';
import {createInteractiveActionRegistry,REGISTERED_WHATSAPP_ACTIONS}
 from '../base44/shared/whatsappInteractiveActionRegistry.ts';

const now=Date.parse('2026-10-30T12:00:00.000Z');
const secret='v2-synthetic-shirat-button-signing-secret-0123456789';
const binding=()=>({
 schemaVersion:2,companyId:'shirat_hanevel',
 messageKind:'assignment',sourceType:'assignment_new',
 resourceType:'event_service',resourceId:'service-123',
 audience:'supplier',recipientId:'supplier-123',
 outboxJobId:'outbox-123',provider:'green',senderAccountId:'9903183013',
 recipientChatId:'972501234567@c.us',revision:'r8',
 action:'assignment_approve',
 issuedAt:new Date(now-60_000).toISOString(),
 expiresAt:new Date(now+48*3600_000).toISOString()
});
const outbox=()=>({
 id:'outbox-123',company_id:'shirat_hanevel',
 message_kind:'assignment',source_type:'assignment_new',
 resource_type:'event_service',resource_id:'service-123',
 recipient_audience:'supplier',recipient_id:'supplier-123',
 requested_provider:'green',sender_account_id:'9903183013',
 chat_id:'972501234567@c.us',revision:'r8',
 status:'accepted',provider_message_id:'3EB0GREENPROVIDER98765'
});
const click=()=>({
 provider:'green',senderAccountId:'9903183013',
 senderChatId:'972501234567@c.us',
 originalProviderMessageId:'3EB0GREENPROVIDER98765',
 action:'assignment_approve'
});
test('signed V2 binds all scopes, creates a random 128-bit nonce and never exposes server secret',async()=>{
 const a=await createSignedWhatsAppActionV2({binding:binding(),secret,now});
 const b=await createSignedWhatsAppActionV2({binding:binding(),secret,now});
 assert.match(a,/^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
 assert.notEqual(a,b,'each signed action needs an unpredictable nonce');
 assert.ok(a.length<2700);
 assert.ok(!a.includes(secret));
 const verified=await verifySignedWhatsAppActionV2({token:a,secret,now});
 assert.equal(verified.purpose,'pulse_shirat_interactive_reply_v2');
 assert.match(verified.nonce,/^[A-Za-z0-9_-]{22}$/);
 assert.equal(verified.companyId,'shirat_hanevel');
 assert.equal(verified.action,'assignment_approve');
 assert.equal(verified.recipientChatId,'972501234567@c.us');
 assert.equal(verified.revision,'r8');
 assert.equal(verified.expiresAt,binding().expiresAt);
 assert.ok(Object.isFrozen(verified));
});

test('a signed V2 token is not trusted if key, version, MAC, nonce or encoded body changes',async()=>{
 const token=await createSignedWhatsAppActionV2({binding:binding(),secret,now});
 assert.equal(await verifySignedWhatsAppActionV2({token,secret:'different-secret-of-enough-length-123456',now}),null);
 const chunks=token.split('.');
 for(const mutated of [
  'v1.'+chunks.slice(1).join('.'),
  'v3.'+chunks.slice(1).join('.'),
  chunks[0]+'.'+chunks[1].slice(0,-1)+(chunks[1].endsWith('a')?'b':'a')+'.'+chunks[2],
  chunks[0]+'.'+chunks[1]+'.'+chunks[2].slice(0,-1)+(chunks[2].endsWith('a')?'b':'a'),
  token+'.surplus',
  'v2.@@@@.'+chunks[2],
  'v2.'+'A'.repeat(2800)+'.'+chunks[2],
  ''
 ])assert.equal(await verifySignedWhatsAppActionV2({token:mutated,secret,now}),null,mutated.slice(0,55));
 assert.equal(await verifySignedWhatsAppActionV2({token,secret,now:now+49*3600_000}),null,
  'expired tokens cannot become active with a future callback');
 assert.equal(await verifySignedWhatsAppActionV2({token,secret,now:now-6*60_000}),null,
  'issued timestamps cannot be more than 2 minutes in the future');
});

test('V2 token cannot be substituted for a valid legacy V1 signed assignment action',async()=>{
 const old=await createSignedWhatsAppAction({
  binding:{companyId:'shirat_hanevel',eventServiceId:'service-123',
   supplierId:'supplier-123',revision:'r8',outboxJobId:'outbox-123',
   provider:'green',senderAccountId:'9903183013',
   action:'assignment_approve',expiresAt:new Date(now+86400000).toISOString()},
  secret,nonce:'synthetic-testing-nonce-0123456789',issuedAt:now
 });
 assert.match(old,/^v1\./);
 assert.equal(await verifySignedWhatsAppActionV2({token:old,secret,now}),null,
  'V2 parser never accepts a live legacy signed token');
});

test('a valid signed payload still refuses different company, source, recipient, sender account, provider event or stale Outbox',async()=>{
 const token=await createSignedWhatsAppActionV2({binding:binding(),secret,now});
 const request={token,secret,trustedOutbox:outbox(),authenticatedProviderEvent:click(),now};
 assert.equal((await verifySignedWhatsAppV2Origin(request))?.action,'assignment_approve');
 for(const mutation of [
  {company_id:'outside_company'}, {message_kind:'client_invitation'},
  {resource_id:'different_service'}, {recipient_id:'different_supplier'},
  {revision:'r9'}, {sender_account_id:'otherGreen123'},
  {chat_id:'972509999999@c.us'}, {requested_provider:'wasender'},
  {status:'unknown'}, {provider_message_id:'3EB0OTHERMSG98765'}
 ]){
  assert.equal(await verifySignedWhatsAppV2Origin({
   ...request,trustedOutbox:{...outbox(),...mutation}
  }),null,JSON.stringify(mutation));
 }
 for(const mutation of [
  {provider:'wasender'}, {senderAccountId:'otherGreen123'},
  {senderChatId:'972509999999@c.us'},
  {originalProviderMessageId:'3EB0OTHERMSG98765'},
  {action:'assignment_reject'}
 ]){
  assert.equal(await verifySignedWhatsAppV2Origin({
   ...request,authenticatedProviderEvent:{...click(),...mutation}
  }),null,JSON.stringify(mutation));
 }
});

test('future reminder/client action with an unimplemented handler cannot be signed or accepted even when registered',async()=>{
 const newRegistry=createInteractiveActionRegistry([
  ...REGISTERED_WHATSAPP_ACTIONS.messageKinds,
  {messageKind:'supplier_reminder',sourceType:'supplier_reminder',
   resourceType:'event_service',audience:'supplier',maxButtons:2,
   actions:[{action:'reminder_acknowledge',delivery:'reply',handler:'not_implemented'},
    {action:'contact_office',delivery:'url',handler:'office_link'}]}
 ]);
 const example={...binding(),messageKind:'supplier_reminder',
  sourceType:'supplier_reminder',action:'reminder_acknowledge'};
 await assert.rejects(createSignedWhatsAppActionV2({binding:example,
  secret,registry:newRegistry,now}),/unimplemented_action/);
 assert.equal(await verifySignedWhatsAppV2Origin({
  token:'v2.fake.fake',secret,now,trustedOutbox:outbox(),
  authenticatedProviderEvent:click(),registry:newRegistry
 }),null);
 await assert.rejects(createSignedWhatsAppActionV2({
  binding:{...example,action:'contact_office'},secret,registry:newRegistry,now
 }),/registered message scope/,
 'office URL is never a signed inbound callback');
});

test('V2 crypto contains no transport, database writes, polling, dynamic action dispatch or non-server UI import',()=>{
 const src=fs.readFileSync('base44/shared/whatsappSignedActionV2.ts','utf8');
 assert.doesNotMatch(src,/base44\.functions\.invoke|fetch\(|Deno\.serve|setInterval\(|updateMany\(|\.create\(|\.delete\(/);
 assert.doesNotMatch(src,/eval\(|new Function\(/);
 assert.match(src,/await subtle\.verify/);
 assert.match(src,/DOMAIN\+signedMessage/);
 assert.match(src,/compareVerifiedInteractiveV2Origin/);
 assert.match(src,/not_implemented/);
});
