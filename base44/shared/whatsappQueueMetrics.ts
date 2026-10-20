// Pure read-only performance math for WhatsApp Outbox.
// Delayed messages should NOT count scheduled quiet hours as queue latency.
const safeTime=(value:any)=>{
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms)?ms:null;
};
export function summarizeMillis(values:number[]){
  const sorted=values.filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);
  if(!sorted.length)return {count:0,p50Ms:null,p95Ms:null,maxMs:null};
  const percentile=(p:number)=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
  return {count:sorted.length,p50Ms:percentile(.5),p95Ms:percentile(.95),
    maxMs:sorted[sorted.length-1]};
}
export function readOutboxTiming(job:any){
  const created=safeTime(job.created_date);
  const available=safeTime(job.available_at);
  const attempt=safeTime(job.send_started_at);
  const completed=safeTime(job.completed_at);
  const claimed=safeTime(job.job_claimed_at);
  const rateReady=safeTime(job.rate_ready_at);
  const previousDispatch=safeTime(job.prior_dispatch_at);
  const transportStart=safeTime(job.transport_started_at);
  const transportEnd=safeTime(job.transport_finished_at);
  const interval=Number.isInteger(job.configured_interval_ms)&&job.configured_interval_ms>=0
    ? job.configured_interval_ms : null;
  // Invalid / missing dates must not become negative or fabricated durations.
  const dueStart=created===null?null:Math.max(created,available===null?created:available);
  const delta=(to:number|null,from:number|null)=>
    to===null||from===null||to<from?null:to-from;
  return {
    queueWaitMs:delta(attempt,dueStart),
    providerWaitMs:delta(completed,attempt), // Legacy: includes transport and persistence.
    // Backlog in front of this job, then the remaining configured interval.
    backlogWaitMs:dueStart===null||claimed===null||interval===null?null:
      previousDispatch===null?0:Math.max(0,previousDispatch-dueStart),
    spacingWaitMs:dueStart===null||claimed===null||interval===null?null:
      previousDispatch===null?0:Math.max(0,previousDispatch+interval-Math.max(dueStart,previousDispatch)),
    workerLagMs:delta(claimed,rateReady),
    claimToTransportMs:delta(transportStart,claimed),
    transportDurationMs:delta(transportEnd,transportStart),
    persistenceMs:delta(completed,transportEnd),
    totalMs:delta(completed,created),
    // This is intentional scheduling, not an "unexplained delay".
    deferredMs:delta(dueStart,created),
    afterDueMs:delta(completed,dueStart),
    hasAttempt:attempt!==null,
    hasCompletion:completed!==null,
    hasDetailedTiming:claimed!==null && rateReady!==null && interval!==null &&
      transportStart!==null && transportEnd!==null
  };
}
export function summarizeWhatsAppOutbox(jobs:any[],nowIsoValue:string){
  const now=safeTime(nowIsoValue);
  const counters:Record<string,number>={};
  const fields=['queueWaitMs','providerWaitMs','afterDueMs','totalMs',
    'backlogWaitMs','spacingWaitMs','workerLagMs','claimToTransportMs',
    'transportDurationMs','persistenceMs'];
  const metrics:Record<string,number[]>={};
  for(const field of fields)metrics[field]=[];
  const providers:Record<string,{count:number,queueWaitMs:number[],providerWaitMs:number[],transportDurationMs:number[]}>= {};
  // Diagnostic category only. The source name is NOT a phone, message,
  // business ID, URL or recipient; never include arbitrary source content.
  const sourceGroups:Record<string,{count:number,queueWaitMs:number[],afterDueMs:number[],transportDurationMs:number[]}>=Object.create(null);
  const byWakeReason:Record<string,number>={};
  let detailedTimingCount=0;
  let dueStillQueued=0;
  let scheduledForFuture=0;
  let missingAttemptTimestamp=0;
  let unknownCount=0;
  for(const j of jobs){
    const state=String(j?.status||'unknown');
    counters[state]=(counters[state]||0)+1;
    if(state==='unknown')unknownCount++;
    const created=safeTime(j?.created_date);
    const available=safeTime(j?.available_at);
    if(now!==null&&['queued','retry_wait'].includes(state)){
      if(available!==null&&available>now)scheduledForFuture++;
      else dueStillQueued++;
    }
    const sample=readOutboxTiming(j);
    if(['accepted','failed','unknown','expired','cancelled','resolved'].includes(state)
      && j.attempt_count>0&&!sample.hasAttempt){
      missingAttemptTimestamp++;
    }
    // Only use accepted/unknown/failed provider attempts to compare transport
    // performance. Cancelled/expired are not HTTP requests.
    const sentAttempt=['accepted','unknown','failed'].includes(state)&&Number(j.attempt_count)>0;
    if(!sentAttempt)continue;
    if(sample.hasDetailedTiming)detailedTimingCount++;
    if(j.worker_wake_reason){
      const reason=['outbox_create','continue','watchdog','manual'].includes(j.worker_wake_reason)
        ? j.worker_wake_reason : 'unattributed';
      byWakeReason[reason]=(byWakeReason[reason]||0)+1;
    }
    for(const field of fields){
      const value=(sample as any)[field];
      if(value!==null)metrics[field].push(value);
    }
    const name=String(j.provider||j.requested_provider||'unattributed');
    const group=providers[name]||(providers[name]={count:0,queueWaitMs:[],providerWaitMs:[],transportDurationMs:[]});
    group.count++;
    if(sample.queueWaitMs!==null)group.queueWaitMs.push(sample.queueWaitMs);
    if(sample.providerWaitMs!==null)group.providerWaitMs.push(sample.providerWaitMs);
    if(sample.transportDurationMs!==null)group.transportDurationMs.push(sample.transportDurationMs);
    const sourceLabel=String(j.source_type||'');
    const sourceName=/^[a-zA-Z0-9_-]{1,64}$/.test(sourceLabel)
      ?sourceLabel:'unattributed';
    const source=sourceGroups[sourceName]||(sourceGroups[sourceName]={
      count:0,queueWaitMs:[],afterDueMs:[],transportDurationMs:[]
    });
    source.count++;
    if(sample.queueWaitMs!==null)source.queueWaitMs.push(sample.queueWaitMs);
    if(sample.afterDueMs!==null)source.afterDueMs.push(sample.afterDueMs);
    if(sample.transportDurationMs!==null)source.transportDurationMs.push(sample.transportDurationMs);
  }
  const byProvider:Record<string,any>={};
  for(const [name,group] of Object.entries(providers)){
    byProvider[name]={count:group.count,queueWait:summarizeMillis(group.queueWaitMs),
      providerProcessing:summarizeMillis(group.providerWaitMs),
      transportDuration:summarizeMillis(group.transportDurationMs)};
  }
  const bySource:Record<string,any>={};
  for(const [name,group] of Object.entries(sourceGroups)){
    bySource[name]={
      count:group.count,queueWait:summarizeMillis(group.queueWaitMs),
      afterDue:summarizeMillis(group.afterDueMs),
      transportDuration:summarizeMillis(group.transportDurationMs)
    };
  }
  return {
    sampled:jobs.length,measuredAt:nowIsoValue,statuses:counters,
    dueStillQueued,scheduledForFuture,unknownCount,missingAttemptTimestamp,
    detailedTimingCount,byWakeReason,
    timings:{
      queueWait:summarizeMillis(metrics.queueWaitMs),
      providerProcessing:summarizeMillis(metrics.providerWaitMs),
      afterDue:summarizeMillis(metrics.afterDueMs),
      total:summarizeMillis(metrics.totalMs),
      backlogWait:summarizeMillis(metrics.backlogWaitMs),
      pacingWait:summarizeMillis(metrics.spacingWaitMs),
      workerLag:summarizeMillis(metrics.workerLagMs),
      claimToTransport:summarizeMillis(metrics.claimToTransportMs),
      transportDuration:summarizeMillis(metrics.transportDurationMs),
      persistence:summarizeMillis(metrics.persistenceMs)
    },
    byProvider,bySource,
    // Only a sample, not all historical records. Never claim delivery.
    sampleOnly:true,providerAcceptanceIsNotDelivery:true
  };
}
