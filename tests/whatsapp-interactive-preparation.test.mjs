import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {prepareFutureGreenAssignmentOutbox} from '../base44/shared/whatsappInteractivePreparation.ts';
import {verifySignedWhatsAppAction} from '../base44/shared/whatsappSignedAction.ts';

const now=Date.parse('2026-10-26T11:30:00Z');
const signingSecret='test-only-server-signed-action-key-0123456789';
const policy={enabled:true,quoteAssignment:false,buttons:[
 {action:'assignment_approve',label:'אישור'},
 {action:'assignment_reject',label:'דחייה'},
 {action:'contact_office',label:'פנייה למשרד'}
]};
const baseJob=()=>({
 id:'outbox-abc123',source_type:'assignment_new',status:'queued',
 message_type:'text',chat_id:'972501234567@c.us',
 requested_provider:'green',attempt_count:0,send_started_at:'',
 provider_message_id:'',event_service_id:'service-abc123',supplier_id:'supplier-abc123',
 idempotency_key:'assignment:service-abc123:supplier-abc123:r2:SUPPLIER_NEW_ASSIGNMENT',
 message_text:'Test assignment',created_date:'2026-10-26T11:00:00Z'
});
const baseService=()=>({
 id:'service-abc123',event_id:'event-abc123',is_external:false,
 supplier_ids:'["supplier-abc123"]',
 supplier_statuses:'{"supplier-abc123":"pending"}',
 assignment_intent_mode:'durable_v1',
 assignment_notification_intents:JSON.stringify([
  {key:'assignment:service-abc123:supplier-abc123:r2:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-abc123',revision:2,state:'accepted'},
  {key:'assignment:service-abc123:supplier-def234:r3:SUPPLIER_NEW_ASSIGNMENT',
   supplier_id:'supplier-def234',revision:3,state:'requested'}
 ])
});
function fixture(){
 const job=baseJob(),service=baseService();
 const counters={reads:0,writes:0,transports:0,created:0,ambiguous:0};
 let concurrentUpdate=null,writeOutcome='ok',breakReads=false;
 const matches=(target,query)=>Object.entries(query||{}).every(([key,value])=>
  (target[key]??null)===(value??null));
 const db={
  WhatsAppOutbox:{
   get:async()=>{counters.reads++;if(breakReads)throw Error('read timeout');return structuredClone(job);},
   updateMany:async(filter,operation)=>{
    if(concurrentUpdate){const cb=concurrentUpdate;concurrentUpdate=null;cb(job);}
    if(!matches(job,filter))return {updated:0};
    if(writeOutcome==='before')throw Error('write did not commit');
    Object.assign(job,operation.$set);counters.writes++;
    if(writeOutcome==='after')throw Error('commit response lost');
    if(writeOutcome==='unconfirmed')return {updated:undefined};
    return {updated:1};
   },
   create:async()=>{counters.created++;throw Error('Unexpected Outbox CREATE');}
  },
  EventService:{get:async()=>{counters.reads++;return structuredClone(service);}}
 };
 return {job,service,counters,client:{asServiceRole:{entities:db}},
  race:fn=>concurrentUpdate=fn,
  setWriteOutcome:next=>writeOutcome=next,
  setReadFailure:value=>breakReads=value};
}
function input(patch={}){
 return {outboxJobId:'outbox-abc123',senderAccountId:'9903183013',
  policy,signingSecret,providerCapabilityVerified:true,rolloutAuthorized:true,
  issuedAt:now,subtle:webcrypto.subtle,...patch};
}
test('feature rollout gates prohibit ANY reads or writes before authorization',async()=>{
 for(const patch of [
  {rolloutAuthorized:false},{rolloutAuthorized:undefined},
  {providerCapabilityVerified:false},{providerCapabilityVerified:undefined}
 ]){
  const f=fixture();
  await assert.rejects(prepareFutureGreenAssignmentOutbox(f.client,input(patch)),
   err=>err.code==='interactive_rollout_disabled');
  assert.deepEqual(f.counters,{reads:0,writes:0,transports:0,created:0,ambiguous:0});
 }
});
test('freeze trusted provider, latest SUPPLIER revision, signed short IDs in single CAS before send',async()=>{
 const f=fixture();
 const saved=await prepareFutureGreenAssignmentOutbox(f.client,input());
 assert.equal(saved.status,'prepared');
 assert.equal(saved.noProviderCalled,true);
 assert.equal(f.job.status,'queued');
 assert.equal(f.job.attempt_count,0);
 assert.equal(f.job.sender_account_id,'9903183013');
 assert.equal(f.job.assignment_revision,'r2','unrelated supplier revision r3 must not supersede r2');
 assert.equal(saved.snapshot,f.job.interactive_button_bindings_json);
 assert.equal(f.counters.writes,1);
 const data=JSON.parse(saved.snapshot);
 assert.equal(data.chatId,'972501234567@c.us');
 assert.equal(data.eventServiceId,'service-abc123');
 assert.equal(data.supplierId,'supplier-abc123');
 assert.equal(data.buttons.length,2,'office action is separate, not a reply');
 for(const button of data.buttons){
  assert.match(button.buttonId,/^wa1_[A-Za-z0-9_-]{22}$/);
  const bound=await verifySignedWhatsAppAction({
   token:button.actionToken,secret:signingSecret,now:now+1000
  },webcrypto.subtle);
  assert.equal(bound.eventServiceId,'service-abc123');
  assert.equal(bound.revision,'r2');
  assert.equal(bound.action,button.action);
 }
 assert.equal(f.counters.transports,0);
});
test('same job reuses frozen bytes without a second write or regenerated button IDs',async()=>{
 const f=fixture();
 const first=await prepareFutureGreenAssignmentOutbox(f.client,input());
 const repeated=await prepareFutureGreenAssignmentOutbox(f.client,input());
 assert.equal(repeated.status,'already_prepared');
 assert.equal(repeated.snapshot,first.snapshot);
 assert.equal(f.counters.writes,1);
 assert.equal(f.counters.created,0);
});
test('parallel workers each generate locally but only one immutable snapshot wins',async()=>{
 const f=fixture();
 const results=await Promise.all(Array.from({length:8},
  ()=>prepareFutureGreenAssignmentOutbox(f.client,input())));
 assert.equal(results.length,8);
 assert.equal(f.counters.writes,1);
 assert.equal(new Set(results.map(r=>r.snapshot)).size,1);
 assert.equal(results.every(r=>r.noProviderCalled),true);
});
test('COMMITTED but lost CAS response verifies persisted snapshot, NEVER repeats write',async()=>{
 const f=fixture();f.setWriteOutcome('after');
 const result=await prepareFutureGreenAssignmentOutbox(f.client,input());
 assert.equal(result.status,'verified_after_uncertain_write');
 assert.equal(f.counters.writes,1);
 assert.equal(result.snapshot,f.job.interactive_button_bindings_json);
});
test('FAILED CAS before commit does not fake success, nor retry automatically',async()=>{
 const f=fixture();f.setWriteOutcome('before');
 await assert.rejects(prepareFutureGreenAssignmentOutbox(f.client,input()),
  e=>e.code==='interactive_snapshot_persistence_unknown');
 assert.equal(f.counters.writes,0);
 assert.equal(f.job.interactive_button_bindings_json,undefined);
});
test('read timeout AFTER uncertain write is fail-closed; worker may not call provider',async()=>{
 const f=fixture();f.setWriteOutcome('after');
 f.race(()=>f.setReadFailure(true));
 await assert.rejects(prepareFutureGreenAssignmentOutbox(f.client,input()),
  e=>e.code==='interactive_snapshot_persistence_unknown');
 assert.equal(f.counters.writes,1);
});
test('lost race to job claim, cancel or provider receipt cannot prepare buttons',async()=>{
 for(const mutate of [
  job=>{job.status='sending';job.attempt_count=1;},
  job=>{job.status='cancelled';},
  job=>{job.provider_message_id='accepted-receipt';}
 ]){
  const f=fixture();f.race(mutate);
  await assert.rejects(prepareFutureGreenAssignmentOutbox(f.client,input()),
   e=>['interactive_snapshot_race_or_unknown','interactive_snapshot_conflict'].includes(e.code));
  assert.equal(f.counters.writes,0);
 }
});
test('legacy send attempt, Wasender job, group, stale supplier or invalid intent never prepare',async()=>{
 const mutations=[
  f=>{f.job.attempt_count=1;},
  f=>{f.job.send_started_at='2026-10-26T11:20:00Z';},
  f=>{f.job.requested_provider='wasender';},
  f=>{f.job.chat_id='group-id@g.us';},
  f=>{f.job.source_type='invoice';},
  f=>{f.service.is_external=true;},
  f=>{f.service.supplier_ids='[]';},
  f=>{f.service.supplier_statuses='{"supplier-abc123":"rejected"}';},
  f=>{f.service.assignment_intent_mode='';},
  f=>{f.job.idempotency_key='assignment:service-abc123:supplier-abc123:r1:SUPPLIER_NEW_ASSIGNMENT';},
  f=>{f.job.idempotency_key='assignment:service-abc123:supplier-abc123:r9:SUPPLIER_NEW_ASSIGNMENT';},
  f=>{f.service.assignment_notification_intents='{';},
  f=>{f.service.assignment_notification_intents=JSON.stringify([
   {key:'assignment:service-abc123:supplier-abc123:r5:SUPPLIER_NEW_ASSIGNMENT',
    supplier_id:'supplier-abc123',revision:5,state:'cancelled'}
  ]);}
 ];
 for(const mutate of mutations){
  const f=fixture();mutate(f);
  await assert.rejects(prepareFutureGreenAssignmentOutbox(f.client,input()));
  assert.equal(f.counters.writes,0);
 }
});
test('unsigned, altered, expired, wrong-account and partial snapshots refuse silent repair',async()=>{
 const f=fixture();
 await prepareFutureGreenAssignmentOutbox(f.client,input());
 const original=f.job.interactive_button_bindings_json;
 for(const patch of [
  {sender_account_id:'9900000000'},
  {assignment_revision:'r5'},
  {interactive_button_bindings_json:'{}'},
  {interactive_button_bindings_json:JSON.stringify({
   ...JSON.parse(original),buttons:JSON.parse(original).buttons.map(b=>({...b,label:'NOT ORIGINAL'}))
  })}
 ]){
  const clone=fixture();
  Object.assign(clone.job,{...f.job,...patch});
  await assert.rejects(prepareFutureGreenAssignmentOutbox(clone.client,input()));
  assert.equal(clone.counters.writes,0);
 }
 const same=fixture();Object.assign(same.job,f.job);
 await assert.rejects(prepareFutureGreenAssignmentOutbox(same.client,input({
  signingSecret:'different-secret-key-unique-345678901234567'
 })),e=>e.code==='invalid_existing_interactive_snapshot');
 await assert.rejects(prepareFutureGreenAssignmentOutbox(same.client,input({
  issuedAt:now+3*86400000
 })),e=>e.code==='invalid_existing_interactive_snapshot');
});
test('malformed policy and incomplete origin fail without provider calls',async()=>{
 for(const bad of [
  {policy:{...policy,enabled:false}},
  {policy:{...policy,buttons:[]}},
  {senderAccountId:'not-an-instance'},
  {signingSecret:'short'}
 ]){
  const f=fixture();
  await assert.rejects(prepareFutureGreenAssignmentOutbox(f.client,input(bad)));
  assert.equal(f.counters.writes,0);
  assert.equal(f.counters.transports,0);
 }
 const f=fixture();f.job.sender_account_id='9903183013';
 await assert.rejects(prepareFutureGreenAssignmentOutbox(f.client,input()),
  e=>e.code==='partial_interactive_origin_requires_review');
});
