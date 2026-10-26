import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveVerifiedGreenInboundBudget} from '../base44/shared/whatsappInboundRateBudget.ts';

const at=Date.parse('2026-10-26T12:00:00Z');
function fixture(){
 const control={id:'control-123',control_key:'global',
  inbound_rate_window_started_at:'',inbound_rate_count:null};
 const stats={reads:0,writes:0},match=(target,filter)=>
  Object.entries(filter).every(([key,value])=>(target[key]??null)===(value??null));
 let timeout='none';
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{
   filter:async query=>{stats.reads++;return match(control,query)?[structuredClone(control)]:[];},
   updateMany:async(query,patch)=>{
    if(!match(control,query))return {updated:0};
    if(timeout==='before')throw Error('timeout precommit');
    Object.assign(control,patch.$set);stats.writes++;
    if(timeout==='after')throw Error('timeout after committed count');
    return {updated:1};
   }
  }
 }}};
 const reserve=(change={})=>reserveVerifiedGreenInboundBudget(client,{
  authenticated:true,trustedRolloutEnabled:true,now:at,maxPerMinute:30,...change
 });
 return {client,control,stats,reserve,fail:state=>timeout=state};
}
test('unauthenticated or disabled callback spends ZERO DB calls',async()=>{
 const x=fixture();
 for(const params of [{authenticated:false,trustedRolloutEnabled:true},
  {authenticated:true,trustedRolloutEnabled:false},
  {authenticated:undefined,trustedRolloutEnabled:undefined}]){
  const r=await reserveVerifiedGreenInboundBudget(x.client,params);
  assert.equal(r.allowed,false);
 }
 assert.deepEqual(x.stats,{reads:0,writes:0});
});
test('one control-row CAS reserves exactly 30 authenticated callbacks and then returns bounded backoff',async()=>{
 const x=fixture();
 for(let i=0;i<30;i++){
  const r=await x.reserve();
  assert.equal(r.allowed,true);
  assert.equal(r.reason,'reserved');
  assert.equal(r.databaseWrites,1);
 }
 const later=await x.reserve();
 assert.equal(later.allowed,false);
 assert.equal(later.reason,'rate_limited');
 assert.equal(later.retryAfterSeconds,60);
 assert.equal(x.control.inbound_rate_count,30);
 assert.equal(x.stats.writes,30);
 assert.equal(x.stats.reads,31);
});
test('a new minute starts a fresh window with no new cron workflow',async()=>{
 const x=fixture();
 for(let i=0;i<30;i++)await x.reserve();
 const next=await x.reserve({now:at+61_000});
 assert.equal(next.allowed,true);
 assert.equal(x.control.inbound_rate_count,1);
 assert.equal(x.control.inbound_rate_window_started_at,new Date(at+61_000).toISOString());
});
test('concurrent unrelated webhook callbacks cannot all claim the same last slot',async()=>{
 const x=fixture();
 x.control.inbound_rate_count=29;
 x.control.inbound_rate_window_started_at=new Date(at).toISOString();
 const outcomes=await Promise.all(Array.from({length:15},()=>x.reserve()));
 assert.equal(outcomes.filter(o=>o.allowed).length,1);
 assert.equal(outcomes.filter(o=>!o.allowed).length,14);
 assert.equal(x.control.inbound_rate_count,30);
 assert.equal(x.stats.writes,1);
});
test('ambiguous DB write conservatively blocks callback business mutation',async()=>{
 for(const mode of ['before','after']){
  const x=fixture();x.fail(mode);
  const result=await x.reserve();
  assert.equal(result.allowed,false);
  assert.equal(result.reason,'unavailable');
  assert.equal(x.stats.writes,mode==='after'?1:0);
 }
});
test('invalid time/count/configuration fails closed without resetting corrupted counters',async()=>{
 const x=fixture();
 for(const change of [{maxPerMinute:0},{maxPerMinute:601},{maxPerMinute:1.5},{now:NaN}]){
  const r=await x.reserve(change);assert.equal(r.allowed,false);
 }
 assert.deepEqual(x.stats,{reads:0,writes:0});
 x.control.inbound_rate_window_started_at=new Date(at).toISOString();
 x.control.inbound_rate_count=-1;
 const r=await x.reserve();
 assert.equal(r.allowed,false);
 assert.equal(x.stats.writes,0);
});
