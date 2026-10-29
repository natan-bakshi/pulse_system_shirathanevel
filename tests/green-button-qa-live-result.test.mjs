import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGreenButtonQaLiveResult,summarizeGreenButtonQaLiveResult}
 from '../base44/shared/greenButtonQaLiveResult.ts';
const serviceId='qa-service-test-1',supplierId='qa-supplier-test-1';
const key='assignment:'+serviceId+':'+supplierId+':r1:SUPPLIER_NEW_ASSIGNMENT';
function fixture(){
 const service={id:serviceId,assignment_intent_revision:1,
  assignment_intents_pending:false,
  supplier_ids:JSON.stringify([supplierId]),
  supplier_statuses:JSON.stringify({[supplierId]:'confirmed'}),
  assignment_notification_intents:JSON.stringify([{
   supplier_id:supplierId,key,revision:1,qa_buttons_required:true,
   state:'queued'
  }])};
 const job={id:'one-qa-job-id',event_service_id:serviceId,
  supplier_id:supplierId,idempotency_key:key,interactive_qa_required:true,
  requested_provider:'green',provider:'green',status:'accepted',
  assignment_revision:'r1',provider_message_id:'synthetic-g-message-id',
  interactive_button_bindings_json:'{\"buttons\":[]}',attempt_count:1};
 const receipt={state:'applied',result_code:'applied',
  action:'assignment_approve',provider:'green',
  event_service_id:serviceId,supplier_id:supplierId,assignment_revision:'r1',
  outbox_job_id:job.id,provider_message_id:job.provider_message_id};
 return{service,jobs:[job],receipts:[receipt],serviceId,supplierId,
  newSendsDisabled:true,incomingEnabled:true};
}
test('one live Green sender attempt, exact original signed receipt and confirmed business status => complete',()=>{
 const f=fixture(),result=summarizeGreenButtonQaLiveResult(f);
 assert.equal(result.complete,true);
 assert.equal(result.status,'confirmed_success');
 assert.equal(result.originalMessageAccepted,true);
 assert.equal(result.singleProviderAttempt,true);
 assert.equal(result.signedApprovalReceiptApplied,true);
 assert.equal(result.supplierConfirmed,true);
 assert.equal(result.sameAssignmentRevision,true);
 assert.equal(result.uniqueOutboxAndReceipt,true);
 assert.equal(result.newSendsDisabled,true);
 assert.equal(result.incomingRemainsEnabled,true);
 for(const secret of [serviceId,supplierId,'synthetic-g-message-id',
  'one-qa-job-id','assignment:'+serviceId]){
  assert.equal(JSON.stringify(result).includes(secret),false);
 }
});
test('missing signed receipt, unconfirmed business status, or malformed state cannot report completion',()=>{
 for(const change of [
  f=>f.receipts=[],
  f=>f.service.supplier_statuses=JSON.stringify({[supplierId]:'pending'}),
  f=>f.service.assignment_intents_pending=true,
  f=>f.service.assignment_notification_intents='NOT_JSON',
  f=>f.service.supplier_ids='BAD_JSON',
  f=>f.service.assignment_intent_revision=2,
  f=>f.jobs[0].status='queued',
  f=>f.jobs[0].interactive_qa_required=false,
  f=>f.jobs[0].attempt_count=2,
  f=>f.jobs[0].requested_provider='wasender',
  f=>f.receipts[0].assignment_revision='r2',
  f=>f.receipts[0].provider_message_id='wrong-original',
  f=>f.receipts[0].outbox_job_id='not-this-job',
  f=>f.receipts[0].action='assignment_reject',
  f=>f.receipts[0].result_code='business_conflict'
 ]){
  const f=fixture();change(f);
  const result=summarizeGreenButtonQaLiveResult(f);
  assert.equal(result.complete,false);
  assert.equal(result.status,'requires_review');
 }
});
test('two outbox rows or two receipts never count as a single completed pilot',()=>{
 const f=fixture();f.jobs.push({...f.jobs[0],id:'duplicate-job'});
 assert.equal(summarizeGreenButtonQaLiveResult(f).complete,false);
 const g=fixture();g.receipts.push({...g.receipts[0]});
 assert.equal(summarizeGreenButtonQaLiveResult(g).complete,false);
});
test('no pilot assignment or provider jobs is not misreported as success',()=>{
 const f=fixture();
 f.service.supplier_ids='[]';f.service.supplier_statuses='{}';
 f.service.assignment_notification_intents='[]';
 f.jobs=[];f.receipts=[];
 const result=summarizeGreenButtonQaLiveResult(f);
 assert.equal(result.status,'not_started');
 assert.equal(result.complete,false);
});
test('owner-only result adapter makes exactly 3 targeted projected DB reads and ZERO writes or Green calls',async()=>{
 const f=fixture(),stats={service:0,outbox:0,receipt:0,mutations:0};
 const db={asServiceRole:{entities:{
  EventService:{get:async id=>{stats.service++;
   assert.equal(id,serviceId);return f.service;}},
  WhatsAppOutbox:{filter:async(q,_sort,limit,offset,fields)=>{
   stats.outbox++;
   assert.deepEqual(q,{event_service_id:serviceId,supplier_id:supplierId,
    source_type:'assignment_new'});
   assert.equal(limit,3);assert.equal(offset,0);
   assert.equal(fields.includes('message_text'),false);
   assert.equal(fields.includes('chat_id'),false);
   return f.jobs;}},
  WhatsAppInboundReceipt:{filter:async(q,_sort,limit,offset,fields)=>{
   stats.receipt++;
   assert.deepEqual(q,{event_service_id:serviceId,supplier_id:supplierId});
   assert.equal(limit,3);assert.equal(offset,0);
   assert.equal(fields.includes('provider_event_id'),false);
   assert.equal(fields.includes('receipt_key'),false);
   return f.receipts;}}
 }}};
 const env=k=>({
  GREEN_BUTTONS_QA_EVENT_SERVICE_ID:serviceId,
  GREEN_BUTTONS_QA_SUPPLIER_ID:supplierId,
  GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',
  GREEN_BUTTONS_QA_SEND_ENABLED:'disabled',
  GREEN_BUTTONS_QA_CREATE_ENABLED:'disabled'
 })[k]||'';
 const out=await inspectGreenButtonQaLiveResult(db,env);
 assert.equal(out.success,true);
 assert.equal(out.result.complete,true);
 assert.deepEqual(stats,{service:1,outbox:1,receipt:1,mutations:0});
 const json=JSON.stringify(out);
 for(const p of [serviceId,supplierId,key,'synthetic-g-message-id']){
  assert.equal(json.includes(p),false);
 }
 assert.equal(out.result.noProviderCalls,true);
 assert.equal(out.result.noWrites,true);
 assert.equal(out.result.noMessagesSent,true);
});
test('no scope or unavailable storage fails closed with no database queries',async()=>{
 const invalid=await inspectGreenButtonQaLiveResult({},()=>undefined);
 assert.equal(invalid.success,false);
 assert.equal(invalid.noProviderCalls,true);
 const missing=await inspectGreenButtonQaLiveResult({},k=>({
  GREEN_BUTTONS_QA_EVENT_SERVICE_ID:serviceId,
  GREEN_BUTTONS_QA_SUPPLIER_ID:supplierId
 })[k]);
 assert.equal(missing.success,false);
 assert.equal(missing.noWrites,true);
});
