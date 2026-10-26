import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createSignedWhatsAppAction} from '../base44/shared/whatsappSignedAction.ts';
import {preflightWhatsAppAssignmentResponse} from '../base44/shared/whatsappInboundAdmission.ts';

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
test('provider read failure never authorizes mutation or sends anything',async()=>{
 const f=fixture();
 f.client.entities.EventService.get=async()=>{throw Error('database outage')};
 const result=await preflightWhatsAppAssignmentResponse(await request(),f.client);
 assert.equal(result.admissible,false);
 assert.equal(result.reason,'context_unavailable');
 assert.equal(result.noMessagesSent,true);
});
