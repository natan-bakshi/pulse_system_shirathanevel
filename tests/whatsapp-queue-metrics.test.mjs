import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {readOutboxTiming,summarizeMillis,summarizeWhatsAppOutbox} from '../base44/shared/whatsappQueueMetrics.ts';
import {summarizeWhatsAppSourceAudit,summarizePendingWhatsAppAudit} from '../base44/shared/whatsappSourceAudit.ts';

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
test('read-only latency diagnostics isolate five-minute scheduled fanout tails by source',()=>{
 const jobs=[
  sample('fanout-1','accepted',{source_type:'scheduled_fanout',
   send_started_at:'2026-10-15T08:05:00.000Z',
   transport_started_at:'2026-10-15T08:05:00.000Z',
   transport_finished_at:'2026-10-15T08:05:00.400Z',
   completed_at:'2026-10-15T08:05:00.700Z'}),
  sample('fanout-2','accepted',{source_type:'scheduled_fanout',
   send_started_at:'2026-10-15T08:05:01.000Z',
   transport_started_at:'2026-10-15T08:05:01.000Z',
   transport_finished_at:'2026-10-15T08:05:01.350Z',
   completed_at:'2026-10-15T08:05:01.700Z'}),
  sample('assignment-1','accepted',{source_type:'assignment_new',
   send_started_at:'2026-10-15T08:00:02.000Z',
   transport_started_at:'2026-10-15T08:00:02.000Z',
   transport_finished_at:'2026-10-15T08:00:02.450Z',
   completed_at:'2026-10-15T08:00:02.700Z'}),
  sample('queued','queued',{source_type:'scheduled_fanout',
   attempt_count:0,send_started_at:'',completed_at:''}),
  sample('invalid','unknown',{source_type:'private@972501234567',
   send_started_at:'',completed_at:stamp(5)})
 ];
 const m=summarizeWhatsAppOutbox(jobs,stamp(10));
 assert.equal(m.bySource.scheduled_fanout.count,2);
 assert.equal(m.bySource.scheduled_fanout.queueWait.p50Ms,300000);
 assert.equal(m.bySource.scheduled_fanout.afterDue.p95Ms,301700);
 assert.equal(m.bySource.scheduled_fanout.transportDuration.p50Ms,350);
 assert.equal(m.bySource.assignment_new.count,1);
 assert.equal(m.bySource.assignment_new.queueWait.p50Ms,2000);
 assert.equal(m.bySource.assignment_new.transportDuration.p50Ms,450);
 assert.equal(m.bySource.unattributed.count,1);
 assert.equal(JSON.stringify(m).includes('private@9725'),false);
 assert.equal(JSON.stringify(m).includes('Private message'),false);
 assert.equal(m.providerAcceptanceIsNotDelivery,true);
});
test('admin latency panel groups sources from existing projected read and is collapsed by default',()=>{
 const backend=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 assert.match(backend,/const TIMING_FIELDS=[\s\S]*?'source_type'\]/);
 assert.match(ui,/Object.entries\(metrics.bySource\|\|\{\}\)/);
 assert.match(ui,/פירוט זמני התור לפי סוג הודעה/);
 assert.match(ui,/<details className="border rounded p-2">/);
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
test('detailed breakdown distinguishes queue backlog, provider pacing, worker lag and actual transport duration',()=>{
 const record=sample('instrumented','accepted',{
   created_date:stamp(0),
   available_at:stamp(1),
   prior_dispatch_at:stamp(2),
   configured_interval_ms:3000,
   rate_ready_at:'2026-10-15T08:02:03.000Z',
   job_claimed_at:'2026-10-15T08:02:05.000Z',
   send_started_at:'2026-10-15T08:02:05.000Z',
   transport_started_at:'2026-10-15T08:02:05.050Z',
   transport_finished_at:'2026-10-15T08:02:05.500Z',
   completed_at:'2026-10-15T08:02:05.900Z',
   worker_run_id:'run-1',worker_wake_reason:'continue'
 });
 const s=readOutboxTiming(record);
 assert.equal(s.backlogWaitMs,60000,'One minute waiting for older queued messages');
 assert.equal(s.spacingWaitMs,3000,'Configured Green provider gap');
 assert.equal(s.workerLagMs,2000,'Worker resumed two seconds after message was rate eligible');
 assert.equal(s.claimToTransportMs,50);
 assert.equal(s.transportDurationMs,450);
 assert.equal(s.persistenceMs,400);
 assert.equal(s.queueWaitMs,65000);
 assert.equal(s.backlogWaitMs+s.spacingWaitMs+s.workerLagMs,s.queueWaitMs);
 assert.equal(s.hasDetailedTiming,true);
 const aggregated=summarizeWhatsAppOutbox([record],stamp(3));
 assert.equal(aggregated.detailedTimingCount,1);
 assert.equal(aggregated.byWakeReason.continue,1);
 assert.equal(aggregated.timings.transportDuration.p50Ms,450);
 assert.equal(aggregated.byProvider.green.transportDuration.p50Ms,450);
 assert.equal(JSON.stringify(aggregated).includes('run-1'),false,'No worker run tokens leaked in aggregated report');
});
test('no preceding dispatch means no pacing wait; the worker can act on an idle queue immediately',()=>{
 const s=readOutboxTiming(sample('fresh','accepted',{
   created_date:stamp(0),available_at:stamp(1),prior_dispatch_at:'',
   configured_interval_ms:7000,rate_ready_at:stamp(1),
   job_claimed_at:'2026-10-15T08:01:00.100Z',
   send_started_at:'2026-10-15T08:01:00.100Z',
   transport_started_at:'2026-10-15T08:01:00.110Z',
   transport_finished_at:'2026-10-15T08:01:00.160Z',
   completed_at:'2026-10-15T08:01:00.180Z'
 }));
 assert.equal(s.backlogWaitMs,0);
 assert.equal(s.spacingWaitMs,0);
 assert.equal(s.workerLagMs,100);
 assert.equal(s.transportDurationMs,50);
});
test('legacy jobs without new instrumentation remain measurable only at old granularity',()=>{
 const s=readOutboxTiming(sample('old'));
 assert.equal(s.hasDetailedTiming,false);
 assert.equal(s.workerLagMs,null);
 assert.equal(s.transportDurationMs,null);
 assert.equal(s.spacingWaitMs,null);
 const agg=summarizeWhatsAppOutbox([sample('old')],stamp(10));
 assert.equal(agg.detailedTimingCount,0);
 assert.equal(agg.timings.workerLag.count,0);
 assert.equal(agg.timings.queueWait.count,1);
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
        if(name.endsWith('whatsappInteractiveSettingsStore.ts'))return {
          readSavedWhatsAppInteractivePolicy:async()=>{throw Error('Metrics cannot read interactive settings')},
          saveWhatsAppInteractivePolicyDraft:async()=>{throw Error('Metrics cannot write interactive settings')}
        };
        if(name.endsWith('whatsappQueueMetrics.ts'))return {summarizeWhatsAppOutbox};
        if(name.endsWith('whatsappInboundAudit.ts'))return {
          summarizeInboundWhatsAppReceipts:()=>{throw Error('Metrics must not touch inbound receipt audit')}
        };
        if(name.endsWith('whatsappInboundInvestigation.ts'))return {
          inspectInboundReceiptReadOnly:()=>{throw Error('Metrics must not touch receipt investigation')}
        };
        if(name.endsWith('whatsappInteractiveReadiness.ts'))return {
          inspectGreenInteractiveReadinessReadOnly:()=>{throw Error('Metrics must not read interactive readiness')}
        };
        if(name.endsWith('whatsappOfficeReferenceLookup.ts'))return {
          inspectOfficeAssignmentReference:()=>{throw Error('Metrics must not perform office lookup')}
        };
        if(name.endsWith('greenWebhookSettingsAudit.ts'))return {
          inspectGreenWebhookSettingsReadOnly:()=>{throw Error('Metrics must not contact Green API')}
        };
        if(name.endsWith('greenUnknownCallbackQuarantine.ts'))return {
          inspectUnknownGreenQuarantineReadOnly:()=>{throw Error('Metrics must not load unknown callback quarantine')}
        };
        if(name.endsWith('greenUnknownRecoveryCleanup.ts'))return {
          scrubExpiredUnknownGreenRecoveryOnDemand:()=>{throw Error('Metrics must never redact recovery records')}
        };
        if(name.endsWith('greenUnknownRecoveryReview.ts'))return {
          inspectUnknownGreenRecoveryStructureReadOnly:()=>{throw Error('Metrics must never decrypt unknown callbacks')}
        };
        if(name.endsWith('greenButtonQaScopedV2.ts'))return {greenButtonQaScopedV2Enabled:()=>false};
        if(name.endsWith('greenButtonQaLaunch.ts'))return {
          greenButtonQaSafeSummary:()=>{throw Error('Metrics must never load QA readiness')}
        };
        if(name.endsWith('greenButtonQaAssignmentPreflight.ts'))return {
          inspectGreenButtonQaAssignmentReadOnly:()=>{
            throw Error('Metrics must never scan QA assignment entities')}
        };
        if(name.endsWith('greenButtonQaEnrollment.ts'))return {
          enrollOneGreenButtonQaAssignment:()=>{
            throw Error('Metrics must never enroll a QA supplier')}
        };
        if(name.endsWith('whatsappSourceAudit.ts'))return {summarizeWhatsAppSourceAudit,summarizePendingWhatsAppAudit};
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
