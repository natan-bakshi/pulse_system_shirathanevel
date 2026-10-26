import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summarizeInboundWhatsAppReceipts} from '../base44/shared/whatsappInboundAudit.ts';
test('inbound audit reports only bounded status metadata and flags uncertain conditions',()=>{
 const now=Date.parse('2026-10-26T11:00:00Z');
 const rows=[
  {id:'receipt-1',state:'pending',provider:'green',raw_body:'secret text'},
  {id:'receipt-2',state:'processing',provider:'wasender',claim_until:'2026-10-26T10:00:00Z'},
  {id:'receipt-3',state:'processing',provider:'green',claim_until:'2026-10-26T12:00:00Z'},
  {id:'receipt-4',state:'needs_review',provider:'green',phone:'0500000000'},
  {id:'receipt-5',state:'applied',provider:'green'},
  {id:'receipt-6',state:'rejected',provider:'wasender'},
  {id:'receipt-7',state:'invalid',provider:'unsupported'}
 ];
 const result=summarizeInboundWhatsAppReceipts(rows,{inbound_guard_key:'pending-create'},now);
 assert.deepEqual(result.totals,{pending:1,processing:2,applied:1,rejected:1,needs_review:1});
 assert.equal(result.expiredProcessing,1);
 assert.equal(result.activeProcessing,1);
 assert.equal(result.registrationBlocked,true);
 assert.equal(result.unexpectedStatus,1);
 assert.equal(result.noMessagesSent,true);
 assert.equal(result.review.length,2);
 assert.equal(result.review[0].reason,'expired_processing');
 const text=JSON.stringify(result);
 assert.equal(text.includes('0500000000'),false);
 assert.equal(text.includes('secret text'),false);
 assert.equal(text.includes('pending-create'),false);
});
test('large sample is truncated and empty guard is not mistakenly shown as blocked',()=>{
 const rows=Array.from({length:102},(_,i)=>({
  id:'r'+i,state:'applied',provider:'green'
 }));
 const result=summarizeInboundWhatsAppReceipts(rows,{},Date.now());
 assert.equal(result.sampleCount,100);
 assert.equal(result.sampleTruncated,true);
 assert.equal(result.totals.applied,100);
 assert.equal(result.registrationBlocked,false);
});
test('inbound audit requires explicit owner action and is not on ordinary settings refresh',()=>{
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 const backend=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 assert.match(ui,/onClick=\{\(\)=>run\('inboundAudit'\)\}/);
 assert.match(ui,/action==='inboundAudit'/);
 assert.match(backend,/action==='inboundAudit'/);
 assert.match(backend,/\['id','state','claim_until','provider'\]/);
 assert.doesNotMatch(backend,/action==='status'.*inboundAudit/);
});
