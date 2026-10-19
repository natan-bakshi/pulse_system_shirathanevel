import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {invitationFailureView,hasUnresolvedAgreementInvitation} from '../base44/shared/agreementInvitationSafety.ts';
import {normalizeIsraeliPhone,toChatId} from '../base44/shared/whatsappSend.ts';

function client(rows,{throwOnRead=false}={}){
 const db={ClientMessageDelivery:{filter:async(q)=>{
   if(throwOnRead)throw Error('Simulated DB lookup outage');
   return rows.filter(r=>Object.entries(q).every(([key,value])=>r[key]===value));
 }}};
 return db;
}
const key='agreement-qa123:invitation:4';
const url='https://pulse-system.base44.app/EventClosing?id=qa#token=not-a-real-token';
test('unknown persisted result stays UNKNOWN in agreement UI even after catch',async()=>{
 const result=await invitationFailureView(client([{key,state:'unknown',error_code:'QUEUE_ENQUEUE_UNVERIFIED'}]),key,url);
 assert.equal(result.delivery_state,'unknown');
 assert.equal(result.manual_review_required,true);
 assert.match(result.warning,/אין|אינה ודאית|בדוק/);
});
test('historical generic FAILED without proof of precreate failure remains unresolved',async()=>{
 const out=await invitationFailureView(client([{key,state:'failed',error_code:'',failure_phase:''}]),key,url);
 assert.equal(out.delivery_state,'unknown');
 assert.equal(out.manual_review_required,true);
});
test('classified definitely pre-enqueue failed is reported as failed, not received by WhatsApp',async()=>{
 const out=await invitationFailureView(client([{key,state:'failed',error_code:'QUEUE_DISABLED',
   failure_phase:'enqueue_not_confirmed'}]),key,url);
 assert.equal(out.delivery_state,'failed');
 assert.equal(out.manual_review_required,false);
 assert.match(out.warning,/אינו פעיל/);
});
test('cannot read delivery record: assume uncertain rather than false failed',async()=>{
 const out=await invitationFailureView(client([],{throwOnRead:true}),key,url);
 assert.equal(out.delivery_state,'unknown');
});
test('persisted queued/accepted are not failed merely because a later log/audit call threw',async()=>{
 for(const state of ['queued','accepted']){
   const out=await invitationFailureView(client([{key,state}]),key,url);
   assert.equal(out.delivery_state,state);
   assert.equal(out.manual_review_required,false);
 }
});
test('new invitation is allowed, but unknown/dispatching/unclassified failed invitation requires explicit review',async()=>{
 const id='agreement-qa123';
 assert.equal(await hasUnresolvedAgreementInvitation(client([]),id),false);
 for(const state of ['unknown','dispatching','failed']){
   const rows=[{agreement_id:id,kind:'invitation',state}];
   assert.equal(await hasUnresolvedAgreementInvitation(client(rows),id),true,state);
 }
 assert.equal(await hasUnresolvedAgreementInvitation(client([{
   agreement_id:id,kind:'invitation',state:'failed',error_code:'QUEUE_DISABLED',
   failure_phase:'enqueue_not_confirmed'
 }]),id),false);
 assert.equal(await hasUnresolvedAgreementInvitation(client([{agreement_id:'someone-else',kind:'invitation',
   state:'unknown'}]),id),false);
});
test('international numbers for North America, Europe and Asia retain their dialing prefixes',()=>{
 for(const [input,expected] of [
   ['+1 (516) 555-1234','15165551234'],
   ['0015165551234','15165551234'],
   ['+44 7700 900123','447700900123'],
   ['+33 6 12 34 56 78','33612345678'],
   ['+49 1512 3456789','4915123456789'],
   ['+91 98765 43210','919876543210'],
   ['0501234567','972501234567']
 ]){
   assert.equal(normalizeIsraeliPhone(input),expected,input);
   assert.equal(toChatId(input),expected+'@c.us',input);
 }
});
test('the agreement endpoint gates new invitation token/key before generation, and UI requires manual review',()=>{
 const backend=fs.readFileSync('base44/functions/eventAgreement/entry.ts','utf8');
 const ui=fs.readFileSync('src/components/billing/EventClosingPanel.jsx','utf8');
 const p=backend.indexOf('if(body.send===true && await hasUnresolvedAgreementInvitation');
 const token=backend.indexOf('const token=crypto.randomUUID()+crypto.randomUUID()',backend.indexOf('if(action==="issue")'));
 assert.ok(p>0&&token>p,'Duplicate review gate must be BEFORE rotating link and key');
 assert.match(backend,/invitationFailureView\(client\.entities/);
 assert.ok(!backend.includes('delivery_state:\'failed\',warning:e.message'), 'Never collapse an ambiguous failure to FAILED');
 assert.match(backend,/confirmPriorUncertain!==true/);
 assert.match(ui,/window\.confirm\(/);
 assert.match(ui,/confirmPriorUncertain:previousAmbiguous/);
});
