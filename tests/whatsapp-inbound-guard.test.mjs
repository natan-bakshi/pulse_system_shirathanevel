import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInboundButtonEvent} from '../base44/shared/whatsappInboundGuard.ts';
const policy={enabled:true,quoteAssignment:true,buttons:[{action:'assignment_approve',label:'אישור'}]};
const event={providerAuthenticated:true,provider:'green',providerEventId:'evt-1',providerMessageId:'msg-1',companyId:'tenant-1',senderAccountId:'instance-1',action:'assignment_approve'};
test('inbound guard refuses unsigned provider events and disabled actions',()=>{
 assert.equal(validateInboundButtonEvent({...event,providerAuthenticated:false},policy).valid,false);
 assert.equal(validateInboundButtonEvent({...event,action:'assignment_reject'},policy).valid,false);
 assert.equal(validateInboundButtonEvent(event,{...policy,enabled:false}).valid,false);
 assert.equal(validateInboundButtonEvent({...event,companyId:''},policy).valid,false);
});
test('a URL office button is not eligible for an inbound business mutation',()=>{
 const withOffice={enabled:true,quoteAssignment:false,buttons:[
  {action:'contact_office',label:'למשרד'}
 ]};
 assert.equal(validateInboundButtonEvent({
  ...event,action:'contact_office'
 },withOffice).valid,false);
});
test('dedupe scope is provider plus sending account plus provider event id',()=>{
 const a=validateInboundButtonEvent(event,policy);
 assert.equal(a.valid,true);
 assert.equal(a.dedupeKey,validateInboundButtonEvent({...event},policy).dedupeKey);
 assert.notEqual(a.dedupeKey,validateInboundButtonEvent({...event,senderAccountId:'other'},policy).dedupeKey);
});
