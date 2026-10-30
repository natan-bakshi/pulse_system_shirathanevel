import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 normalizeInboundReceipt,registerVerifiedInboundReceipt,
 claimPendingInboundReceipt,finishInboundReceipt
} from '../base44/shared/whatsappInboundInbox.ts';
import {inboundReceiptDecision} from '../base44/shared/whatsappInteractiveReceipt.ts';

const message={
 provider:'green',senderAccountId:'green-instance-123',providerEventId:'receipt-event-1',
 providerMessageId:'original-provider-id',companyId:'shirat_hanevel',eventServiceId:'service-1',
 supplierId:'supplier-1',revision:'3',outboxJobId:'outbox-1',action:'assignment_approve'
};
function fixture(){
 const control={
  id:'global-queue-control',control_key:'global',enabled:true,paused:false,
  lease_owner:'outbound-worker',enqueue_owner:'outbound-enqueue',
  inbound_create_owner:'',inbound_create_until:'',inbound_guard_key:''
 };
 const records=[],events={creates:0,updates:0,guardWrites:0},messages=[];
 let createMode='ok',releaseFailure=false,filterMode='ok';
 let serial=0;
 const match=(row,query)=>Object.entries(query||{}).every(([key,value])=>{
  if(value&&typeof value==='object'&&'$in' in value)return value.$in.includes(row[key]);
  return (row[key]??null)===(value??null);
 });
 const controls={
  filter:async(query)=>match(control,query)?[control]:[],
  updateMany:async(query,change)=>{
   if(!match(control,query))return {updated:0};
   const patch=change.$set;
   if(releaseFailure&&patch.inbound_create_owner==='')throw Error('CAS release timed out');
   if('inbound_guard_key' in patch)events.guardWrites++;
   Object.assign(control,patch);events.updates++;
   return {updated:1};
  }
 };
 const db={
  filter:async(query)=>filterMode==='fail'?Promise.reject(Error('query unavailable')):
    records.filter(x=>match(x,query)),
  get:async(id)=>records.find(x=>x.id===id)||null,
  create:async(row)=>{
   events.creates++;
   if(createMode==='throw_before')throw Error('CREATE timed out before commit');
   const result={...row,id:'inbound-'+(++serial)};
   records.push(result);
   if(createMode==='throw_after')throw Error('CREATE response lost after commit');
   if(createMode==='invalid_response')return {id:'unverified'};
   return {...result};
  },
  updateMany:async(query,change)=>{
   let updated=0;
   for(const row of records)if(match(row,query)){
    Object.assign(row,change.$set);updated++;
   }
   return {updated};
  }
 };
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:controls,WhatsAppInboundReceipt:db,
  WhatsAppOutbox:{create:async()=>{messages.push('unexpected outbound call')}}
 }}};
 return {control,records,events,client,messages,
  setCreateMode:mode=>createMode=mode,
  setReleaseFailure:value=>releaseFailure=value,
  setFilterMode:mode=>filterMode=mode};
}
test('schema allows admin read-only audit; server service role exclusively writes durable receipts',()=>{
 const schema=JSON.parse(fs.readFileSync('base44/entities/WhatsAppInboundReceipt.jsonc','utf8'));
 assert.equal(schema.name,'WhatsAppInboundReceipt');
 assert.equal(schema.rls.read.user_condition.role,'admin');
 for(const a of ['create','update','delete'])
  assert.equal(schema.rls[a],false);
 for(const name of ['raw_body','message_text','phone','secret','webhook_payload','token','signature'])
  assert.equal(Object.hasOwn(schema.properties,name),false);
 assert.deepEqual(schema.properties.state.enum,
  ['pending','processing','applied','rejected','needs_review']);
});
test('normalized inbound identity requires fixed tenant, scoped provider and allowlisted actions',()=>{
 const one=normalizeInboundReceipt(message);
 const two=normalizeInboundReceipt({...message,senderAccountId:'another-account'});
 const three=normalizeInboundReceipt({...message,providerEventId:'event-2'});
 assert.notEqual(one.receiptKey,two.receiptKey);
 assert.notEqual(one.receiptKey,three.receiptKey);
 for(const mutation of [
  {companyId:'other'},{action:'contact_office'},{action:'delete_service'},
  {provider:'unknown'},{providerEventId:''},{providerMessageId:'\n'},
  {senderAccountId:'not\nvalid'}
 ])assert.throws(()=>normalizeInboundReceipt({...message,...mutation}));
});
test('verified registration creates only one durable receipt for identical event',async()=>{
 const f=fixture();
 const first=await registerVerifiedInboundReceipt(f.client,message);
 assert.equal(first.kind,'registered');assert.equal(first.processAllowed,true);
 const second=await registerVerifiedInboundReceipt(f.client,message);
 assert.equal(second.kind,'duplicate');assert.equal(second.processAllowed,false);
 assert.equal(first.id,second.id);
 assert.equal(f.events.creates,1);
 assert.equal(f.control.inbound_guard_key,'');
 assert.equal(f.control.inbound_create_owner,'');
 assert.equal(f.control.lease_owner,'outbound-worker');
 assert.equal(f.control.enqueue_owner,'outbound-enqueue');
 assert.equal(f.messages.length,0);
 assert.deepEqual(Object.keys(f.records[0]).filter(key=>/phone|secret|raw|body/.test(key)),[]);
});
test('concurrent callbacks serialize create, never duplicating same event',async()=>{
 const f=fixture();
 const results=await Promise.all(Array.from({length:8},
  ()=>registerVerifiedInboundReceipt(f.client,message)));
 assert.equal(results.filter(r=>r.kind==='registered').length,1);
 assert.equal(results.filter(r=>r.kind==='duplicate').length,7);
 assert.equal(f.records.length,1);
 assert.equal(f.events.creates,1);
});
test('provider event ID reused with different assignment/action is a conflict, not a new callback',async()=>{
 const f=fixture();
 await registerVerifiedInboundReceipt(f.client,message);
 for(const patch of [{action:'assignment_reject'},{supplierId:'other'},{revision:'4'},
  {outboxJobId:'outbox-2'},{providerMessageId:'other-receipt'}])
  await assert.rejects(registerVerifiedInboundReceipt(f.client,{...message,...patch}),
   e=>e.code==='receipt_identity_conflict');
 assert.equal(f.events.creates,1);
});
test('ambiguous CREATE AFTER commit retains the durable guard and blocks ANY new receipt',async()=>{
 const f=fixture();
 f.setCreateMode('throw_after');
 await assert.rejects(registerVerifiedInboundReceipt(f.client,message),/CREATE response lost/);
 assert.equal(f.records.length,1,'DB may have committed despite error');
 assert.equal(f.control.inbound_guard_key,normalizeInboundReceipt(message).receiptKey);
 assert.equal(f.control.inbound_create_owner,'');
 f.setCreateMode('ok');
 await assert.rejects(registerVerifiedInboundReceipt(f.client,message),
  e=>e.code==='inbound_registration_needs_manual_review');
 await assert.rejects(registerVerifiedInboundReceipt(f.client,{...message,providerEventId:'other-event'}),
  e=>e.code==='inbound_registration_needs_manual_review');
 assert.equal(f.events.creates,1,'NEVER repeat uncertain DB CREATE automatically');
 const result=await claimPendingInboundReceipt(f.client,{receiptId:f.records[0].id,
  receiptKey:normalizeInboundReceipt(message).receiptKey,claimOwner:'worker-1'});
 assert.equal(result.claimed,false);
 assert.equal(result.reason,'registration_needs_manual_review');
});
test('uncertain CREATE before commit still blocks future registration until reviewed',async()=>{
 const f=fixture();
 f.setCreateMode('throw_before');
 await assert.rejects(registerVerifiedInboundReceipt(f.client,message),/CREATE timed out/);
 assert.equal(f.records.length,0);
 assert.equal(f.control.inbound_guard_key,normalizeInboundReceipt(message).receiptKey);
 await assert.rejects(registerVerifiedInboundReceipt(f.client,message),
  e=>e.code==='inbound_registration_needs_manual_review');
});
test('ambiguous malformed receipt never clears pre-CREATE guard',async()=>{
 const f=fixture();
 f.setCreateMode('invalid_response');
 await assert.rejects(registerVerifiedInboundReceipt(f.client,message),
  e=>e.code==='inbound_create_receipt_unverified');
 assert.equal(f.control.inbound_guard_key,normalizeInboundReceipt(message).receiptKey);
});
test('read failures do not create messages or create guard',async()=>{
 const f=fixture();
 f.setFilterMode('fail');
 await assert.rejects(registerVerifiedInboundReceipt(f.client,message),/query unavailable/);
 assert.equal(f.events.creates,0);
 assert.equal(f.control.inbound_guard_key,'');
 assert.equal(f.control.inbound_create_owner,'');
});
test('CAS release uncertainty never returns confirmed registration',async()=>{
 const f=fixture();
 f.setReleaseFailure(true);
 await assert.rejects(registerVerifiedInboundReceipt(f.client,message),
  e=>e.code==='inbound_registration_release_unverified');
 assert.equal(f.records.length,1);
 assert.equal(f.control.inbound_guard_key,normalizeInboundReceipt(message).receiptKey);
});
test('pending receipt can be claimed once; duplicate workers lose CAS',async()=>{
 const f=fixture();
 const saved=await registerVerifiedInboundReceipt(f.client,message);
 const input={receiptId:saved.id,receiptKey:saved.receiptKey,claimOwner:'worker-1'};
 const claims=await Promise.all(Array.from({length:6},(_,i)=>
  claimPendingInboundReceipt(f.client,{...input,claimOwner:'worker-'+i})));
 assert.equal(claims.filter(r=>r.claimed).length,1);
 assert.equal(claims.filter(r=>!r.claimed).length,5);
 assert.equal(f.records[0].state,'processing');
 assert.equal(f.messages.length,0);
});
test('finish requires exact owner, unexpired lease, safe result and one terminal CAS',async()=>{
 const f=fixture();
 const saved=await registerVerifiedInboundReceipt(f.client,message);
 const at=Date.parse('2026-10-26T10:00:00Z');
 const owner='trusted-worker-1';
 const ctx={receiptId:saved.id,receiptKey:saved.receiptKey,claimOwner:owner,now:at+1000};
 assert.equal((await claimPendingInboundReceipt(f.client,{...ctx,now:at})).claimed,true);
 assert.equal((await finishInboundReceipt(f.client,{...ctx,claimOwner:'intruder',
  outcome:'applied',resultCode:'applied'})).finalized,false);
 await assert.rejects(finishInboundReceipt(f.client,{...ctx,
  outcome:'applied',resultCode:'arbitrary-function'}),e=>e.code==='invalid_receipt_finalization');
 assert.equal(f.records[0].state,'processing');
 const applied=await finishInboundReceipt(f.client,{...ctx,outcome:'applied',resultCode:'applied'});
 assert.equal(applied.finalized,true);
 assert.equal(f.records[0].state,'applied');
 const repeated=await finishInboundReceipt(f.client,{...ctx,outcome:'applied',resultCode:'applied'});
 assert.equal(repeated.finalized,false);
 assert.equal(f.records[0].result_code,'applied');
});
test('expired processing outcome goes to reconciliation, never autoclaim',async()=>{
 const f=fixture();
 const saved=await registerVerifiedInboundReceipt(f.client,message);
 const at=Date.parse('2026-10-26T10:00:00Z');
 const owner='trusted-worker-1';
 assert.equal((await claimPendingInboundReceipt(f.client,{
  receiptId:saved.id,receiptKey:saved.receiptKey,claimOwner:owner,now:at})).claimed,true);
 const expired=await claimPendingInboundReceipt(f.client,{
  receiptId:saved.id,receiptKey:saved.receiptKey,claimOwner:'worker-2',now:at+61000});
 assert.equal(expired.claimed,false);
 assert.equal(expired.reason,'expired_claim_outcome_unknown');
 const denied=await finishInboundReceipt(f.client,{
  receiptId:saved.id,receiptKey:saved.receiptKey,claimOwner:owner,
  outcome:'applied',resultCode:'applied',now:at+61000});
 assert.equal(denied.finalized,false);
 assert.equal(f.records[0].state,'processing');
 assert.deepEqual(inboundReceiptDecision({state:'needs_review'},at),
  {action:'reconcile',reason:'manual_review_required'});
});
