import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createSignedWhatsAppAction} from '../base44/shared/whatsappSignedAction.ts';
import {preflightWhatsAppAssignmentResponse} from '../base44/shared/whatsappInboundAdmission.ts';
import {withLegacySupplierReplyRevisions} from '../base44/shared/legacySupplierReplyRevisions.ts';
import {legacyAssignmentGeneration} from '../base44/shared/legacyAssignmentButtonScope.ts';
import {assignmentWhatsAppKey} from '../base44/shared/assignmentWhatsApp.ts';

const now=Date.parse('2026-10-26T12:00:00Z');
const webhookSecret='provider-green-webhook-secret-32-bytes-minimum';
const signingSecret='internal-action-signature-only-on-server-012345';
const original={
 id:'outbox-123',source_type:'assignment_new',status:'accepted',
 provider:'green',provider_message_id:'receipt-abc',
 sender_account_id:'instance-green-123',assignment_revision:'r5',
 event_service_id:'service-123',supplier_id:'supplier-123',
 chat_id:'972501234567@c.us'
};
function fixture(){
 const row=structuredClone(original);
 const supplier={id:'supplier-123',is_active:true,phone:'050-123-4567'};
 const service={
  id:'service-123',is_external:false,supplier_ids:'["supplier-123"]',
  supplier_statuses:'{"supplier-123":"pending"}',
  assignment_intent_mode:'durable_v1',
  assignment_notification_intents:JSON.stringify([{
   key:'assignment:service-123:supplier-123:r5:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-123',revision:5,state:'accepted'
  }])
 };
 let reads=0;
 const client={entities:{
  WhatsAppOutbox:{get:async()=>{reads++;return structuredClone(row);}},
  Supplier:{get:async()=>{reads++;return structuredClone(supplier);}},
  EventService:{get:async()=>{reads++;return structuredClone(service);}}
 }};
 return {row,supplier,service,client,reads:()=>reads};
}
async function request(override={},bindingOverrides={}){
 const token=await createSignedWhatsAppAction({
  binding:{
   companyId:'shirat_hanevel',eventServiceId:'service-123',supplierId:'supplier-123',
   revision:'r5',outboxJobId:'outbox-123',provider:'green',
   senderAccountId:'instance-green-123',action:'assignment_approve',
   expiresAt:new Date(now+86400000).toISOString(),...bindingOverrides
  },secret:signingSecret,nonce:'nonce-123456789abcdef',issuedAt:now
 },webcrypto.subtle);
 return {
  provider:'green',headers:{Authorization:'Bearer '+webhookSecret},
  webhookSecret,actionToken:token,actionSigningSecret:signingSecret,
  senderAccountId:'instance-green-123',expectedSenderAccountId:'instance-green-123',
  senderChatId:'972501234567@c.us',originalProviderMessageId:'receipt-abc',
  providerEventId:'provider-event-xyz',now:now+1000,subtle:webcrypto.subtle,...override
 };
}
test('provider auth + signed token + original Outbox + registered supplier + fresh intent must all agree',async()=>{
 const f=fixture();
 const result=await preflightWhatsAppAssignmentResponse(await request(),f.client);
 assert.equal(result.admissible,true);
 assert.equal(result.reason,'verified_read_only');
 assert.equal(result.receipt.receiptKey,'green:instance-green-123:provider-event-xyz');
 assert.equal(result.receipt.action,'assignment_approve');
 assert.equal(result.receipt.companyId,'shirat_hanevel');
 assert.equal(result.requiresDurableClaim,true);
 assert.equal(result.requiresRolloutApproval,true);
 assert.equal(result.noMessagesSent,true);
 assert.equal(f.reads(),3,'One bounded read of each authoritative record');
});
test('bad provider auth, different provider account, invalid action signature block BEFORE database reads',async()=>{
 for(const change of [
  {headers:{Authorization:'Bearer wrong'}},
  {senderAccountId:'other-account'},
  {expectedSenderAccountId:'other-account'},
  {actionSigningSecret:'different-server-secret-long-enough-987654321'},
  {providerEventId:''},
  {originalProviderMessageId:''},
  {actionToken:'v1.invalid.invalid'}
 ]){
  const f=fixture();
  const result=await preflightWhatsAppAssignmentResponse(await request(change),f.client);
  assert.equal(result.admissible,false);
  assert.equal(f.reads(),0);
 }
});
test('same valid signed action cannot use another chat, changed provider receipt, or different source job',async()=>{
 for(const patch of [
  {chat_id:'972509999999@c.us'},
  {sender_account_id:'different-account'},
  {assignment_revision:'r4'},
  {status:'unknown'},
  {provider_message_id:'another-id'},
  {source_type:'client_billing'},
  {event_service_id:'another-service'},
  {supplier_id:'another-supplier'}
 ]){
  const f=fixture();Object.assign(f.row,patch);
  const result=await preflightWhatsAppAssignmentResponse(await request(),f.client);
  assert.equal(result.admissible,false,JSON.stringify(patch));
 }
});
test('real supplier number must match the originating WhatsApp chat and be active',async()=>{
 for(const supplierPatch of [
  {phone:'0508888888'}, {phone:'not a phone'}, {is_active:false}
 ]){
  const f=fixture();Object.assign(f.supplier,supplierPatch);
  const result=await preflightWhatsAppAssignmentResponse(await request(),f.client);
  assert.equal(result.admissible,false);
  assert.equal(result.reason,'supplier_sender_mismatch');
 }
 const f=fixture();
 const result=await preflightWhatsAppAssignmentResponse(await request({
  senderChatId:'972509999999@c.us'
 }),f.client);
 assert.equal(result.admissible,false);
});
test('reassigned, cancelled, rejected or removed assignments deny stale provider responses',async()=>{
 const mutations=[
  s=>{s.supplier_ids='[]';},
  s=>{s.supplier_statuses='{"supplier-123":"rejected"}';},
  s=>{s.assignment_intent_mode='';},
  s=>{s.assignment_notification_intents=JSON.stringify([{
   key:'assignment:service-123:supplier-123:r6:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-123',revision:6,state:'requested'
  }]);},
  s=>{s.assignment_notification_intents=JSON.stringify([{
   key:'assignment:service-123:supplier-123:r5:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-123',revision:5,state:'cancelled'
  }]);},
  s=>{s.is_external=true;}
 ];
 for(const mutate of mutations){
  const f=fixture();mutate(f.service);
  const result=await preflightWhatsAppAssignmentResponse(await request(),f.client);
  assert.equal(result.admissible,false);
 }
});
test('signed original Green callback still admits supplier B after unrelated supplier A confirms on the same service',async()=>{
 const f=fixture();
 const b='supplier-123',a='supplier-unrelated';
 const s0={...f.service,supplier_ids:'[]',supplier_statuses:'{}',
  assignment_intent_mode:'',assignment_notification_intents:'[]'};
 const first=withLegacySupplierReplyRevisions(s0,{
  supplier_ids:JSON.stringify([a,b]),
  supplier_statuses:JSON.stringify({[a]:'pending',[b]:'pending'})
 },now);
 Object.assign(f.service,s0,first);
 f.row.assignment_revision=legacyAssignmentGeneration(f.service,b);
 f.row.idempotency_key=assignmentWhatsAppKey(f.service,b);
 assert.match(f.row.idempotency_key,/:l[0-9]+:SUPPLIER_NEW_ASSIGNMENT$/);
 const aConfirmed=withLegacySupplierReplyRevisions(f.service,{
  supplier_statuses:JSON.stringify({[a]:'confirmed',[b]:'pending'})
 },now+2000);
 Object.assign(f.service,aConfirmed,{
  updated_date:new Date(now+2000).toISOString().slice(0,-1)+'000'
 });
 const signed=await request({}, {revision:f.row.assignment_revision});
 const allowed=await preflightWhatsAppAssignmentResponse(signed,f.client);
 assert.equal(allowed.admissible,true,allowed.reason);
 assert.equal(allowed.receipt.supplierId,b);
 assert.equal(allowed.receipt.revision,f.row.assignment_revision);
 // A status change by the SAME supplier revokes its old token. Reopening
 // cannot revive the original request even if it happens within one ms.
 Object.assign(f.service,withLegacySupplierReplyRevisions(f.service,{
  supplier_statuses:JSON.stringify({[a]:'confirmed',[b]:'confirmed'})
 },now+2100));
 Object.assign(f.service,withLegacySupplierReplyRevisions(f.service,{
  supplier_statuses:JSON.stringify({[a]:'confirmed',[b]:'pending'})
 },now+2100));
 const stale=await preflightWhatsAppAssignmentResponse(signed,f.client);
 assert.equal(stale.admissible,false);
 assert.equal(stale.reason,'stale_legacy_assignment');
});
test('historical 48-hour Green button click after five days still requires the exact original supplier and pending revision',async()=>{
 const delayed=await request({now:now+5*86400000},{expiresAt:new Date(now+2*86400000).toISOString()});
 const valid=fixture();
 const admitted=await preflightWhatsAppAssignmentResponse(delayed,valid.client);
 assert.equal(admitted.admissible,true,admitted.reason);
 assert.equal(admitted.requiresDurableClaim,true);
 assert.equal(valid.reads(),3);
 const invalid=fixture();invalid.service.supplier_statuses='{"supplier-123":"rejected"}';
 const blocked=await preflightWhatsAppAssignmentResponse(delayed,invalid.client);
 assert.equal(blocked.admissible,false);
 const untrusted=fixture();const forged=await preflightWhatsAppAssignmentResponse({...delayed,headers:{Authorization:'Bearer bad'}},untrusted.client);
 assert.equal(forged.admissible,false);
 assert.equal(untrusted.reads(),0);
 const tooOld=fixture();const expired=await preflightWhatsAppAssignmentResponse({...delayed,now:now+31*86400000},tooOld.client);
 assert.equal(expired.admissible,false);
 assert.equal(tooOld.reads(),0);
});
test('provider read failure never authorizes mutation or sends anything',async()=>{
 const f=fixture();
 f.client.entities.EventService.get=async()=>{throw Error('database outage')};
 const result=await preflightWhatsAppAssignmentResponse(await request(),f.client);
 assert.equal(result.admissible,false);
 assert.equal(result.reason,'context_unavailable');
 assert.equal(result.noMessagesSent,true);
});
