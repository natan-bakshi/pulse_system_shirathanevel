import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createSignedWhatsAppAction} from '../base44/shared/whatsappSignedAction.ts';
import {processVerifiedWhatsAppAssignmentResponse} from '../base44/shared/whatsappInboundCoordinator.ts';
import {registerVerifiedInboundReceipt} from '../base44/shared/whatsappInboundInbox.ts';

const signingSecret='internal-inbound-test-signing-key-very-long-123';
const webhookSecret='green-webhook-secret-for-unit-tests-very-long';
const instance='9903183013';
const fresh=()=>Date.now();
async function signedEvent(action='assignment_approve',providerEventId='incoming-green-123'){
 const now=fresh();
 const actionToken=await createSignedWhatsAppAction({
  binding:{companyId:'shirat_hanevel',eventServiceId:'service-abc',
   supplierId:'supplier-abc',revision:'r2',outboxJobId:'outbox-abc',
   provider:'green',senderAccountId:instance,action,
   expiresAt:new Date(now+60*60*1000).toISOString()},
  secret:signingSecret,nonce:'nonce-123456789abcdef',issuedAt:now
 },webcrypto.subtle);
 return {provider:'green',headers:{Authorization:'Bearer '+webhookSecret},
  webhookSecret,actionToken,actionSigningSecret:signingSecret,
  senderAccountId:instance,expectedSenderAccountId:instance,
  senderChatId:'972501234567@c.us',providerEventId,
  originalProviderMessageId:'3EB0STANZAMESSAGEID',now:now+1000,subtle:webcrypto.subtle};
}
function fixture(){
 const now=new Date().toISOString();
 const records=[],stats={reads:0,creates:0,supplierWrites:0,recalc:0};
 const job={id:'outbox-abc',source_type:'assignment_new',status:'accepted',
  provider:'green',provider_message_id:'3EB0STANZAMESSAGEID',
  sender_account_id:instance,assignment_revision:'r2',
  event_service_id:'service-abc',supplier_id:'supplier-abc',
  chat_id:'972501234567@c.us'};
 const supplier={id:'supplier-abc',phone:'0501234567',is_active:true};
 const service={id:'service-abc',event_id:'event-abc',is_external:false,
  supplier_ids:'["supplier-abc"]',supplier_statuses:'{"supplier-abc":"pending"}',
  declined_suppliers:'[]',assignment_intent_mode:'durable_v1',
  assignment_notification_intents:JSON.stringify([{
   key:'assignment:service-abc:supplier-abc:r2:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-abc',revision:2,state:'accepted'
  }])};
 const control={id:'queue-control',control_key:'global',
  inbound_guard_key:'',inbound_create_owner:'',inbound_create_until:'',
  lease_owner:'existing-whatsapp-worker',enqueue_owner:'',
  enabled:true,paused:false};
 let supplierFail='none',recalcFail=false,receiptFail=false,raceChange=null;
 const eq=(row,q)=>Object.entries(q||{}).every(([k,v])=>(row[k]??null)===(v??null));
 const db={
  WhatsAppOutbox:{get:async()=>{stats.reads++;return {...job};}},
  Supplier:{get:async()=>{stats.reads++;return {...supplier};}},
  EventService:{
   get:async()=>{
    stats.reads++;
    if(raceChange){const fn=raceChange;raceChange=null;fn(service);}
    return structuredClone(service);
   },
   updateMany:async(query,change)=>{
    if(!eq(service,query))return {updated:0};
    if(supplierFail==='before')throw Error('simulated prewrite failure');
    Object.assign(service,change.$set);stats.supplierWrites++;
    if(supplierFail==='after')throw Error('response lost after committed supplier CAS');
    return {updated:1};
   }
  },
  WhatsAppQueueControl:{
   filter:async(q)=>eq(control,q)?[control]:[],
   updateMany:async(q,change)=>{
    if(!eq(control,q))return {updated:0};
    Object.assign(control,change.$set);return {updated:1};
   }
  },
  WhatsAppInboundReceipt:{
   filter:async(q)=>records.filter(row=>eq(row,q)),
   get:async(id)=>records.find(row=>row.id===id)||null,
   create:async(fields)=>{const result={...fields,id:'receipt-'+(records.length+1)};records.push(result);stats.creates++;return {...result};},
   updateMany:async(q,change)=>{
    if(receiptFail&&change.$set.completed_at)throw Error('receipt finalization timeout');
    const matches=records.filter(row=>eq(row,q));
    for(const row of matches)Object.assign(row,change.$set);
    return {updated:matches.length};
   }
  }
 };
 const client={asServiceRole:{entities:db}};
 return {client,stats,job,supplier,service,control,records,
  race:fn=>raceChange=fn,
  failure:mode=>supplierFail=mode,
  recalcError:flag=>recalcFail=flag,
  receiptError:flag=>receiptFail=flag,
  recalculateEventStatus:async(eventId)=>{
   stats.recalc++;assert.equal(eventId,'event-abc');
   if(recalcFail)throw Error('event status recalculation timed out');
  }
 };
}
function call(f,providerEvent,patch={}){
 return processVerifiedWhatsAppAssignmentResponse({
  providerEvent,client:f.client,trustedRolloutEnabled:true,
  providerCapabilityVerified:true,claimOwner:'test-worker-owner-123',
  recalculateEventStatus:f.recalculateEventStatus,...patch
 });
}
test('unapproved rollout/capability fails with ZERO entity reads or writes',async()=>{
 const event=await signedEvent();
 for(const patch of [{trustedRolloutEnabled:false},{providerCapabilityVerified:false}]){
  const f=fixture(),result=await call(f,event,patch);
  assert.equal(result.status,'refused');
  assert.equal(result.reason,'rollout_disabled');
  assert.equal(f.stats.reads,0);
  assert.equal(f.stats.supplierWrites,0);
  assert.equal(f.stats.creates,0);
 }
});
test('invalid authentication or mismatched provider account cannot register or mutate',async()=>{
 const event=await signedEvent();
 for(const patch of [
  {headers:{Authorization:'Bearer invalid'}},
  {senderAccountId:'different-account'},
  {actionSigningSecret:'wrong-signing-secret-but-at-least-32bytes'},
  {providerEventId:''}
 ]){
  const f=fixture(),result=await call(f,{...event,...patch});
  assert.equal(result.status,'refused');
  assert.equal(f.stats.reads,0);
  assert.equal(f.stats.creates,0);
  assert.equal(f.stats.supplierWrites,0);
 }
});
test('verified approve applies ONE status CAS then recalculates and closes receipt; retry does not mutate',async()=>{
 const f=fixture(),event=await signedEvent();
 const first=await call(f,event);
 assert.equal(first.status,'applied');
 assert.equal(first.reason,'applied');
 assert.equal(first.providerCalls,0);
 assert.equal(first.supplierWritesAuthorized,true);
 assert.equal(f.stats.supplierWrites,1);
 assert.equal(f.stats.recalc,1);
 assert.equal(f.records[0].state,'applied');
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-abc'],'confirmed');
 const second=await call(f,event);
 assert.equal(second.status,'duplicate','durably finalized original must safely recognize Green redelivery');
 assert.equal(second.reason,'provider_event_already_finalized');
 assert.equal(second.terminalReceiptVerified,true);
 assert.equal(second.receiptState,'applied');
 assert.equal(f.stats.supplierWrites,1);
 assert.equal(f.stats.creates,1);
 assert.equal(f.control.lease_owner,'existing-whatsapp-worker');
});
test('duplicate provider webhook while receipt is still pending or processing is held, NEVER ACK-confirmed',async()=>{
 for(const state of ['pending','processing','needs_review']){
  const f=fixture(),event=await signedEvent();
  const received={
   provider:'green',senderAccountId:instance,providerEventId:event.providerEventId,
   providerMessageId:event.originalProviderMessageId,companyId:'shirat_hanevel',
   eventServiceId:'service-abc',supplierId:'supplier-abc',revision:'r2',
   outboxJobId:'outbox-abc',action:'assignment_approve'
  };
  await registerVerifiedInboundReceipt(f.client,received);
  f.records[0].state=state;
  const reply=await call(f,event);
  assert.equal(reply.status,'held',state);
  assert.equal(reply.reason,'existing_receipt_not_finalized',state);
  assert.equal(reply.terminalReceiptVerified,undefined);
  assert.equal(f.stats.supplierWrites,0,state);
  assert.equal(f.stats.creates,1,state);
  assert.equal(f.stats.recalc,0,state);
  assert.equal(f.records[0].state,state);
 }
});
test('verified duplicate remains recognizable after reassigning supplier to a newer revision, without replay',async()=>{
 const f=fixture(),event=await signedEvent();
 assert.equal((await call(f,event)).status,'applied');
 f.service.assignment_notification_intents=JSON.stringify([
  ...JSON.parse(f.service.assignment_notification_intents),{
   key:'assignment:service-abc:supplier-abc:r3:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-abc',revision:3,state:'accepted'
  }
 ]);
 f.service.supplier_statuses='{"supplier-abc":"pending"}';
 const duplicate=await call(f,event);
 assert.equal(duplicate.status,'duplicate');
 assert.equal(duplicate.terminalReceiptVerified,true);
 assert.equal(duplicate.receiptState,'applied');
 assert.equal(f.stats.creates,1);
 assert.equal(f.stats.supplierWrites,1);
});
test('reused provider event ID with different signed action is a conflict, not an ACK or transition',async()=>{
 const f=fixture(),one=await signedEvent('assignment_approve','same-provider-event');
 await registerVerifiedInboundReceipt(f.client,{
  provider:'green',senderAccountId:instance,providerEventId:one.providerEventId,
  providerMessageId:one.originalProviderMessageId,companyId:'shirat_hanevel',
  eventServiceId:'service-abc',supplierId:'supplier-abc',revision:'r2',
  outboxJobId:'outbox-abc',action:'assignment_approve'
 });
 const different=await signedEvent('assignment_reject','same-provider-event');
 const response=await call(f,different);
 assert.equal(response.status,'refused');
 assert.equal(response.reason,'receipt_registration_unverified');
 assert.equal(f.stats.creates,1);
 assert.equal(f.stats.supplierWrites,0);
});
test('receipt lookup outage after accepted supplier change does NOT turn replay into success',async()=>{
 const f=fixture(),event=await signedEvent();
 assert.equal((await call(f,event)).status,'applied');
 const before=f.stats.supplierWrites;
 f.client.asServiceRole.entities.WhatsAppInboundReceipt.filter=async()=>{
  throw Error('temporary read failure');
 };
 const again=await call(f,event);
 assert.equal(again.status,'held');
 assert.equal(again.reason,'existing_receipt_lookup_unverified');
 assert.equal(f.stats.supplierWrites,before);
});
test('different unrecorded Green event after supplier decision cannot be ACKed as old response',async()=>{
 const f=fixture(),event=await signedEvent('assignment_approve','original-receipt');
 assert.equal((await call(f,event)).status,'applied');
 const different=await signedEvent('assignment_approve','another-provider-event');
 const response=await call(f,different);
 assert.equal(response.status,'refused');
 assert.equal(response.reason,'assignment_not_pending');
 assert.equal(f.stats.creates,1);
 assert.equal(f.stats.supplierWrites,1);
});
test('competing dashboard rejection causes business-conflict terminal, not a WhatsApp overwrite',async()=>{
 const f=fixture(),event=await signedEvent();
 // Admission's get sees pending; supplier writer's later get sees confirmed.
 let gets=0;
 const originalGet=f.client.asServiceRole.entities.EventService.get;
 f.client.asServiceRole.entities.EventService.get=async()=>{
  gets++;
  if(gets===2)f.service.supplier_statuses='{"supplier-abc":"rejected"}';
  return originalGet();
 };
 const result=await call(f,event);
 assert.equal(result.status,'rejected');
 assert.equal(result.reason,'business_conflict');
 assert.equal(f.stats.supplierWrites,0);
 assert.equal(f.stats.recalc,0);
 assert.equal(f.records[0].state,'rejected');
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-abc'],'rejected');
});
test('durable business-conflict receipt is recognized on redelivery even if business status later appears pending',async()=>{
 const f=fixture(),event=await signedEvent();
 let reads=0;
 const get=f.client.asServiceRole.entities.EventService.get;
 f.client.asServiceRole.entities.EventService.get=async()=>{
  reads++;
  if(reads===2)f.service.supplier_statuses='{"supplier-abc":"rejected"}';
  return get();
 };
 const one=await call(f,event);
 assert.equal(one.status,'rejected');
 assert.equal(one.reason,'business_conflict');
 assert.equal(f.records[0].state,'rejected');
 f.service.supplier_statuses='{"supplier-abc":"pending"}';
 const replay=await call(f,event);
 assert.equal(replay.status,'duplicate');
 assert.equal(replay.receiptState,'rejected');
 assert.equal(replay.resultCode,'business_conflict');
 assert.equal(replay.terminalReceiptVerified,true);
 assert.equal(f.stats.supplierWrites,0);
 assert.equal(f.stats.creates,1);
});
test('ambiguous committed supplier CAS gets NEEDS_REVIEW and is NEVER tried twice',async()=>{
 const f=fixture(),event=await signedEvent();
 f.failure('after');
 const result=await call(f,event);
 assert.equal(result.status,'needs_review');
 assert.equal(result.reason,'unknown_after_write');
 assert.equal(f.records[0].state,'needs_review');
 assert.equal(f.stats.supplierWrites,1);
 assert.equal(f.stats.recalc,0);
 const duplicate=await call(f,event);
 assert.equal(duplicate.status,'duplicate');
 assert.equal(duplicate.receiptState,'needs_review');
 assert.equal(duplicate.resultCode,'unknown_after_write');
 assert.equal(duplicate.terminalReceiptVerified,true);
 assert.equal(f.stats.supplierWrites,1);
});
test('failed event readiness after a committed supplier write is treated as unknown, not replay',async()=>{
 const f=fixture(),event=await signedEvent();
 f.recalcError(true);
 const result=await call(f,event);
 assert.equal(result.status,'needs_review');
 assert.equal(f.stats.supplierWrites,1);
 assert.equal(f.stats.recalc,1);
 assert.equal(f.records[0].state,'needs_review');
});
test('receipt finalization timeout leaves processing receipt for review with no supplier replay',async()=>{
 const f=fixture(),event=await signedEvent();
 f.receiptError(true);
 const result=await call(f,event);
 assert.equal(result.status,'needs_review');
 assert.equal(result.reason,'receipt_finalization_unverified');
 assert.equal(f.stats.supplierWrites,1);
 assert.equal(f.records[0].state,'processing');
 const replay=await call(f,event);
 assert.equal(replay.status,'held');
 assert.equal(replay.reason,'existing_receipt_not_finalized');
 assert.equal(f.stats.supplierWrites,1);
});
test('precommit supplier API failures remain conservatively needs_review; no automatic retry',async()=>{
 const f=fixture(),event=await signedEvent();
 f.failure('before');
 const outcome=await call(f,event);
 assert.equal(outcome.status,'needs_review');
 assert.equal(f.stats.supplierWrites,0);
 assert.equal(f.records[0].state,'needs_review');
});
