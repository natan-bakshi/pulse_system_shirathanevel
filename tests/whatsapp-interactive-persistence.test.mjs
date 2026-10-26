import test from 'node:test';
import assert from 'node:assert/strict';
import {assignmentOriginFromOutbox,loadAssignmentOriginFromOutbox} from '../base44/shared/whatsappInteractivePersistence.ts';
const m={companyId:'c',eventServiceId:'es',supplierId:'s',revision:'r',chatId:'972501234567@c.us',senderAccountId:'sender',provider:'green',outboxJobId:'job123',providerMessageId:'provider-id'};
const job={id:'job123',event_service_id:'es',supplier_id:'s',chat_id:'972501234567@c.us',status:'accepted',provider:'green',provider_message_id:'provider-id',sender_account_id:'sender',assignment_revision:'r'};
test('accepted receipt is authoritative and matches job identity',()=>{
 assert.equal(assignmentOriginFromOutbox(job,m).providerMessageId,'provider-id');
 for(const update of [{status:'unknown'},{provider:'wasender'},{supplier_id:'other'},
  {chat_id:'972509999999@c.us'},{provider_message_id:'wrong'},
  {sender_account_id:'other'},{assignment_revision:'r2'},{sender_account_id:''}])
  assert.equal(assignmentOriginFromOutbox({...job,...update},m),null);
});
test('bounded single-job lookup fails closed',async()=>{
 let calls=0;
 const entity={get:async()=>{calls++;return job;}};
 assert.equal((await loadAssignmentOriginFromOutbox(entity,m)).outboxJobId,'job123');
 assert.equal(calls,1);
 assert.equal(await loadAssignmentOriginFromOutbox(entity,{...m,outboxJobId:'bad!'}),null);
 assert.equal(calls,1);
 assert.equal(await loadAssignmentOriginFromOutbox({get:async()=>{throw Error('db down');}},m),null);
});
