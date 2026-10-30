import test from 'node:test';
import assert from 'node:assert/strict';
import {planDurableAssignmentEffectJournal,readAssignmentEffectJournal}
 from '../base44/shared/assignmentEffectJournal.ts';
import {
 claimNextStagedAssignmentEffect,finalizeStagedAssignmentEffect,
 processStagedAssignmentEffectBatch
} from '../base44/shared/assignmentEffectProcessor.ts';

const epoch=Date.parse('2026-10-30T05:00:00.000Z');
const source=()=>({
 id:'service-SAFE123',supplier_ids:'[]',supplier_statuses:'{}',
 supplier_notes:'{}',min_suppliers:1
});
const transition=()=>({
 supplier_ids:'["supplier-FIRST1","supplier-NEXT22"]',
 supplier_statuses:'{"supplier-FIRST1":"pending","supplier-NEXT22":"pending"}',
 supplier_notes:'{}'
});
function makeService(){
 const service=source();
 const journal=planDurableAssignmentEffectJournal(service,transition(),
  new Date(epoch).toISOString());
 return {...service,...journal.patch};
}
const clone=x=>JSON.parse(JSON.stringify(x));
function fakeDatabase({
 service=makeService(),throwsAfterWriteAt=[],failBeforeWriteAt=[],
 injectBeforeWriteAt={},afterReads
}={}){
 const row=clone(service);
 let reads=0,writes=0,confirmedWrites=0;
 const providerCalls=[],casQueries=[];
 const entity={
  async get(id){
   reads++;
   if(afterReads)await afterReads(reads,row);
   return id===row.id?clone(row):null;
  },
  async updateMany(query,{$set}){
   writes++;
   casQueries.push(clone(query));
   if(injectBeforeWriteAt[writes])await injectBeforeWriteAt[writes](row);
   if(failBeforeWriteAt.includes(writes))throw Error('DB unavailable before write');
   const match=query.id===row.id&&Object.entries(query).every(([field,val])=>
    row[field]===val);
   if(!match)return {updated:0};
   Object.assign(row,clone($set));
   if(throwsAfterWriteAt.includes(writes))throw Error('Simulated lost CAS ACK');
   confirmedWrites++;return {updated:1};
  }
 };
 return {client:{asServiceRole:{entities:{EventService:entity}}},
  row,providerCalls,casQueries,
  get reads(){return reads},get writes(){return writes},
  get confirmedWrites(){return confirmedWrites}
 };
}
const token=()=> 'claim-token-0123456789ABCDEF';
const receipt=task=>({outcome:'completed',
 receipt:{taskKey:task.key,receiptId:'receipt-VERIFIED-12345',verified:true}});
const tick=()=>epoch;
const adapters=()=>Object.fromEntries([
 'entity_update_notifications','event_status_readiness','google_calendar_sync',
 'supplier_assignment_push','supplier_pending_reminder',
 'assignment_removed_notifications','assignment_status_notifications'
].map(consumer=>[consumer,async({task})=>receipt(task)]));
const defaultOptions=(overrides={})=>({
 adapters:adapters(),
 preflight:async()=>({action:'run',reason:'latest_relevant_business_state'}),
 makeToken:token,now:tick,maxTasks:4,...overrides
});
const tasks=ctx=>readAssignmentEffectJournal(ctx.row.assignment_effects_journal);

test('one CAS claim precedes each adapter call; tasks become completed only with matching verified durable receipts',async()=>{
 const db=fakeDatabase(),seen=[];
 const consumerAdapters=adapters();
 for(const name of Object.keys(consumerAdapters)){
  consumerAdapters[name]=async({task,idempotencyKey,serviceId})=>{
   const claim=tasks(db).find(x=>x.key===idempotencyKey);
   assert.equal(claim.state,'claimed');
   assert.equal(serviceId,db.row.id);
   assert.ok(db.writes>=1);
   seen.push(idempotencyKey);
   return receipt(task);
  };
 }
 const result=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:consumerAdapters}));
 assert.equal(result.success,true);
 assert.equal(result.completed,4);
 assert.equal(result.processed,4);
 assert.equal(seen.length,4);
 assert.equal(new Set(seen).size,4);
 assert.ok(db.casQueries.every(q=>q.assignment_effects_pending===true&&
  typeof q.assignment_effects_journal==='string'));
 assert.ok(tasks(db).filter(t=>t.state==='completed').length===4);
 const first=tasks(db).find(t=>t.state==='completed');
 assert.equal(first.resultCode,'durable_receipt_verified');
 assert.equal(first.receiptId,'receipt-VERIFIED-12345');
 assert.ok(first.claimedAt&&first.finishedAt);
 const again=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:consumerAdapters}));
 assert.equal(again.completed,3);
 assert.equal(new Set(seen).size,7,'bounded batch continues to all seven unique tasks');
 assert.equal(db.row.assignment_effects_pending,false);
 assert.equal(tasks(db).every(t=>t.state==='completed'),true);
});
test('two concurrent workers never execute the same task or overwrite the CAS claim',async()=>{
 const db=fakeDatabase(),seen=[],a=adapters(),barrier=[];
 let release;
 const waiting=new Promise(resolve=>release=resolve);
 for(const key of Object.keys(a))a[key]=async({task})=>{
  seen.push(task.key);barrier.push(task.key);
  await waiting;return receipt(task);
 };
 const one=processStagedAssignmentEffectBatch(db.client,db.row.id,defaultOptions({
  adapters:a,maxTasks:1,makeToken:()=> 'claim-token-FIRST123456789'
 }));
 // First executor can be reached only after its CAS succeeded.
 for(let i=0;i<100&&!barrier.length;i++)await Promise.resolve();
 assert.equal(barrier.length,1);
 const two=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1,
   makeToken:()=> 'claim-token-SECOND123456789'}));
 assert.equal(two.reason,'busy');
 assert.equal(two.processed,0);
 release();
 const result=await one;
 assert.equal(result.completed,1);
 assert.equal(seen.length,1);
 assert.equal(tasks(db).filter(t=>t.state==='completed').length,1);
});
test('claim ACK lost after DB write prohibits executing any external adapter; expiry quarantines without replay',async()=>{
 const db=fakeDatabase({throwsAfterWriteAt:[1]}),seen=[];
 const a=adapters();for(const name of Object.keys(a)){
  a[name]=async({task})=>{seen.push(task.key);return receipt(task)};
 }
 const first=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1}));
 assert.equal(first.success,false);
 assert.equal(first.reason,'claim_uncertain');
 assert.equal(seen.length,0);
 assert.equal(tasks(db).filter(t=>t.state==='claimed').length,1);
 const immediate=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1}));
 assert.equal(immediate.reason,'busy');
 assert.equal(seen.length,0);
 const afterLease=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1,now:()=>epoch+6*60*1000}));
 assert.equal(afterLease.quarantined,1);
 assert.equal(seen.length,0);
 assert.equal(tasks(db).filter(t=>t.state==='unknown').length,1);
 assert.equal(tasks(db).find(t=>t.state==='unknown').resultCode,'claim_expired_unknown');
});
test('lost ACK on finalization re-reads completed receipt instead of re-sending provider request',async()=>{
 const db=fakeDatabase({throwsAfterWriteAt:[2]});
 let count=0;
 const a=adapters();
 for(const name of Object.keys(a))a[name]=async({task})=>{
  count++;return receipt(task);
 };
 const result=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1}));
 assert.equal(result.completed,1);
 assert.equal(result.success,true);
 assert.equal(count,1);
 assert.equal(tasks(db).filter(t=>t.state==='completed').length,1);
});
test('adapter exception AFTER possible remote delivery becomes UNKNOWN, never automatic retry',async()=>{
 const db=fakeDatabase(),calls=[];
 const a=adapters();
 for(const name of Object.keys(a))a[name]=async({task})=>{
  calls.push(task.key);throw Error('Remote accepted, response lost');
 };
 const result=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1}));
 assert.equal(result.unknown,1);
 assert.equal(tasks(db).find(t=>t.state==='unknown')?.resultCode,
  'execution_exception_unknown');
 const again=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1}));
 assert.equal(again.processed,1);
 assert.equal(calls.length,2);
 assert.notEqual(calls[0],calls[1], 'the uncertain task itself is never attempted again');
});
test('an unverified 2xx, mismatched source receipt or missing receipt never counts as completion',async()=>{
 for(const outcome of [
  {outcome:'completed'},
  {outcome:'completed',receipt:{taskKey:'assignment-effect:foreign',receiptId:'receipt-VERIFIED-12345',verified:true}},
  {outcome:'completed',receipt:{taskKey:'unused',receiptId:'receipt-VERIFIED-12345',verified:false}},
  {outcome:'garbage'}
 ]){
  const db=fakeDatabase();
  const a=adapters();for(const name of Object.keys(a))a[name]=async()=>outcome;
  const result=await processStagedAssignmentEffectBatch(db.client,db.row.id,
   defaultOptions({adapters:a,maxTasks:1}));
  assert.equal(result.unknown,1);
  assert.equal(result.completed,0);
  assert.equal(tasks(db).some(t=>t.state==='completed'),false);
 }
});
test('a superseded assignment is cancelled before adapter IO, despite a successful CAS claim',async()=>{
 const db=fakeDatabase();let called=0;
 const a=adapters();for(const key of Object.keys(a))a[key]=async()=>{called++;throw Error('adapter should not run')};
 const r=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1,
   preflight:async()=>({action:'cancel',reason:'superseded'})}));
 assert.equal(r.cancelled,1);
 assert.equal(called,0);
 assert.equal(tasks(db).find(t=>t.state==='cancelled').resultCode,'superseded');
});
test('missing business context leads to manual review with zero external calls',async()=>{
 const db=fakeDatabase();let called=0;
 const a=adapters();for(const key of Object.keys(a))a[key]=async()=>{called++;return null};
 const r=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1,
   preflight:async()=>({action:'review',reason:'consumer_not_ready'})}));
 assert.equal(r.manualReview,1);
 assert.equal(called,0);
 assert.equal(tasks(db).find(t=>t.state==='manual_review')?.resultCode,'consumer_not_ready');
});
test('preflight crashes or returns an unrecognized result; it never invokes the adapter',async()=>{
 for(const preflight of [async()=>{throw Error('DB unavailable')},async()=>({action:'evil'})]){
  const db=fakeDatabase();let called=0;
  const a=adapters();for(const name of Object.keys(a))a[name]=async()=>{called++;return null};
  const r=await processStagedAssignmentEffectBatch(db.client,db.row.id,
   defaultOptions({adapters:a,maxTasks:1,preflight}));
  assert.equal(r.unknown,1);
  assert.equal(called,0);
 }
});
test('missing preflight is a hard error before all DB reads or claims',async()=>{
 const db=fakeDatabase();const opts=defaultOptions();delete opts.preflight;
 await assert.rejects(processStagedAssignmentEffectBatch(db.client,db.row.id,opts));
 assert.equal(db.reads,0);assert.equal(db.writes,0);
});
test('unsupported consumer stops without claims, writes or external sends',async()=>{
 const db=fakeDatabase();
 const r=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:{}}));
 assert.equal(r.reason,'unhandled_consumer');
 assert.equal(r.processed,0);
 assert.equal(db.writes,0);
 assert.equal(tasks(db).every(x=>x.state==='planned'),true);
});
test('failing CAS before claim never dispatches side effects',async()=>{
 const db=fakeDatabase({failBeforeWriteAt:[1]});
 let called=false;
 const a=adapters();for(const consumer of Object.keys(a))
  a[consumer]=async()=>{called=true;return {outcome:'unknown',reason:'remote_outcome_uncertain'};};
 const r=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1}));
 assert.equal(r.reason,'claim_uncertain');
 assert.equal(r.processed,0);
 assert.equal(called,false);
 assert.ok(tasks(db).every(t=>t.state==='planned'));
});
test('invalid journal fails closed before ANY adapter or CAS claim',async()=>{
 const db=fakeDatabase();
 db.row.assignment_effects_journal='[invalid]';
 let calls=0;
 const a=adapters();for(const consumer of Object.keys(a))a[consumer]=async()=>{calls++;return null;};
 await assert.rejects(processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a})));
 assert.equal(db.writes,0);
 assert.equal(calls,0);
});
test('settle after concurrent appended generation uses bounded CAS read-retry, never repeats external action',async()=>{
 const db=fakeDatabase({injectBeforeWriteAt:{
  2:async row=>{
   // Simulates a concurrent save that appends a journal generation.
   const original=readAssignmentEffectJournal(row.assignment_effects_journal);
   const next={...original[0],
    key:original[0].key.replace(':r1:',':r2:'),
    revision:2,state:'planned',createdAt:new Date(epoch+1000).toISOString()};
   delete next.claimToken;delete next.claimedAt;delete next.finishedAt;
   delete next.resultCode;delete next.receiptId;
   row.assignment_effects_journal=JSON.stringify([...original,next]);
   row.assignment_effects_revision=2;
  }
 }});
 let count=0;
 const a=adapters();
 for(const consumer of Object.keys(a))a[consumer]=async({task})=>{count++;return receipt(task)};
 const result=await processStagedAssignmentEffectBatch(db.client,db.row.id,
  defaultOptions({adapters:a,maxTasks:1}));
 assert.equal(result.completed,1);
 assert.equal(count,1);
 assert.equal(tasks(db).filter(t=>t.state==='completed').length,1);
 assert.ok(tasks(db).some(t=>t.revision===2&&t.state==='planned'));
});
test('a stale claim is quarantined and leaves other tasks eligible, without requesting an old provider retry',async()=>{
 const db=fakeDatabase();
 const key=tasks(db)[0].key;
 const one=await claimNextStagedAssignmentEffect(db.client,db.row.id,
  adapters(),token(),epoch);
 assert.equal(one.status,'claimed');
 const stale=await claimNextStagedAssignmentEffect(db.client,db.row.id,
  adapters(),'claim-token-SECOND123456789',epoch+6*60*1000);
 assert.equal(stale.status,'expired_claim_quarantined');
 const old=tasks(db).find(t=>t.key===key);
 assert.equal(old.state,'unknown');
 const late=await finalizeStagedAssignmentEffect(db.client,db.row.id,one.task,
  {state:'completed',resultCode:'durable_receipt_verified',receiptId:'receipt-VERIFIED-12345'},
  epoch+6*60*1000);
 assert.equal(late.status,'changed_claim','late executor cannot overwrite UNKNOWN quarantine');
 const next=await claimNextStagedAssignmentEffect(db.client,db.row.id,
  adapters(),'claim-token-THIRD123456789',epoch+6*60*1000);
 assert.equal(next.status,'claimed');
 assert.notEqual(next.task.key,key);
});
test('no pending state leads to zero database reads, writes or external calls',async()=>{
 const db=fakeDatabase();db.row.assignment_effects_pending=false;
 const r=await processStagedAssignmentEffectBatch(db.client,db.row.id,defaultOptions());
 assert.equal(r.reason,'empty');
 assert.equal(db.writes,0);
});
