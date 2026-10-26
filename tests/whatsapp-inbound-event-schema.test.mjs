import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBoundInboundEvent} from '../base44/shared/whatsappInboundEventSchema.ts';
const now=Date.parse('2026-10-26T12:00:00Z');
const policy={enabled:true,quoteAssignment:false,buttons:[{action:'assignment_approve',label:'אישור'}]};
const binding={companyId:'c',eventServiceId:'es',supplierId:'s',revision:'r1',outboxJobId:'job',provider:'green',senderAccountId:'sender',action:'assignment_approve',expiresAt:'2026-10-27T12:00:00Z'};
const event={providerAuthenticated:true,provider:'green',senderAccountId:'sender',providerEventId:'evt',providerMessageId:'origin',originalProviderMessageId:'origin',companyId:'c',eventServiceId:'es',supplierId:'s',revision:'r1',outboxJobId:'job',action:'assignment_approve',binding};
test('bound inbound event only passes preflight with matching origin, action and revision',()=>{
 assert.equal(validateBoundInboundEvent(event,policy,now).valid,true);
 for(const mutation of [{companyId:'other'},{revision:'r2'},{action:'assignment_reject'},{originalProviderMessageId:'wrong'},{providerAuthenticated:false}])
  assert.equal(validateBoundInboundEvent({...event,...mutation},policy,now).valid,false);
 assert.equal(validateBoundInboundEvent(event,policy,now+3*86400000).valid,false);
});
