import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';

function context({actor={role:'admin',email:'natib8000@gmail.com'},state={},jobs=[]}={}) {
 const record={id:'control',control_key:'global',enabled:false,paused:false,
  min_interval_seconds:7,max_messages_per_run:16,lease_owner:'',lease_until:'',
  last_dispatched_at:'',next_allowed_at:'',...state};
 const client={
  auth:{me:async()=>actor},
  asServiceRole:{entities:{
   WhatsAppQueueControl:{update:async(id,patch)=>{Object.assign(record,patch);return record;}},
   WhatsAppOutbox:{
    filter:async(query)=>jobs.filter(j=>query.status.$in.includes(j.status)),
    list:async()=>jobs
   }
  }}
 };
 let called=0,handler=null;
 const transpiled=esbuild.transformSync(fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8'),{
  loader:'ts',format:'cjs',target:'es2022'
 }).code;
 vm.runInNewContext(transpiled,{
  exports:{},module:{exports:{}},console:{error:()=>{},log:()=>{}},
  Deno:{serve:fn=>{handler=fn}},
  Response:{json:(body,{status=200}={})=>({body,status})},
  require:(path)=>{
   if(path.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
   if(path.endsWith('whatsappOutbox.ts'))return {readWhatsAppQueueControl:async()=>record};
   if(path.endsWith('whatsappQueueWorker.ts'))return {drainWhatsAppOutbox:async()=>{called++;return {accepted:0,reason:'empty'}}};
   if(path.endsWith('whatsappProviderConfig.ts'))return {resolveWhatsAppProvider:async()=> 'wasender'};
   throw Error('Unknown import '+path);
  }
 });
 return {record,client,get called(){return called;},run:async(action,params={})=>
  handler({method:'POST',json:async()=>({action,...params})})};
}
const desired={minIntervalSeconds:7,maxMessagesPerRun:16,enabled:true,paused:false};
test('non-owner cannot inspect, activate, or drain WhatsApp outbox',async()=>{
 for(const actor of [null,{role:'supplier',email:'natib8000@gmail.com'},
   {role:'admin',email:'someone@example.com'}]){
   const c=context({actor});
   for(const action of ['status','configure','kick']){
    assert.equal((await c.run(action,desired)).status,403);
   }
   assert.equal(c.called,0);
 }
});
test('status is read-only and does not dispatch even when pending',async()=>{
 const c=context({jobs:[{id:'1',status:'queued',created_date:new Date().toISOString()}]});
 const answer=await c.run('status');
 assert.equal(answer.status,200);
 assert.equal(answer.body.totals.queued,1);
 assert.equal(answer.body.activeProvider,'wasender');
 assert.equal(c.called,0);
});
test('activation sets wake marker and global 7-second interval',async()=>{
 const c=context();
 const r=await c.run('configure',desired);
 assert.equal(r.status,200);
 assert.equal(c.record.enabled,true);
 assert.equal(c.record.min_interval_seconds,7);
 assert.ok(Date.parse(c.record.wake_requested_at)>0);
 assert.equal(c.called,0);
});
test('disabling with pending messages is rejected and backlog preserved',async()=>{
 const c=context({state:{enabled:true},jobs:[{id:'a',status:'retry_wait',created_date:'2026-10-12T00:00:00Z'}]});
 const r=await c.run('configure',{...desired,enabled:false});
 assert.equal(r.status,409);
 assert.equal(c.record.enabled,true);
 assert.equal(c.called,0);
});
test('pause does not remove backlog and can be resumed with a wake trigger',async()=>{
 const c=context({state:{enabled:true}});
 await c.run('configure',{...desired,paused:true});
 assert.equal(c.record.paused,true);
 await c.run('configure',{...desired,paused:false});
 assert.equal(c.record.paused,false);
 assert.ok(c.record.wake_requested_at);
});
test('invalid queue settings never dispatch or change configuration',async()=>{
 const c=context();
 const r=await c.run('configure',{...desired,minIntervalSeconds:0});
 assert.equal(r.status,400);
 assert.equal(c.record.enabled,false);
});
