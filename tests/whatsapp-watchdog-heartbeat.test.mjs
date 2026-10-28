import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';

function context({actor={role:'admin'},enabled=true,paused=false,heartbeatFails=false}={}){
 const control={id:'control-global',control_key:'global',enabled,paused};
 const heartbeatWrites=[],workerCalls=[];
 const client={
   auth:{me:async()=>actor},
   asServiceRole:{entities:{
     WhatsAppQueueControl:{
       filter:async()=>[control],
       updateMany:async(query,patch)=>{
         if(heartbeatFails)throw new Error('Synthetic write failure');
         heartbeatWrites.push({query,patch});
         Object.assign(control,patch.$set);
         return {updated:1};
       },
       update:async()=>{throw Error('Should not write unrelated control update')}
     },
     WhatsAppOutbox:{
       filter:async()=>[]
     }
   }}
 };
 const code=esbuild.transformSync(fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
 }).code;
 let handler;
 vm.runInNewContext(code,{
  module:{exports:{}},exports:{},console:{log:()=>{},error:()=>{}},
  Deno:{serve:fn=>handler=fn,env:{get:()=>''}},
  Response:{json:(body,{status=200}={})=>({body,status})},
  require:name=>{
    if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
    if(name.endsWith('greenButtonQaScopedV2.ts'))return {greenButtonQaScopedV2Enabled:()=>false};
    if(name.endsWith('greenButtonQaLaunch.ts'))return {
      trustedGreenButtonQaConfig:()=>null
    };
    if(name.endsWith('whatsappQueueWorker.ts'))return {drainWhatsAppOutbox:async()=>{
      workerCalls.push('unexpected-dispatch');throw Error('No due messages');
    },reconcileCardSetupWhatsAppMirrors:async()=>({examined:0,repaired:0,failed:0}),
      reconcileAgreementWhatsAppMirrors:async()=>({examined:0,repaired:0,failed:0}),
      reconcileAcceptedWhatsAppMirrors:async()=>{
      workerCalls.push('mirror-repair-read');return {examined:0,repaired:0,failed:0};
    }};
    if(name.endsWith('whatsappUnknownReviewAlerts.ts'))return {
      alertUnknownWhatsAppOutcomes:async()=>{workerCalls.push('unknown-alert-read');return {examined:0,created:0,noMessagesSent:true}}
    };
    if(name.endsWith('cardSetupQueueReconciler.ts'))return {
      reconcileStalledCardSetupEnqueues:async()=>{workerCalls.push('stalled-card-read');return {examined:0}}
    };
    if(name.endsWith('agreementQueueReconciler.ts'))return {
      reconcileStalledAgreementEnqueues:async()=>{workerCalls.push('stalled-agreement-read');return {examined:0}}
    };
    if(name.endsWith('assignmentIntentReconciler.ts'))return {
      sweepPendingSupplierAssignmentIntents:async()=>{workerCalls.push('watchdog-intents');return {processed:0}}
    };
    throw Error('Unexpected require: '+name);
  }
 });
 return {
   call:async(wakeReason)=>handler({method:'POST',json:async()=>({wakeReason})}),
   control,heartbeatWrites,workerCalls
 };
}
test('empty watchdog records last authenticated heartbeat but never sends WhatsApp or wakes queue',async()=>{
 const x=context();
 const response=await x.call('watchdog');
 assert.equal(response.status,200);
 assert.equal(response.body.reason,'empty');
 assert.equal(x.heartbeatWrites.length,1);
 const change=x.heartbeatWrites[0];
 assert.deepEqual(Object.keys(change.patch.$set),['last_watchdog_at']);
 assert.equal(change.query.id,'control-global');
 assert.ok(Math.abs(Date.now()-Date.parse(x.control.last_watchdog_at))<3000);
 assert.equal(x.workerCalls.includes('unexpected-dispatch'),false);
});
test('watchdog still reports health while paused/disabled, without transport',async()=>{
 for(const flags of [{enabled:false,paused:false},{enabled:true,paused:true}]){
   const x=context(flags);
   const response=await x.call('watchdog');
   assert.equal(response.status,200);
   assert.equal(x.heartbeatWrites.length,1);
   assert.equal(x.workerCalls.length,0);
 }
});
test('unauthenticated watchdog cannot forge a fresh health heartbeat',async()=>{
 for(const actor of [null,{role:'supplier'}]){
   const x=context({actor});
   const response=await x.call('watchdog');
   assert.equal(response.status,403);
   assert.equal(x.heartbeatWrites.length,0);
 }
});
test('Outbox-create wake does not cause an extra heartbeat DB write',async()=>{
 const x=context();
 const response=await x.call('outbox_create');
 assert.equal(response.status,200);
 assert.equal(x.heartbeatWrites.length,0);
 assert.equal(x.workerCalls.length,0);
});
test('failed heartbeat cannot stop queued send pipeline or be reported as proof of health',async()=>{
 const x=context({heartbeatFails:true});
 const response=await x.call('watchdog');
 assert.equal(response.status,200);
 assert.equal(x.heartbeatWrites.length,0);
 assert.equal(x.control.last_watchdog_at,undefined);
});
