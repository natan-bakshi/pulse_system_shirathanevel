import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAssignmentMessageContext,resolveAssignmentQuote,evaluateAssignmentResponse} from '../base44/shared/whatsappInteractiveContext.ts';
const origin={companyId:'company',eventServiceId:'eventservice',supplierId:'supplier',revision:'rev1',chatId:'972501234567@c.us',provider:'green',senderAccountId:'green-instance',outboxJobId:'outbox1',providerMessageId:'receipt1',status:'accepted'};
const reply={companyId:'company',eventServiceId:'eventservice',supplierId:'supplier',revision:'rev1',chatId:'972501234567@c.us',provider:'green',senderAccountId:'green-instance'};
test('quotes only accepted original from same provider, account, assignment and revision',()=>{
 assert.deepEqual(resolveAssignmentQuote(origin,reply),{quoteMessageId:'receipt1',reason:'matched'});
 for(const key of ['companyId','eventServiceId','supplierId','revision','chatId','provider','senderAccountId']){
  const result=resolveAssignmentQuote(origin,{...reply,[key]:'different'});
  assert.equal(result.quoteMessageId,null,key);
 }
 assert.equal(resolveAssignmentQuote({...origin,status:'unknown',providerMessageId:''},reply).quoteMessageId,null);
 assert.equal(resolveAssignmentQuote(null,reply).reason,'missing_origin');
 assert.equal(resolveAssignmentQuote(origin,{...reply,chatId:'972509999999@c.us'}).reason,'chat_mismatch');
 assert.equal(resolveAssignmentQuote(origin,{...reply,chatId:undefined}).quoteMessageId,null);
});
test('reject accepted without receipt and malformed origin',()=>{
 assert.throws(()=>validateAssignmentMessageContext({...origin,providerMessageId:''}));
 assert.throws(()=>validateAssignmentMessageContext({...origin,companyId:'\n'}));
 assert.throws(()=>validateAssignmentMessageContext({...origin,status:'unknown'}));
 assert.throws(()=>validateAssignmentMessageContext({...origin,chatId:'972501234567@g.us'}));
});
const eligible={action:'assignment_approve',companyId:'company',eventServiceId:'eventservice',supplierId:'supplier',revision:'rev1',activeRevision:'rev1',currentStatus:'pending',assigned:true,authenticatedSupplierId:'supplier',authenticatedCompanyId:'company'};
test('response eligibility denies stale, unassigned, cross-company and already processed actions',()=>{
 assert.deepEqual(evaluateAssignmentResponse(eligible),{allowed:true,reason:'eligible',targetStatus:'confirmed'});
 assert.equal(evaluateAssignmentResponse({...eligible,action:'assignment_reject'}).targetStatus,'rejected');
 for(const change of [{revision:'old'},{assigned:false},{currentStatus:'confirmed'},{authenticatedSupplierId:'other'},{authenticatedCompanyId:'other'},{action:'delete'}]){
  assert.equal(evaluateAssignmentResponse({...eligible,...change}).allowed,false);
 }
});
