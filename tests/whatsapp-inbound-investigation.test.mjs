import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summarizeInboundReceiptInvestigation,inspectInboundReceiptReadOnly}
 from '../base44/shared/whatsappInboundInvestigation.ts';

const now=Date.parse('2026-10-26T11:00:00Z');
const receipt={
 id:'receipt-123',receipt_key:'provider-account-secret-event-123',
 provider:'green',state:'needs_review',event_service_id:'service-123',
 supplier_id:'supplier-123',assignment_revision:'r2',
 action:'assignment_approve',result_code:'unknown_after_write',
 registered_at:'2026-10-26T08:00:00Z',claim_until:'2026-10-26T09:00:00Z',
 raw_body:'PRIVATE INBOUND BODY',phone:'0502223344',
 token:'private-signed-token-abc'
};
const service={
 id:'service-123',supplier_ids:'["supplier-123"]',
 supplier_statuses:'{"supplier-123":"confirmed"}',
 assignment_intent_mode:'durable_v1',
 assignment_notification_intents:JSON.stringify([{
  supplier_id:'supplier-123',revision:2,state:'accepted',
  key:'assignment:service-123:supplier-123:r2:SUPPLIER_NEW_ASSIGNMENT'
 }]),
 client_notes:'PRIVATE CUSTOMER NOTES'
};
test('matching status is NOT mistaken for proof of a callback write; never auto replays',()=>{
 const summary=summarizeInboundReceiptInvestigation(receipt,service,{
  inbound_guard_key:receipt.receipt_key
 },now);
 assert.equal(summary.expectedStatus,'confirmed');
 assert.equal(summary.currentStatus,'confirmed');
 assert.equal(summary.revisionMatches,true);
 assert.equal(summary.stateMatchesExpected,true);
 assert.equal(summary.businessMatchDoesNotProveCallbackCommitted,true);
 assert.equal(summary.automaticReplayAllowed,false);
 assert.equal(summary.automaticGuardReleaseAllowed,false);
 assert.equal(summary.registrationBlocked,true);
 assert.equal(summary.guardMatchesThisReceipt,true);
 const shown=JSON.stringify(summary);
 for(const sensitive of ['PRIVATE INBOUND BODY','0502223344','private-signed-token-abc',
  'PRIVATE CUSTOMER NOTES','provider-account-secret-event-123'])
  assert.equal(shown.includes(sensitive),false);
});
test('expired processing flags review, not a new claim; stale revision remains visible as cause',()=>{
 const copy={...receipt,state:'processing',result_code:'invalid_code',
  assignment_revision:'r1'};
 const report=summarizeInboundReceiptInvestigation(copy,{
  ...service,supplier_statuses:'{"supplier-123":"pending"}'
 },{inbound_guard_key:''},now);
 assert.equal(report.expiredClaim,true);
 assert.equal(report.registrationBlocked,false);
 assert.equal(report.safeResult,'unknown');
 assert.equal(report.currentStatus,'pending');
 assert.equal(report.stateMatchesExpected,false);
 assert.equal(report.currentRevision,'stale_assignment_revision');
 assert.equal(report.automaticReplayAllowed,false);
});
test('broken source record, missing service and PII cannot be interpreted as successful processing',()=>{
 const broken=summarizeInboundReceiptInvestigation({
  ...receipt,state:'malicious',action:'delete_supplier'
 },{...service,supplier_statuses:'{'}, {},now);
 assert.equal(broken.expectedStatus,'unknown');
 assert.equal(broken.state,'unknown');
 assert.equal(broken.currentStatus,'unavailable');
 assert.equal(broken.stateMatchesExpected,false);
 const missing=summarizeInboundReceiptInvestigation(receipt,null,{},now);
 assert.equal(missing.currentStatus,'not_found');
 assert.equal(missing.revisionMatches,false);
});
test('inspect is one read of receipt, control, service; no writes and proper input validation',async()=>{
 let reads=0,mutations=0;
 const entities={
  WhatsAppInboundReceipt:{get:async id=>{reads++;return id===receipt.id?receipt:null;}},
  WhatsAppQueueControl:{filter:async()=>{reads++;return [{inbound_guard_key:''}];}},
  EventService:{get:async()=>{reads++;return service;}},
  WhatsAppOutbox:{updateMany:async()=>{mutations++;throw Error('never call');}}
 };
 const client={asServiceRole:{entities}};
 const result=await inspectInboundReceiptReadOnly(client,receipt.id);
 assert.equal(result.receiptId,'receipt-123');
 assert.equal(result.noMessagesSent,true);
 assert.equal(result.noBusinessWrites,true);
 assert.equal(reads,3);
 assert.equal(mutations,0);
 await assert.rejects(inspectInboundReceiptReadOnly(client,'receipt/invalid'),
  e=>e.status===400);
 await assert.rejects(inspectInboundReceiptReadOnly(client,'receipt-other'),
  e=>e.status===404);
 assert.equal(reads,4);
});
test('UI only offers owner read-only investigation on demand with no replay button',()=>{
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 const api=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 assert.match(ui,/onClick=\{\(\)=>run\('inboundInspect',\{id:entry\.id\}\)\}/);
 assert.match(ui,/פרטי תגובה/);
 assert.match(api,/action==='inboundInspect'/);
 assert.doesNotMatch(ui,/run\('inboundResolve'/);
 assert.doesNotMatch(ui,/run\('inboundRetry'/);
});
