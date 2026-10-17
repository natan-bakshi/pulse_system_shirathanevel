import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
const code=esbuild.transformSync(fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code;
function fixture({role='admin',enabled=true,paused=false,hasWork=true}={}){
 let handler;const control={id:'global',control_key:'global',enabled,paused};const updates=[];let dispatched=0;let sweeps=0;const wakeReasons=[];
 const client={
   auth:{me:async()=>role?{role}:null},
   asServiceRole:{entities:{
     WhatsAppQueueControl:{
       filter:async()=>[control],
       update:async(_id,patch)=>{updates.push(patch);Object.assign(control,patch);}
     },
     WhatsAppOutbox:{
       filter:async()=>hasWork?[{id:'job',status:'queued'}]:[]
     }
   }}
 };
 vm.runInNewContext(code,{
   exports:{},module:{exports:{}},console:{error:()=>{},warn:()=>{}},
   Deno:{serve:fn=>handler=fn},Response:{json:(body,{status=200}={})=>({status,body})},
   require:name=>{
     if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(name.endsWith('/assignmentIntentReconciler.ts'))return {
       sweepPendingSupplierAssignmentIntents:async()=>{sweeps++;return {success:true,reason:'feature_disabled'}}
     };
     if(name.endsWith('/whatsappQueueWorker.ts'))return {
       drainWhatsAppOutbox:async(_client,opts)=>{dispatched++;wakeReasons.push(opts?.wakeReason);return {success:true,reason:'processed',accepted:1}}
     };
     throw Error('Unexpected worker import: '+name);
   }
 });
 return {call:(payload={})=>handler({method:'POST',json:async()=>payload}),updates,wakeReasons,
   get dispatched(){return dispatched;},get sweeps(){return sweeps;}};
}
test('workflow wake reasons are attributed only as telemetry and unknown inputs are sanitized',async()=>{
 for(const reason of ['outbox_create','continue','watchdog']){
   const f=fixture();
   const response=await f.call({wakeReason:reason});
   assert.equal(response.status,200);
   assert.deepEqual(f.wakeReasons,[reason]);
 }
 const untrusted=fixture();
 await untrusted.call({wakeReason:'arbitrary_external_payload',recipient:'not-permitted'});
 assert.deepEqual(untrusted.wakeReasons,['unattributed']);
 for(const [filename,reason] of [
   ['WhatsApp Outbox Wake On Create.jsonc','outbox_create'],
   ['WhatsApp Outbox Continue Batch.jsonc','continue'],
   ['WhatsApp Outbox Watchdog 5min.jsonc','watchdog']
 ]){
   const file=JSON.parse(fs.readFileSync('base44/workflows/'+filename,'utf8'));
   assert.equal(file.definition.do[0].run_function.with.args.wakeReason,reason);
 }
});

test('background function rejects anonymous or non-admin calls before touching data',async()=>{
 for(const role of [null,'supplier','customer']){
   const f=fixture({role});
   const result=await f.call();
   assert.equal(result.status,403);
   assert.equal(f.updates.length,0);
   assert.equal(f.dispatched,0);
 }
});
test('disabled and paused background runs do zero entity writes and never send',async()=>{
 for(const options of [{enabled:false},{paused:true}]){
   const f=fixture(options);
   const result=await f.call();
   assert.equal(result.status,200);
   assert.equal(f.updates.length,0);
   assert.equal(f.dispatched,0);
 }
});
test('ONLY existing watchdog can request durable intent fallback, without a new scheduled job',async()=>{
 const a=fixture({hasWork:false});
 const b=fixture({hasWork:false});
 await a.call({wakeReason:'continue'});
 await b.call({wakeReason:'watchdog'});
 assert.equal(a.sweeps,0);
 assert.equal(b.sweeps,1);
 assert.equal(b.dispatched,0);
 assert.equal(b.updates.length,0);
});
test('idle active watchdog does not write entities or dispatch',async()=>{
 const f=fixture({hasWork:false});
 const r=await f.call();
 assert.equal(r.body.reason,'empty');
 assert.equal(f.updates.length,0);
 assert.equal(f.dispatched,0);
});
test('authenticated background worker records heartbeat only when there is queued work',async()=>{
 const f=fixture();
 const r=await f.call();
 assert.equal(r.status,200);
 assert.equal(f.dispatched,1);
 assert.ok(f.updates[0].last_invoked_at);
 assert.equal(f.updates[1].last_invocation_result,'processed');
});
