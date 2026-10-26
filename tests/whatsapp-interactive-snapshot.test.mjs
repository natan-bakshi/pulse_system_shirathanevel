import test from 'node:test';
import assert from 'node:assert/strict';
import {createInteractiveOutboxSnapshot,readInteractiveOutboxSnapshot} from '../base44/shared/whatsappInteractiveSnapshot.ts';
import {defaultAssignmentWhatsAppPolicy} from '../base44/shared/whatsappInteractivePolicy.ts';
const origin={companyId:'c',eventServiceId:'es',supplierId:'s',revision:'v1',provider:'green',senderAccountId:'instance',outboxJobId:'job',providerMessageId:'receipt',status:'accepted'};
test('disabled snapshot is stable and parseable without executing actions',()=>{
 const serialized=createInteractiveOutboxSnapshot({policy:defaultAssignmentWhatsAppPolicy(),origin});
 assert.equal(readInteractiveOutboxSnapshot(serialized).origin.providerMessageId,'receipt');
 assert.equal(readInteractiveOutboxSnapshot(serialized).policy.enabled,false);
});
test('rejects activation without signed inbound and corrupted stored data',()=>{
 assert.throws(()=>createInteractiveOutboxSnapshot({policy:{...defaultAssignmentWhatsAppPolicy(),enabled:true},origin}));
 assert.equal(readInteractiveOutboxSnapshot('{'),null);
 assert.equal(readInteractiveOutboxSnapshot(JSON.stringify({version:2})),null);
});
