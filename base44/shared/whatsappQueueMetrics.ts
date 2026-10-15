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
  // Invalid / missing dates must not become negative or fabricated durations.
  const dueStart=created===null?null:Math.max(created,available===null?created:available);
  const delta=(to:number|null,from:number|null)=>
    to===null||from===null||to<from?null:to-from;
  return {
    queueWaitMs:delta(attempt,dueStart),
    providerWaitMs:delta(completed,attempt),
    totalMs:delta(completed,created),
    // This is intentional scheduling, not an "unexplained delay".
    deferredMs:delta(dueStart,created),
    afterDueMs:delta(completed,dueStart),
    hasAttempt:attempt!==null,
    hasCompletion:completed!==null
  };
}
export function summarizeWhatsAppOutbox(jobs:any[],nowIsoValue:string){
  const now=safeTime(nowIsoValue);
  const counters:Record<string,number>={};
  const metrics:Record<string,number[]>={queueWaitMs:[],providerWaitMs:[],afterDueMs:[],totalMs:[]};
  const providers:Record<string,{count:number,queueWaitMs:number[],providerWaitMs:number[]}>= {};
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
    for(const field of Object.keys(metrics)){
      const value=(sample as any)[field];
      if(value!==null)metrics[field].push(value);
    }
    const name=String(j.provider||j.requested_provider||'unattributed');
    const group=providers[name]||(providers[name]={count:0,queueWaitMs:[],providerWaitMs:[]});
    group.count++;
    if(sample.queueWaitMs!==null)group.queueWaitMs.push(sample.queueWaitMs);
    if(sample.providerWaitMs!==null)group.providerWaitMs.push(sample.providerWaitMs);
  }
  const byProvider:Record<string,any>={};
  for(const [name,group] of Object.entries(providers)){
    byProvider[name]={count:group.count,queueWait:summarizeMillis(group.queueWaitMs),
      providerProcessing:summarizeMillis(group.providerWaitMs)};
  }
  return {
    sampled:jobs.length,measuredAt:nowIsoValue,statuses:counters,
    dueStillQueued,scheduledForFuture,unknownCount,missingAttemptTimestamp,
    timings:{
      queueWait:summarizeMillis(metrics.queueWaitMs),
      providerProcessing:summarizeMillis(metrics.providerWaitMs),
      afterDue:summarizeMillis(metrics.afterDueMs),
      total:summarizeMillis(metrics.totalMs)
    },
    byProvider,
    // Only a sample, not all historical records. Never claim delivery.
    sampleOnly:true,providerAcceptanceIsNotDelivery:true
  };
}
