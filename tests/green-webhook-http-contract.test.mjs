import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planFutureGreenWebhookHttpContract}
 from '../base44/shared/greenWebhookHttpContract.ts';
const status=o=>planFutureGreenWebhookHttpContract(o).plannedHttpStatus;
test('Green 200 is only proposed for known ignored manual chat or durable assignment receipt',()=>{
 const results=[
  {stage:'ignored_non_button',reason:'owner_approved_buttons_only_filter',
   verifiedProviderAndAccount:true,assignmentOnlyRoute:true,noDatabaseCalls:true},
  {stage:'processed',result:'applied',reason:'applied'},
  {stage:'processed',result:'rejected',reason:'business_conflict'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_finalized',
   terminalReceiptVerified:true,receiptState:'applied',resultCode:'applied'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_finalized',
   terminalReceiptVerified:true,receiptState:'needs_review',resultCode:'unknown_after_write'},
  {stage:'processed',result:'needs_review',reason:'unknown_after_write'}
 ];
 for(const r of results){
  const planned=planFutureGreenWebhookHttpContract(r);
  assert.equal(planned.plannedHttpStatus,200,JSON.stringify(r));
  assert.equal(planned.acknowledgeCandidate,true);
  assert.equal(planned.providerWillLikelyRetry,false);
  assert.equal(planned.noHttpResponseSent,true);
  assert.equal(planned.readyForLiveRollout,false);
  assert.equal(planned.neverReplaySupplierMutation,true);
 }
});
test('unverified, pending, unknown beta, database or CAS failures never propose success',()=>{
 const cases=[
  {stage:'invalid_selection',reason:'unverified_green_button_shape'},
  {stage:'processed',result:'held',reason:'existing_receipt_not_finalized'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_recorded'},
  {stage:'processed',result:'duplicate',reason:'provider_event_already_finalized',
   terminalReceiptVerified:false,receiptState:'applied',resultCode:'applied'},
  {stage:'processed',result:'needs_review',reason:'receipt_finalization_unverified'},
  {stage:'processed',result:'refused',reason:'receipt_registration_unverified'},
  {stage:'processed',result:'refused',reason:'unverified_button_binding'},
  {stage:'unknown'}
 ];
 for(const entry of cases){
  const planned=planFutureGreenWebhookHttpContract(entry);
  assert.notEqual(planned.plannedHttpStatus,200,JSON.stringify(entry));
  assert.equal(planned.acknowledgeCandidate,false);
  assert.equal(planned.providerWillLikelyRetry,true);
  assert.equal(planned.readyForLiveRollout,false);
 }
 assert.equal(status({stage:'invalid_selection'}),422);
 assert.equal(status({stage:'processed',result:'held'}),503);
 assert.equal(status({stage:'processed',result:'refused'}),422);
});
test('refused HTTP request preserves boundary status but never triggers message send',()=>{
 for(const code of [400,401,404,405,413,415]){
  const result=planFutureGreenWebhookHttpContract({
   stage:'request_refused',validationHttpStatus:code,
   reason:'provider_authentication_failed'
  });
  assert.equal(result.plannedHttpStatus,code);
  assert.equal(result.noProviderCalls,true);
  assert.equal(result.noDatabaseCalls,true);
  assert.equal(result.productionEndpointPublished,false);
 }
 assert.equal(status({stage:'request_refused',validationHttpStatus:200}),401);
});
test('rate guard is non-success even if a provider retries at documented interval',()=>{
 const result=planFutureGreenWebhookHttpContract({
  stage:'rate_guard_refused',reason:'rate_limited'
 });
 assert.equal(result.plannedHttpStatus,429);
 assert.equal(result.providerWillLikelyRetry,true);
 assert.equal(result.retryHorizonDocumentedHours,24);
 assert.equal(result.retryPolicyMustBeMeasured,true);
});
test('simulated HTTP contract does not create a public endpoint, fetch or mutate DB',()=>{
 const code=fs.readFileSync('base44/shared/greenWebhookHttpContract.ts','utf8')
  .split('\n').filter(x=>!x.trim().startsWith('//')).join('\n');
 assert.doesNotMatch(code,/\b(?:Deno\.serve|fetch\(|Response\.json|\.updateMany\(|\.create\()/);
 const admin=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 assert.doesNotMatch(admin,/greenWebhookHttpContract/);
});
