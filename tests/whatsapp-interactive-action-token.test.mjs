import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInteractiveActionBinding,actionBindingMatches} from '../base44/shared/whatsappInteractiveActionToken.ts';
const now=Date.parse('2026-10-26T12:00:00Z');
const a={companyId:'c1',eventServiceId:'es1',supplierId:'s1',revision:'r1',outboxJobId:'job1',provider:'green',senderAccountId:'sender1',action:'assignment_approve',expiresAt:'2026-10-27T12:00:00Z'};
test('action binding expires and cannot be reused across company, assignment or sender',()=>{
 assert.equal(actionBindingMatches(a,a,now),true);
 for(const key of ['companyId','eventServiceId','supplierId','revision','outboxJobId','provider','senderAccountId'])
  assert.equal(actionBindingMatches(a,{...a,[key]:'different'},now),false,key);
 assert.equal(actionBindingMatches(a,a,now+2*86400000),false);
});
test('invalid actions and unbounded expiry fail closed',()=>{
 assert.throws(()=>validateInteractiveActionBinding({...a,action:'run_code'},now));
 assert.throws(()=>validateInteractiveActionBinding({...a,expiresAt:'2027-10-27T12:00:00Z'},now));
 assert.throws(()=>validateInteractiveActionBinding({...a,revision:'bad\nvalue'},now));
});
