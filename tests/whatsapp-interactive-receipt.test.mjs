import test from 'node:test';
import assert from 'node:assert/strict';
import {inboundReceiptKey,inboundReceiptDecision} from '../base44/shared/whatsappInteractiveReceipt.ts';
test('inbound receipt key includes provider and account',()=>{
 const base={provider:'green',senderAccountId:'instance',providerEventId:'evt'};
 assert.notEqual(inboundReceiptKey(base),inboundReceiptKey({...base,senderAccountId:'other'}));
 assert.notEqual(inboundReceiptKey(base),inboundReceiptKey({...base,provider:'wasender'}));
 assert.throws(()=>inboundReceiptKey({...base,providerEventId:''}));
});
test('terminal and uncertain processing receipts never replay automatically',()=>{
 const now=Date.parse('2026-10-26T12:00:00Z');
 assert.equal(inboundReceiptDecision({state:'applied'},now).action,'ignore');
 assert.equal(inboundReceiptDecision({state:'rejected'},now).action,'ignore');
 assert.equal(inboundReceiptDecision({state:'processing',claimExpiresAt:'2026-10-26T11:00:00Z'},now).action,'reconcile');
 assert.equal(inboundReceiptDecision({state:'processing',claimExpiresAt:'2026-10-26T13:00:00Z'},now).action,'ignore');
 assert.equal(inboundReceiptDecision({state:'pending'},now).action,'claim');
});
