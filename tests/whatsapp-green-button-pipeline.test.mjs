import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFutureInteractiveButtonSnapshot,resolveSignedActionForGreenButton} from '../base44/shared/whatsappButtonBindings.ts';
import {parseGreenButtonSelection} from '../base44/shared/greenInteractiveCallback.ts';
import {preflightWhatsAppAssignmentResponse} from '../base44/shared/whatsappInboundAdmission.ts';
import {registerVerifiedInboundReceipt,claimPendingInboundReceipt,finishInboundReceipt} from '../base44/shared/whatsappInboundInbox.ts';
import {persistAuthorizedSupplierStatus} from '../base44/shared/supplierStatusPersistence.ts';

const now=Date.parse('2026-10-26T12:00:00Z');
const SIGN='server-action-secret-synthetic-only-123456789012345';
const WEBHOOK='green-webhook-test-secret-123456789012345';
const INSTANCE='9903183013';
function fixture(){
 const job={
  id:'outbox-abc',source_type:'assignment_new',message_type:'text',
  status:'sending',requested_provider:'green',provider:'green',
  chat_id:'972501234567@c.us',event_service_id:'service-abc',
  supplier_id:'supplier-abc',sender_account_id:INSTANCE,assignment_revision:'r5',
  provider_message_id:'3EB0A5815E6EBF7DE71DE3'
 };
 const service={
  id:'service-abc',event_id:'event-abc',is_external:false,
  supplier_ids:'["supplier-abc"]',supplier_statuses:'{"supplier-abc":"pending"}',
  declined_suppliers:'[]',assignment_intent_mode:'durable_v1',
  assignment_notification_intents:JSON.stringify([{
   key:'assignment:service-abc:supplier-abc:r5:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-abc',revision:5,state:'accepted'
  }])
 };
 const supplier={id:'supplier-abc',phone:'0501234567',is_active:true};
 const control={id:'control-global',control_key:'global',
  inbound_guard_key:'',inbound_create_owner:'',inbound_create_until:'',
  enabled:true,paused:false,lease_owner:'',enqueue_owner:''};
 const receipts=[],stats={supplierWrites:0,inboundCreates:0,providerSends:0};
 const matches=(row,query)=>Object.entries(query).every(([k,v])=>
  (row[k]??null)===(v??null));
 let n=0;
 const entity=(row)=>({get:async()=>structuredClone(row)});
 const db={
  WhatsAppOutbox:entity(job),
  Supplier:entity(supplier),
  EventService:{
   get:async()=>structuredClone(service),
   updateMany:async(query,ops)=>{
    if(!matches(service,query))return {updated:0};
    Object.assign(service,ops.$set);stats.supplierWrites++;
    return {updated:1};
   }
  },
  WhatsAppQueueControl:{
   filter:async(query)=>matches(control,query)?[control]:[],
   updateMany:async(query,ops)=>{
    if(!matches(control,query))return {updated:0};
    Object.assign(control,ops.$set);return {updated:1};
   }
  },
  WhatsAppInboundReceipt:{
   filter:async(query)=>receipts.filter(r=>matches(r,query)),
   get:async(id)=>receipts.find(r=>r.id===id)||null,
   create:async(data)=>{
    const result={...data,id:'receipt-'+(++n)};
    receipts.push(result);stats.inboundCreates++;
    return {...result};
   },
   updateMany:async(query,ops)=>{
    let updated=0;
    for(const record of receipts)if(matches(record,query)){
     Object.assign(record,ops.$set);updated++;
    }
    return {updated};
   }
  }
 };
 const client={entities:db,asServiceRole:{entities:db}};
 return {job,service,supplier,control,receipts,stats,client};
}
async function makeButtons(job){
 const json=await createFutureInteractiveButtonSnapshot({
  job,policy:{enabled:true,quoteAssignment:false,buttons:[
   {action:'assignment_approve',label:'מאשר'},
   {action:'assignment_reject',label:'דוחה'}
  ]},signingSecret:SIGN,issuedAt:now,
  nonceFactory:(()=>{let i=0;return ()=>'nonce-green-test-'+(++i)+'-12345678';})()
 },webcrypto.subtle);
 job.interactive_button_bindings_json=json;
 job.status='accepted';
 return JSON.parse(json).buttons;
}
function greenEvent(buttonId,eventId){
 return {
  typeWebhook:'incomingMessageReceived',
  instanceData:{idInstance:Number(INSTANCE),wid:'972599999999@c.us',typeInstance:'whatsapp'},
  timestamp:Math.floor(now/1000),idMessage:eventId,
  senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us'},
  messageData:{typeMessage:'interactiveButtonsResponse',
   quotedMessage:{stanzaId:'3EB0A5815E6EBF7DE71DE3'},
   interactiveButtonsResponse:{stanzaId:'3EB0A5815E6EBF7DE71DE3',
    selectedId:buttonId,selectedDisplayText:'not authoritative'}}
 };
}
async function admit(f,buttonId,eventId){
 const clicked=parseGreenButtonSelection(greenEvent(buttonId,eventId),INSTANCE,now);
 assert.ok(clicked,'Green provider adapter must recognize the click');
 const token=resolveSignedActionForGreenButton(f.job,clicked);
 assert.ok(token,'Short button ID must bind to frozen original Outbox');
 const response=await preflightWhatsAppAssignmentResponse({
  ...clicked,headers:{Authorization:'Bearer '+WEBHOOK},webhookSecret:WEBHOOK,
  actionToken:token,actionSigningSecret:SIGN,
  expectedSenderAccountId:INSTANCE,now:now+1000,subtle:webcrypto.subtle
 },f.client);
 return response;
}
test('complete synthetic green approval: click -> signed origin -> inbox -> CAS -> terminal; duplicate no-op',async()=>{
 const f=fixture(),buttons=await makeButtons(f.job);
 const eventId='C0CD39BB261589D5C98412D255CD000B';
 const admitted=await admit(f,buttons[0].buttonId,eventId);
 assert.equal(admitted.admissible,true);
 assert.equal(admitted.receipt.action,'assignment_approve');
 const registered=await registerVerifiedInboundReceipt(f.client,admitted.receipt);
 assert.equal(registered.kind,'registered');
 const claimed=await claimPendingInboundReceipt(f.client,{
  receiptId:registered.id,receiptKey:registered.receiptKey,claimOwner:'synthetic-worker',
  now:now+2000
 });
 assert.equal(claimed.claimed,true);
 const status=await persistAuthorizedSupplierStatus(f.client.asServiceRole,{
  eventServiceId:admitted.receipt.eventServiceId,
  supplierId:admitted.receipt.supplierId,
  newStatus:'confirmed',source:'whatsapp',expectedRevision:admitted.receipt.revision
 });
 assert.equal(status.kind,'changed');
 const finished=await finishInboundReceipt(f.client,{
  receiptId:registered.id,receiptKey:registered.receiptKey,
  claimOwner:'synthetic-worker',outcome:'applied',resultCode:'applied',now:now+3000
 });
 assert.equal(finished.finalized,true);
 const duplicate=await registerVerifiedInboundReceipt(f.client,admitted.receipt);
 assert.equal(duplicate.kind,'duplicate');assert.equal(duplicate.processAllowed,false);
 assert.equal(f.stats.inboundCreates,1);
 assert.equal(f.stats.supplierWrites,1);
 assert.equal(f.receipts[0].state,'applied');
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-abc'],'confirmed');
 assert.equal(f.stats.providerSends,0);
});
test('conflicting clicks from same accepted assignment cannot both change supplier',async()=>{
 const f=fixture(),buttons=await makeButtons(f.job);
 const first=await admit(f,buttons[0].buttonId,'C0CD39BB261589D5C98412D255CD000B');
 const second=await admit(f,buttons[1].buttonId,'D0CD39BB261589D5C98412D255CD000B');
 assert.equal(first.admissible,true);
 assert.equal(second.admissible,true,'both were eligible BEFORE the competing CAS');
 const one=await registerVerifiedInboundReceipt(f.client,first.receipt);
 const two=await registerVerifiedInboundReceipt(f.client,second.receipt);
 const a=await claimPendingInboundReceipt(f.client,{
  receiptId:one.id,receiptKey:one.receiptKey,claimOwner:'worker-one',now:now+2000
 });
 const b=await claimPendingInboundReceipt(f.client,{
  receiptId:two.id,receiptKey:two.receiptKey,claimOwner:'worker-two',now:now+2000
 });
 assert.equal(a.claimed,true);assert.equal(b.claimed,true);
 await persistAuthorizedSupplierStatus(f.client.asServiceRole,{
  eventServiceId:'service-abc',supplierId:'supplier-abc',
  source:'whatsapp',expectedRevision:'r5',newStatus:'confirmed'
 });
 await assert.rejects(persistAuthorizedSupplierStatus(f.client.asServiceRole,{
  eventServiceId:'service-abc',supplierId:'supplier-abc',
  source:'whatsapp',expectedRevision:'r5',newStatus:'rejected'
 }),e=>e.code==='stale_or_invalid_supplier_transition');
 const loser=await finishInboundReceipt(f.client,{
  receiptId:two.id,receiptKey:two.receiptKey,claimOwner:'worker-two',
  outcome:'rejected',resultCode:'business_conflict',now:now+3000
 });
 assert.equal(loser.finalized,true);
 assert.equal(f.stats.supplierWrites,1);
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-abc'],'confirmed');
 assert.equal(f.stats.providerSends,0);
});
