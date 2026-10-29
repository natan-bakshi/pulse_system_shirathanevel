import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFutureInteractiveButtonSnapshot} from '../base44/shared/whatsappButtonBindings.ts';
import {processFutureGreenButtonCallback} from '../base44/shared/greenInteractiveCallbackCoordinator.ts';
import {stageFutureGreenInteractiveHttpCallback} from '../base44/shared/greenInteractiveHttpStaging.ts';
import {planFutureGreenWebhookAck} from '../base44/shared/greenWebhookAckPlanning.ts';

const now=Date.parse('2026-10-26T12:00:00Z');
const instance='9903183013';
const signingSecret='green-internal-offline-action-signing-key-123456789';
const webhookSecret='green-internal-offline-webhook-secret-123456789';
function fixture(){
 const job={
  id:'outbox-abc',status:'queued',source_type:'assignment_new',
  requested_provider:'green',provider:'green',message_type:'text',
  message_text:'שיבוץ ספק',chat_id:'972501234567@c.us',
  event_service_id:'service-abc',supplier_id:'supplier-abc',
  sender_account_id:instance,assignment_revision:'r5',
  provider_message_id:'3EB0A5815E6EBF7DE71DE3'
 };
 const service={
  id:'service-abc',event_id:'event-abc',
  is_external:false,supplier_ids:'["supplier-abc"]',
  supplier_statuses:'{"supplier-abc":"pending"}',
  declined_suppliers:'[]',assignment_intent_mode:'durable_v1',
  assignment_notification_intents:JSON.stringify([{
   key:'assignment:service-abc:supplier-abc:r5:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-abc',revision:5,state:'accepted'
  }])
 };
 const supplier={id:'supplier-abc',phone:'0501234567',is_active:true};
 const control={id:'control',control_key:'global',inbound_guard_key:'',
  inbound_create_owner:'',inbound_create_until:'',
  enabled:true,paused:false,lease_owner:'',enqueue_owner:''};
 const receipts=[],calls={outboxReads:0,serviceReads:0,writes:0,creates:0,recalc:0};
 let duplicateOrigin=false;
 const matches=(row,query)=>Object.entries(query||{}).every(([k,v])=>
  (row[k]??null)===(v??null));
 const db={
  WhatsAppOutbox:{
   filter:async(query,sort,limit,offset,fields)=>{
    calls.outboxReads++;
    assert.equal(limit,2);
    assert.equal(fields.includes('message_text'),false);
    assert.equal(fields.includes('interactive_button_bindings_json'),true);
    const rows=matches(job,query)?[structuredClone(job)]:[];
    return duplicateOrigin?rows.concat(rows):rows;
   },
   get:async(id)=>{calls.outboxReads++;return id===job.id?structuredClone(job):null;}
  },
  Supplier:{get:async(id)=>id===supplier.id?structuredClone(supplier):null},
  EventService:{
   get:async(id)=>{calls.serviceReads++;return id===service.id?structuredClone(service):null;},
   updateMany:async(query,change)=>{
    if(!matches(service,query))return {updated:0};
    Object.assign(service,change.$set);calls.writes++;return {updated:1};
   }
  },
  WhatsAppQueueControl:{
   filter:async(query)=>matches(control,query)?[control]:[],
   updateMany:async(query,change)=>{
    if(!matches(control,query))return {updated:0};
    Object.assign(control,change.$set);return {updated:1};
   }
  },
  WhatsAppInboundReceipt:{
   filter:async(query)=>receipts.filter(row=>matches(row,query)),
   get:async(id)=>receipts.find(row=>row.id===id)||null,
   create:async(data)=>{
    const row={...data,id:'receipt-'+(receipts.length+1)};
    receipts.push(row);calls.creates++;return {...row};
   },
   updateMany:async(query,change)=>{
    const rows=receipts.filter(row=>matches(row,query));
    for(const row of rows)Object.assign(row,change.$set);
    return {updated:rows.length};
   }
  }
 };
 return {job,service,supplier,control,receipts,calls,
  client:{asServiceRole:{entities:db}},
  duplicate:()=>{duplicateOrigin=true;},
  recalculateEventStatus:async(eventId)=>{
   assert.equal(eventId,'event-abc');calls.recalc++;
  }};
}
async function setup(){
 const f=fixture();
 f.job.interactive_button_bindings_json=await createFutureInteractiveButtonSnapshot({
  job:f.job,policy:{enabled:true,quoteAssignment:false,buttons:[
   {action:'assignment_approve',label:'מאשר'},
   {action:'assignment_reject',label:'דוחה'}
  ]},signingSecret,issuedAt:now,
  nonceFactory:(()=>{let n=0;return ()=>'nonce-green-callback-'+(++n)+'-123456';})()
 },webcrypto.subtle);
 f.job.status='accepted';
 const buttons=JSON.parse(f.job.interactive_button_bindings_json).buttons;
 return {...f,buttons};
}
function rawFor(buttonId,eventId='C0CD39BB261589D5C98412D255CD000B'){
 return {typeWebhook:'incomingMessageReceived',
  idMessage:eventId,timestamp:Math.floor(now/1000),
  instanceData:{idInstance:Number(instance),typeInstance:'whatsapp'},
  senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us'},
  messageData:{typeMessage:'interactiveButtonsResponse',
   quotedMessage:{stanzaId:'3EB0A5815E6EBF7DE71DE3'},
   interactiveButtonsResponse:{stanzaId:'3EB0A5815E6EBF7DE71DE3',
    selectedId:buttonId,selectedIndex:0,
    selectedDisplayText:'UNTRUSTED DISPLAY TEXT'}}
 };
}
function call(f,raw,extra={}){
 return processFutureGreenButtonCallback({
  client:f.client,headers:{Authorization:'Bearer '+webhookSecret},
  rawCallback:raw,callbackByteLength:JSON.stringify(raw).length,
  expectedInstanceId:instance,webhookSecret,actionSigningSecret:signingSecret,
  trustedRolloutEnabled:true,accountCapabilityVerified:true,
  claimOwner:'internal-green-worker-123',
  recalculateEventStatus:f.recalculateEventStatus,
  subtle:webcrypto.subtle,now,
  ...extra
 });
}
function requestFor(raw,header='Bearer '+webhookSecret){
 return new Request('https://invalid.example.test/callback',{method:'POST',
  headers:{'content-type':'application/json','Authorization':header},
  body:JSON.stringify(raw)});
}
function stageCall(f,req,patch={}){
 return stageFutureGreenInteractiveHttpCallback(req,{
  client:f.client,rolloutAuthorized:true,accountCapabilityVerified:true,
  webhookSecret,actionSigningSecret:signingSecret,
  expectedInstanceId:instance,claimOwner:'internal-green-worker-123',
  recalculateEventStatus:f.recalculateEventStatus,
  now,subtle:webcrypto.subtle,maxPerMinute:30,...patch
 });
}
test('FULL offline HTTP pipeline: authenticated bytes -> budget -> signed original -> one supplier write',async()=>{
 const f=await setup();
 const response=await stageCall(f,requestFor(rawFor(f.buttons[0].buttonId)));
 assert.equal(response.stage,'processed');
 assert.equal(response.result,'applied');
 assert.equal(response.providerCalls,0);
 assert.equal(response.businessWritesAuthorized,true);
 assert.equal(f.control.inbound_rate_count,1);
 assert.equal(f.calls.writes,1);
 assert.equal(f.calls.creates,1);
 assert.equal(f.calls.recalc,1);
 assert.equal(f.receipts[0].state,'applied');
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-abc'],'confirmed');
});
test('FULL internal HTTP-to-ACK simulation: repeated Green delivery after applied status is verified as durable duplicate, no second write',async()=>{
 const f=await setup(),raw=rawFor(f.buttons[0].buttonId);
 const one=await stageCall(f,requestFor(raw));
 assert.equal(one.result,'applied');
 assert.equal(planFutureGreenWebhookAck(one).decision,'safe_ack_candidate');
 const again=await stageCall(f,requestFor(raw));
 assert.equal(again.result,'duplicate');
 assert.equal(again.reason,'provider_event_already_finalized');
 assert.equal(again.terminalReceiptVerified,true);
 assert.equal(again.receiptState,'applied');
 assert.equal(again.resultCode,'applied');
 const plan=planFutureGreenWebhookAck(again);
 assert.equal(plan.decision,'safe_ack_candidate');
 assert.equal(plan.reason,'durable_terminal_duplicate');
 assert.equal(plan.providerAckNotPublished,true);
 assert.equal(f.calls.writes,1);
 assert.equal(f.calls.creates,1);
 assert.equal(f.calls.recalc,1);
 assert.equal(f.receipts.length,1);
});
test('HTTP ingress: rollout off, invalid bearer, wrong instance and size spoof spend zero business writes',async()=>{
 const cases=[
  {patch:{rolloutAuthorized:false},raw:rawFor('wa1_stub'),header:'Bearer '+webhookSecret},
  {patch:{},raw:rawFor('wa1_stub'),header:'Bearer wrong-token'},
  {patch:{},raw:{...rawFor('wa1_stub'),instanceData:{idInstance:1111111111,typeInstance:'whatsapp'}},header:'Bearer '+webhookSecret}
 ];
 for(const item of cases){
  const f=await setup();
  const result=await stageCall(f,requestFor(item.raw,item.header),item.patch);
  assert.notEqual(result.stage,'processed');
  assert.equal(f.calls.outboxReads,0);
  assert.equal(f.calls.creates,0);
  assert.equal(f.calls.writes,0);
  assert.equal(f.control.inbound_rate_count,undefined);
 }
});
test('HTTP ingress global rate limit refuses authenticated button before Outbox or supplier lookup',async()=>{
 const f=await setup();
 f.control.inbound_rate_window_started_at=new Date(now).toISOString();
 f.control.inbound_rate_count=30;
 const result=await stageCall(f,requestFor(rawFor(f.buttons[0].buttonId)));
 assert.equal(result.stage,'rate_guard_refused');
 assert.equal(result.reason,'rate_limited');
 assert.equal(result.retryAfterSeconds,60);
 assert.equal(f.calls.outboxReads,0);
 assert.equal(f.calls.creates,0);
 assert.equal(f.calls.writes,0);
});
test('full offline adapter: GREEN callback -> authenticated Outbox -> signed button -> receipt -> supplier CAS',async()=>{
 const f=await setup();
 const response=await call(f,rawFor(f.buttons[0].buttonId));
 assert.equal(response.status,'applied');
 assert.equal(response.providerCalls,0);
 assert.equal(f.calls.writes,1);
 assert.equal(f.calls.creates,1);
 assert.equal(f.calls.recalc,1);
 assert.equal(f.receipts[0].state,'applied');
 assert.equal(JSON.parse(f.service.supplier_statuses)['supplier-abc'],'confirmed');
 assert.ok(f.calls.outboxReads<=2,'one bounded original lookup plus one authoritative preflight');
 const replay=await call(f,rawFor(f.buttons[0].buttonId));
 assert.equal(replay.status,'duplicate');
 assert.equal(replay.terminalReceiptVerified,true);
 assert.equal(replay.receiptState,'applied');
 assert.equal(f.calls.writes,1);
 assert.equal(f.calls.creates,1);
});
test('no endpoint enabled, bad header, oversized payload or unknown instance => no DB read',async()=>{
 const f=await setup(),raw=rawFor(f.buttons[0].buttonId);
 const cases=[
  {trustedRolloutEnabled:false},
  {accountCapabilityVerified:false},
  {headers:{Authorization:'Bearer invalid'}},
  {callbackByteLength:40000},
  {expectedInstanceId:'9900000000'},
  {callbackByteLength:0}
 ];
 for(const mutation of cases){
  const result=await call(f,raw,mutation);
  assert.equal(result.status,'refused');
  assert.equal(f.calls.outboxReads,0);
  assert.equal(f.calls.writes,0);
  assert.equal(f.calls.creates,0);
 }
});
test('QA inbound scope rejects correct signed button for unrelated service/supplier before any receipt or EventService CAS',async()=>{
 for(const override of [
  {qaEventServiceId:'service-another',qaSupplierId:'supplier-abc'},
  {qaEventServiceId:'service-abc',qaSupplierId:'supplier-another'}
 ]){
  const f=await setup();
  const response=await call(f,rawFor(f.buttons[0].buttonId),override);
  assert.equal(response.status,'refused');
  assert.equal(response.reason,'qa_assignment_outside_scope');
  assert.equal(f.calls.creates,0);
  assert.equal(f.calls.writes,0);
  assert.equal(f.calls.recalc,0);
  assert.equal(f.calls.serviceReads,0);
 }
 const f=await setup();
 f.job.interactive_qa_required=true;
 const result=await call(f,rawFor(f.buttons[0].buttonId),{
  qaEventServiceId:'service-abc',qaSupplierId:'supplier-abc'
 });
 assert.equal(result.status,'applied');
 assert.equal(f.calls.writes,1);
});
test('an older signed QA message stays inbound-eligible after switching send scope to a SECOND exact service',async()=>{
 const opts={qaEventServiceId:'service-new-qa',
  qaPreviousEventServiceId:'service-abc',qaSupplierId:'supplier-abc'};
 const f=await setup();f.job.interactive_qa_required=true;
 const result=await call(f,rawFor(f.buttons[0].buttonId),opts);
 assert.equal(result.status,'applied');
 assert.equal(f.calls.writes,1);
 assert.equal(f.calls.creates,1);
 const replay=await call(f,rawFor(f.buttons[0].buttonId),opts);
 assert.equal(replay.status,'duplicate');
 assert.equal(replay.terminalReceiptVerified,true);
 assert.equal(f.calls.writes,1);
 assert.equal(f.calls.creates,1);
});
test('two-service inbound allowlist rejects any other service, wrong supplier, malformed previous ID, and unmarked Outbox',async()=>{
 for(const overrides of [
  {qaEventServiceId:'service-new-qa',qaSupplierId:'supplier-abc'},
  {qaEventServiceId:'service-new-qa',qaPreviousEventServiceId:'service-not-original',qaSupplierId:'supplier-abc'},
  {qaEventServiceId:'service-new-qa',qaPreviousEventServiceId:'service-abc',qaSupplierId:'supplier-other'},
  {qaEventServiceId:'service-new-qa',qaPreviousEventServiceId:'service-new-qa',qaSupplierId:'supplier-abc'},
  {qaEventServiceId:'service-new-qa',qaPreviousEventServiceId:'bad id!',qaSupplierId:'supplier-abc'}
 ]){
  const f=await setup();f.job.interactive_qa_required=true;
  const result=await call(f,rawFor(f.buttons[0].buttonId),overrides);
  assert.equal(result.status,'refused');
  assert.equal(result.reason,'qa_assignment_outside_scope');
  assert.equal(f.calls.creates,0);
  assert.equal(f.calls.writes,0);
 }
 const f=await setup();
 const res=await call(f,rawFor(f.buttons[0].buttonId),{
  qaEventServiceId:'service-new-qa',qaPreviousEventServiceId:'service-abc',qaSupplierId:'supplier-abc'
 });
 assert.equal(res.status,'refused','a non-QA message is never promoted to a historical QA approval');
 assert.equal(f.calls.creates,0);
 assert.equal(f.calls.writes,0);
});
test('wrong button, signature tampering, duplicate original receipt or wrong chat fails closed',async()=>{
 const cases=[
  async f=>rawFor('wa1_invalidInvalidInvalid12'),
  async f=>{
   const data=JSON.parse(f.job.interactive_button_bindings_json);
   f.job.interactive_button_bindings_json=JSON.stringify({
    ...data,buttons:data.buttons.map(b=>({...b,label:'SOMETHING ELSE'}))
   });
   return rawFor(f.buttons[0].buttonId);
  },
  async f=>{f.duplicate();return rawFor(f.buttons[0].buttonId);},
  async f=>({...rawFor(f.buttons[0].buttonId),
   senderData:{chatId:'972509999999@c.us',sender:'972509999999@c.us'}})
 ];
 for(const scenario of cases){
  const f=await setup();
  const response=await call(f,await scenario(f));
  assert.equal(response.status,'refused');
  assert.equal(f.calls.creates,0);
  assert.equal(f.calls.writes,0);
 }
});
