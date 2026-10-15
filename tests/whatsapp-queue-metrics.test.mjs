import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {readOutboxTiming,summarizeMillis,summarizeWhatsAppOutbox} from '../base44/shared/whatsappQueueMetrics.ts';

const stamp=(mins=0)=>new Date(Date.UTC(2026,9,15,8,0)+mins*60000).toISOString();
const sample=(id,status='accepted',fields={})=>({
  id,status,created_date:stamp(),available_at:stamp(),send_started_at:stamp(1),
  completed_at:stamp(2),attempt_count:1,provider:'green',
  message_text:'Private message must not be exposed',
  chat_id:'972501234567@c.us',...fields
});

test('scheduled quiet-hours wait is not measured as queue delay',()=>{
  const s=readOutboxTiming(sample('late','accepted',{
    available_at:stamp(60),send_started_at:stamp(61),completed_at:stamp(62)
  }));
  assert.equal(s.deferredMs,3600000);
  assert.equal(s.queueWaitMs,60000);
  assert.equal(s.providerWaitMs,60000);
  assert.equal(s.afterDueMs,120000);
});
test('p50, p95 use real attempts only and never fabricate missing timestamps',()=>{
  const jobs=[
    sample('a','accepted',{send_started_at:stamp(0),completed_at:stamp(1)}),
    sample('b','accepted',{send_started_at:stamp(2),completed_at:stamp(3)}),
    sample('c','unknown',{send_started_at:'',completed_at:stamp(5),provider:'wasender'}),
    sample('d','queued',{attempt_count:0,send_started_at:'',completed_at:'',available_at:stamp(50)}),
    sample('e','queued',{attempt_count:0,send_started_at:'',completed_at:''}),
    sample('f','cancelled',{attempt_count:0,send_started_at:'',completed_at:''})
  ];
  const result=summarizeWhatsAppOutbox(jobs,stamp(5));
  assert.equal(result.sampled,6);
  assert.equal(result.unknownCount,1);
  assert.equal(result.dueStillQueued,1);
  assert.equal(result.scheduledForFuture,1);
  assert.equal(result.missingAttemptTimestamp,1);
  assert.equal(result.timings.queueWait.count,2);
  assert.equal(result.timings.queueWait.p50Ms,0);
  assert.equal(result.timings.queueWait.p95Ms,120000);
  assert.equal(result.timings.providerProcessing.count,2);
  assert.equal(result.byProvider.green.count,2);
  assert.equal(result.byProvider.wasender.count,1);
  assert.equal(result.byProvider.wasender.providerProcessing.count,0);
  assert.equal(result.providerAcceptanceIsNotDelivery,true);
  assert.equal(JSON.stringify(result).includes('Private message'),false);
  assert.equal(JSON.stringify(result).includes('972501234567'),false);
});
test('invalid, reversed and absent dates do not count as real timing measurements',()=>{
  const s=readOutboxTiming(sample('a','unknown',{
    created_date:'not-a-date',available_at:'',send_started_at:stamp(1),completed_at:stamp(0)
  }));
  assert.equal(s.queueWaitMs,null);
  assert.equal(s.providerWaitMs,null);
  assert.equal(s.totalMs,null);
  assert.deepEqual(summarizeMillis([]),{count:0,p50Ms:null,p95Ms:null,maxMs:null});
});
test('metrics endpoint is read-only and accessible only to the system owner',async()=>{
  const src=esbuild.transformSync(fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8'),{
    loader:'ts',format:'cjs',target:'es2022'
  }).code;
  for(const actor of [null,{role:'supplier',email:'natib8000@gmail.com'},
    {role:'admin',email:'other@example.com'},{role:'admin',email:'natib8000@gmail.com'}]){
    let handler,transportCalls=0,readCount=0;
    const jobs=[sample('a')];
    const client={
      auth:{me:async()=>actor},
      asServiceRole:{entities:{
        WhatsAppQueueControl:{update:async()=>{throw Error('Unexpected write')}},
        WhatsAppOutbox:{
          list:async()=>{readCount++;return jobs;},
          updateMany:async()=>{throw Error('Unexpected job mutation')}
        }
      }}
    };
    const module={exports:{}};
    vm.runInNewContext(src,{
      module,exports:module.exports,console:{error:()=>{},log:()=>{}},
      Deno:{serve:fn=>handler=fn},Response:{json:(body,{status=200}={})=>({body,status})},
      require:name=>{
        if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
        if(name.endsWith('whatsappOutbox.ts'))return {readWhatsAppQueueControl:async()=>({})};
        if(name.endsWith('whatsappQueueWorker.ts'))return {
          drainWhatsAppOutbox:async()=>{transportCalls++;throw Error('Must not dispatch')},
          delayUntilNextSendMs:()=>0,providerIntervalMs:()=>0,syncWhatsAppStatus:async()=>{}
        };
        if(name.endsWith('whatsappProviderConfig.ts'))return {resolveWhatsAppProvider:async()=> 'green'};
        if(name.endsWith('whatsappQueueMetrics.ts'))return {summarizeWhatsAppOutbox};
        throw Error('Unexpected module '+name);
      }
    });
    const res=await handler({method:'POST',json:async()=>({action:'metrics'})});
    if(actor?.email==='natib8000@gmail.com'&&actor.role==='admin'){
      assert.equal(res.status,200);
      assert.equal(res.body.metrics.sampled,1);
      assert.equal(readCount,1);
      assert.equal(JSON.stringify(res.body).includes('Private message'),false);
    }else{
      assert.equal(res.status,403);
      assert.equal(readCount,0);
    }
    assert.equal(transportCalls,0);
  }
});
