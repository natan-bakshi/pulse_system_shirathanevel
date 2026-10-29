import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
const code=esbuild.transformSync(fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code;
function fixture({role='admin',enabled=true,paused=false,hasWork=true,telemetryFailAt='',
  betaProbe=false,probeEnvOverrides={}}={}){
 let handler;const control={id:'global',control_key:'global',enabled,paused,
  interactive_outbound_live_enabled:betaProbe};
 const updates=[];let dispatched=0;let sweeps=0;const wakeReasons=[];
 let qaConfigUsed=0,qaSettingsReads=0;
 const qaEnv=betaProbe?{
  GREEN_BUTTONS_QA_SEND_ENABLED:'enabled',
  GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',
  GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'probe_authorized',
  GREEN_BUTTONS_QA_BETA_PROBE_ENABLED:'enabled',
  GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:'enabled',
  GREEN_BUTTONS_QA_OWNER_APPROVED:'approved'
 }:{};
 const client={
   auth:{me:async()=>role?{role}:null},
   asServiceRole:{entities:{
     AppSettings:{filter:async()=>{qaSettingsReads++;return[]}},
     WhatsAppQueueControl:{
       filter:async()=>[control],
       update:async(_id,patch)=>{
         if(telemetryFailAt==='all' || telemetryFailAt==='before'&&patch.last_invoked_at ||
           telemetryFailAt==='after'&&patch.last_invocation_result)
           throw Error('Synthetic noncritical metrics write outage');
         updates.push(patch);Object.assign(control,patch);
       }
     },
     WhatsAppOutbox:{
       filter:async()=>hasWork?[{id:'job',status:'queued'}]:[]
     }
   }}
 };
 vm.runInNewContext(code,{
   exports:{},module:{exports:{}},console:{error:()=>{},warn:()=>{}},
   Deno:{serve:fn=>handler=fn,env:{get:key=>({...qaEnv,...probeEnvOverrides})[key]||''}},Response:{json:(body,{status=200}={})=>({status,body})},
   require:name=>{
     if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(name.endsWith('/assignmentIntentReconciler.ts'))return {
       sweepPendingSupplierAssignmentIntents:async()=>{sweeps++;return {success:true,reason:'feature_disabled'}}
     };
     if(name.endsWith('/whatsappUnknownReviewAlerts.ts'))return {
       alertUnknownWhatsAppOutcomes:async()=>({examined:0,created:0,noMessagesSent:true})
     };
     if(name.endsWith('/cardSetupQueueReconciler.ts'))return {
       reconcileStalledCardSetupEnqueues:async()=>({examined:0,linked:0,unverified:0,alerts:0,errors:0})
     };
     if(name.endsWith('/agreementQueueReconciler.ts'))return {
       reconcileStalledAgreementEnqueues:async()=>({examined:0,linked:0,unverified:0,alerts:0,errors:0})
     };
     if(name.endsWith('/greenButtonQaScopedV2.ts'))return {greenButtonQaScopedV2Enabled:()=>betaProbe};
     if(name.endsWith('/greenButtonQaLaunch.ts'))return {
       trustedGreenButtonQaConfig:()=>betaProbe?{
        enabled:true,accountCapabilityVerified:false,qaBetaProbeApproved:true,
        qaChatId:'972501234567@c.us',qaEventServiceId:'qa-test-service',
        qaSupplierId:'qa-test-supplier'
       }:null
     };
     if(name.endsWith('/whatsappQueueWorker.ts'))return {
       reconcileAcceptedWhatsAppMirrors:async()=>({examined:0,repaired:0,failed:0}),
       reconcileAgreementWhatsAppMirrors:async()=>({examined:0,repaired:0,failed:0}),
       reconcileCardSetupWhatsAppMirrors:async()=>({examined:0,repaired:0,failed:0}),
       drainWhatsAppOutbox:async(_client,opts)=>{
        dispatched++;if(opts?.interactiveConfig)qaConfigUsed++;
        wakeReasons.push(opts?.wakeReason);
        return {success:true,reason:'processed',accepted:1}
       }
     };
     throw Error('Unexpected worker import: '+name);
   }
 });
 return {call:(payload={})=>handler({method:'POST',json:async()=>payload}),updates,wakeReasons,
   get dispatched(){return dispatched;},get sweeps(){return sweeps;},
   get qaConfigUsed(){return qaConfigUsed;},get qaSettingsReads(){return qaSettingsReads;}};
}
test('real worker wrapper passes interactive config for explicitly approved ONE Beta probe, not ordinary traffic',async()=>{
 const f=fixture({betaProbe:true});
 const r=await f.call({wakeReason:'outbox_create'});
 assert.equal(r.status,200);
 assert.equal(f.qaConfigUsed,1);
 assert.equal(f.qaSettingsReads,1);
 const blocked=fixture({betaProbe:true,probeEnvOverrides:{
  GREEN_BUTTONS_QA_BETA_PROBE_ENABLED:''
 }});
 const missing=await blocked.call({wakeReason:'outbox_create'});
 assert.equal(missing.status,200);
 assert.equal(blocked.qaConfigUsed,0);
 assert.equal(blocked.qaSettingsReads,0);
 const noAccount=fixture({betaProbe:true,probeEnvOverrides:{
  GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'unverified'
 }});
 await noAccount.call({wakeReason:'outbox_create'});
 assert.equal(noAccount.qaConfigUsed,0);
 assert.equal(noAccount.qaSettingsReads,0);
});
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
test('failed invocation telemetry never suppresses a queued WhatsApp dispatch',async()=>{
 const x=fixture({telemetryFailAt:'before'});
 const result=await x.call({wakeReason:'outbox_create'});
 assert.equal(result.status,200);
 assert.equal(result.body.accepted,1);
 assert.equal(x.dispatched,1);
 assert.deepEqual(x.wakeReasons,['outbox_create']);
 assert.equal(x.updates.length,1,'Only successful after-dispatch telemetry is saved');
});

test('failed result telemetry after dispatch never converts provider success to endpoint failure',async()=>{
 const x=fixture({telemetryFailAt:'after'});
 const result=await x.call({wakeReason:'continue'});
 assert.equal(result.status,200);
 assert.equal(result.body.accepted,1);
 assert.equal(x.dispatched,1);
 assert.equal(x.updates.length,1);
 assert.ok(x.updates[0].last_invoked_at);
});

test('failed telemetry before AND after dispatch cannot create a false HTTP 500',async()=>{
 const x=fixture({telemetryFailAt:'all'});
 const result=await x.call({wakeReason:'outbox_create'});
 assert.equal(result.status,200);
 assert.equal(x.dispatched,1);
 assert.equal(x.updates.length,0);
});

test('authenticated background worker records heartbeat only when there is queued work',async()=>{
 const f=fixture();
 const r=await f.call();
 assert.equal(r.status,200);
 assert.equal(f.dispatched,1);
 assert.ok(f.updates[0].last_invoked_at);
 assert.equal(f.updates[1].last_invocation_result,'processed');
});
