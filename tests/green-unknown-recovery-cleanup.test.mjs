import test from 'node:test';
import assert from 'node:assert/strict';
import {scrubExpiredUnknownGreenRecoveryOnDemand}
 from '../base44/shared/greenUnknownRecoveryCleanup.ts';
import {decryptUnknownGreenRecovery}
 from '../base44/shared/greenUnknownRecoveryEnvelope.ts';
const NOW=Date.parse('2026-10-27T08:00:00Z');
const expired=new Date(NOW-1000).toISOString();
const future=new Date(NOW+3600000).toISOString();
const row=(id,expiry=expired)=>({
 id,provider:'green',company_id:'shirat_hanevel',
 recovery_status:'encrypted',recovery_version:'aes256gcm-v1',
 recovery_key_id:'v1-green-recovery',recovery_nonce:'AAAABBBBCCCCDDDDEEEE',
 recovery_ciphertext:'0123456789abcdef0123456789abcdef',recovery_expires_at:expiry
});
const match=(record,filter)=>Object.entries(filter).every(([k,v])=>record[k]===v);
function fixture(records,options={}){
 const counts={reads:0,writes:0,gets:0};
 const db={
  filter:async(q,_sort,limit,_offset,fields)=>{
   counts.reads++;
   return records.filter(r=>match(r,q)).slice(0,limit)
    .map(r=>Object.fromEntries(fields.map(k=>[k,r[k]])));
  },
  get:async id=>{counts.gets++;if(options.failRead)throw Error('read failure');
   return records.find(r=>r.id===id)||null;},
  updateMany:async(q,patch)=>{
   counts.writes++;
   const target=records.find(r=>match(r,q));
   if(!target)return {updated:0};
   if(!options.noCommit)Object.assign(target,patch.$set);
   if(options.failWrite)throw Error('ambiguous SDK timeout');
   return {updated:options.noCommit?0:1};
  }
 };
 return {db,counts,records,client:{asServiceRole:{entities:{
  WhatsAppInboundQuarantine:db,
  EventService:{updateMany:()=>{throw Error('Never mutate supplier')}}
 }}}};
}
test('manual scrub removes ONLY expired encrypted fields, preserving metadata and nonexpired recovery',async()=>{
 const a=row('expired'),b=row('future',future);
 a.quarantine_key='gq1_test_hash';a.payload_mac='safe';
 const f=fixture([a,b]);
 const report=await scrubExpiredUnknownGreenRecoveryOnDemand(f.client,{now:NOW});
 assert.equal(report.scanned,2);
 assert.equal(report.expiredCandidates,1);
 assert.equal(report.scrubbed,1);
 assert.equal(report.unverified,0);
 assert.equal(report.incomplete,false);
 assert.equal(report.retentionAutomaticallyEnforced,false);
 assert.equal(report.backupPhysicalErasureNotVerified,true);
 assert.equal(report.noProviderCalls,true);
 assert.equal(f.counts.reads,1);
 assert.equal(f.counts.writes,1);
 assert.equal(a.recovery_status,'erased');
 assert.equal(a.recovery_ciphertext,'');
 assert.equal(a.recovery_nonce,'');
 assert.equal(a.recovery_key_id,'');
 assert.equal(a.quarantine_key,'gq1_test_hash');
 assert.equal(a.payload_mac,'safe');
 assert.equal(b.recovery_status,'encrypted');
 assert.equal(b.recovery_ciphertext,'0123456789abcdef0123456789abcdef');
 assert.equal(b.recovery_key_id,'v1-green-recovery');
});
test('second owner click is idempotent and never writes an already-scrubbed record',async()=>{
 const f=fixture([row('exp')]);
 assert.equal((await scrubExpiredUnknownGreenRecoveryOnDemand(f.client,{now:NOW})).scrubbed,1);
 const second=await scrubExpiredUnknownGreenRecoveryOnDemand(f.client,{now:NOW});
 assert.equal(second.scrubbed,0);
 assert.equal(second.scanned,0);
 assert.equal(f.counts.writes,1);
});
test('expired row with corrupt expiry or ciphertext is reported unresolved, not erased',async()=>{
 const rows=[row('bad1','bad date'),row('bad2')];
 rows[1].recovery_ciphertext='';
 const f=fixture(rows);
 const result=await scrubExpiredUnknownGreenRecoveryOnDemand(f.client,{now:NOW});
 assert.equal(result.unverified,2);
 assert.equal(result.scrubbed,0);
 assert.equal(f.counts.writes,0);
 assert.equal(result.incomplete,true);
});
test('CAS fails closed on concurrent nonce changes, with no overwriting another worker',async()=>{
 const a=row('exp');
 const f=fixture([a]);
 f.db.updateMany=async query=>{
  f.counts.writes++;
  a.recovery_nonce='NEW_AUTHENTICATED_VALUE';
  assert.notEqual(query.recovery_nonce,a.recovery_nonce);
  return {updated:0};
 };
 const result=await scrubExpiredUnknownGreenRecoveryOnDemand(f.client,{now:NOW});
 assert.equal(result.scrubbed,0);
 assert.equal(result.unverified,1);
 assert.equal(a.recovery_status,'encrypted');
});
test('ambiguous timeout after commit is NOT reported as confirmed erasure, never retried',async()=>{
 const a=row('exp'),f=fixture([a],{failWrite:true});
 const result=await scrubExpiredUnknownGreenRecoveryOnDemand(f.client,{now:NOW});
 assert.equal(result.scrubbed,0);
 assert.equal(result.unverified,1);
 assert.equal(f.counts.writes,1);
 assert.equal(a.recovery_status,'erased');
 assert.equal(result.incomplete,true);
});
test('owner read failure after successful database write does not claim verified success',async()=>{
 const a=row('exp'),f=fixture([a],{failRead:true});
 const result=await scrubExpiredUnknownGreenRecoveryOnDemand(f.client,{now:NOW});
 assert.equal(result.scrubbed,0);
 assert.equal(result.unverified,1);
 assert.equal(f.counts.writes,1);
});
test('bounded audit scans 20 oldest only, returns no payloads or identifiers',async()=>{
 const rows=Array.from({length:23},(_,n)=>row('private-'+n));
 const f=fixture(rows);
 const result=await scrubExpiredUnknownGreenRecoveryOnDemand(f.client,{now:NOW});
 assert.equal(result.scanned,20);
 assert.equal(result.scrubbed,20);
 assert.equal(result.moreMayRemain,true);
 assert.equal(result.incomplete,true);
 assert.equal(f.counts.writes,20);
 assert.equal(rows[20].recovery_status,'encrypted');
 assert.equal(JSON.stringify(result).includes('private-'),false);
});
test('no DB or invalid now fails closed, no network and no provider call',async()=>{
 await assert.rejects(scrubExpiredUnknownGreenRecoveryOnDemand({},{now:NOW}),
  err=>err.code==='unknown_recovery_cleanup_unavailable');
 const f=fixture([row('test')]);
 await assert.rejects(scrubExpiredUnknownGreenRecoveryOnDemand(f.client,{now:NaN}));
 assert.equal(f.counts.reads,0);
 assert.equal(f.counts.writes,0);
});
