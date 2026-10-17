// One server-side dispatcher for every WhatsApp source. Shared durable queue control
// serializes simultaneous workflows, prevents duplicates and rate limits across providers.
import { readWhatsAppQueueControl } from './whatsappOutbox.ts';
import { resolveWhatsAppProvider } from './whatsappProviderConfig.ts';
import { sendWhatsAppTransport } from './whatsappSend.ts';

const MAX_RUNTIME_MS = 45_000;       // Conservative bounded worker runtime.
const LEASE_MS = 120_000;           // Longer than one worker, recovered by watchdog.
const sleep = (ms: number) => new Promise(resolve=>setTimeout(resolve, ms));
async function queueStage<T>(name:string,operation:()=>Promise<T>):Promise<T>{
  try{return await operation();}
  catch(error){
    console.error('[WhatsAppOutbox] stage='+name,'cause=',error instanceof Error?error.name:'unknown');
    throw Object.assign(new Error('Central WhatsApp queue failed at '+name),{queuePhase:name,originalName:error instanceof Error?error.name:'unknown'});
  }
}
function asEpoch(value: any): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
export function delayUntilNextSendMs(lastDispatchedAt: string, now = Date.now(), intervalMs = 7000) {
  const previous=asEpoch(lastDispatchedAt);
  // No history => the first message is immediately eligible. The interval
  // constrains successive provider dispatches, including across worker runs.
  return previous ? Math.max(0, previous + Math.max(0, intervalMs) - now) : 0;
}
// Retain the original seconds API for callers/tests that already use it.
export function delayUntilNextSend(lastDispatchedAt: string, now = Date.now(), intervalSeconds = 7) {
  return delayUntilNextSendMs(lastDispatchedAt, now, intervalSeconds * 1000);
}
// The singleton worker still serializes ALL providers, but pacing belongs to
// the provider that will actually send this job. A Green API message must NOT
// unnecessarily inherit Wasender's 7s cooldown (or vice versa).
export function lastDispatchForProvider(control:any,provider:string):string {
  if(provider!=='green' && provider!=='wasender')throw new Error('Unsupported WhatsApp provider');
  const field=provider==='green'?'last_green_dispatched_at':'last_wasender_dispatched_at';
  const pinned=String(control?.[field]||'');
  if(pinned && Number.isFinite(Date.parse(pinned)))return pinned;
  // Upgrade safety: historic queue rows only tracked a global timestamp.
  // Until the first post-upgrade send for this provider, use the conservative
  // global timestamp rather than risk breaking its minimum spacing.
  return String(control?.last_dispatched_at||'');
}
export function providerIntervalMs(control: any, provider: string): number {
  if(provider !== 'green' && provider !== 'wasender')throw new Error('Unsupported WhatsApp provider');
  const field=provider === 'green' ? 'green_interval_ms' : 'wasender_interval_ms';
  const value=control?.[field];
  if(Number.isInteger(value) && value>=0 && value<=300000) return value;
  // Existing configurations before the per-provider migration used seconds.
  const fallback=Number(control?.min_interval_seconds);
  return Number.isFinite(fallback) ? Math.max(0,Math.min(300000,Math.round(fallback*1000))) : 7000;
}
export function classifyWhatsAppError(error: any, attempt: number, maxAttempts = 3, now = Date.now()) {
  const code=Number(error?.errorCode || 0);
  if(error?.deliveryUncertain === true || code===408 || code>=500 || (!code && error?.errorCode !== 400)) {
    return {status:'unknown',code:code||502,retryAt:'',reason:'Provider outcome unknown: manual verification required'};
  }
  if(code===429&&attempt<maxAttempts) {
    const computed=Math.min(180,15*Math.pow(2,Math.max(0,attempt-1)));
    const providerSeconds=Math.max(0,Math.min(3600,Number(error?.retryAfterSeconds)||0));
    const pause=Math.max(computed,providerSeconds);
    return {status:'retry_wait',code,retryAt:new Date(now+pause*1000).toISOString(),reason:'Rate limit 429 - scheduled for central retry'};
  }
  return {status:'failed',code:code||400,retryAt:'',reason:code===429?'Rate limit exhausted retries':'Provider rejected the message'};
}
function jobCandidateProvider(job:any):string {
  const selected=String(job?.requested_provider||'').trim();
  return selected==='green'||selected==='wasender'?selected:'';
}
function randomToken() {
  return typeof crypto!=='undefined' && crypto.randomUUID ? crypto.randomUUID() : 'worker-'+Date.now()+'-'+Math.random();
}
export async function syncWhatsAppStatus(client:any,job:any,status:string,messageId:string) {
  const db=client.asServiceRole.entities;
  // Each downstream mirror is independently best-effort. One broken entity
  // must not suppress receipt propagation to unrelated agreements/cards.
  if(job.in_app_notification_id && status==='accepted') {
    try {await db.InAppNotification.update(job.in_app_notification_id,{
      whatsapp_sent:true,whatsapp_message_id:messageId||''
    });}catch(error){console.error('[WhatsAppOutbox] InApp status sync failed');}
  }
  if(job.client_message_delivery_id) {
    try {
      await db.ClientMessageDelivery.update(job.client_message_delivery_id,{
        state:status,provider_message_id:status==='accepted' ? messageId||'' : '',
        ...(status==='accepted'?{sent_at:new Date().toISOString()}:{})
      });
      const delivery=await db.ClientMessageDelivery.get?.(job.client_message_delivery_id);
      if(delivery?.kind==='signed_copy' && delivery.agreement_id) {
        await db.EventAgreement.updateMany({id:delivery.agreement_id},{$set:{
          copy_state:status
        }});
      }
    }catch(error){console.error('[WhatsAppOutbox] agreement status sync failed');}
  }
  if(job.card_setup_request_id) {
    try {await db.CardSetupRequest.update(job.card_setup_request_id,{
      link_message_state:status==='accepted'?'accepted':status==='unknown'?'unknown':status==='failed'?'rejected':status==='cancelled'||status==='resolved'||status==='expired'?'cancelled':'queued',
      ...(status==='accepted'?{link_message_id:messageId||''}:{})
    });}catch(error){console.error('[WhatsAppOutbox] card setup status sync failed');}
  }
}
async function staleSendingToUnknown(client:any, now:number) {
  const db=client.asServiceRole.entities.WhatsAppOutbox;
  const inFlight=await db.filter({status:'sending'},'send_started_at',100);
  let count=0;
  for(const row of inFlight) {
    const started=asEpoch(row.send_started_at);
    if(started && now-started>LEASE_MS) {
      const updated=await db.updateMany({id:row.id,status:'sending'},{$set:{
        status:'unknown',completed_at:new Date().toISOString(),
        last_error:'Worker stopped during an uncertain provider send; check provider history before retry',last_status_at:new Date().toISOString()
      }});
      if(updated?.updated===1) {
        count++;
        await syncWhatsAppStatus(client,row,'unknown','');
      }
    }
  }
  return count;
}
async function isStillRelevant(client:any,job:any):Promise<boolean> {
  if(job.expires_at && Number.isFinite(Date.parse(job.expires_at)) && Date.now()>=Date.parse(job.expires_at))return false;
  if(job.source_type!=='assignment_new'||!job.event_service_id||!job.supplier_id)return true;
  try{
    const svc=await client.asServiceRole.entities.EventService.get(job.event_service_id);
    if(!svc||svc.is_external)return false;
    const ids=typeof svc.supplier_ids==='string' ? JSON.parse(svc.supplier_ids||'[]') : svc.supplier_ids||[];
    const statuses=typeof svc.supplier_statuses==='string' ? JSON.parse(svc.supplier_statuses||'{}') : svc.supplier_statuses||{};
    if(!Array.isArray(ids)||!ids.includes(job.supplier_id))return false;
    if(statuses[job.supplier_id] && statuses[job.supplier_id]!=='pending')return false;
    const event=svc.event_id?await client.asServiceRole.entities.Event.get(svc.event_id):null;
    if(!event || ['cancelled','completed'].includes(event.status))return false;
    return true;
  }catch(error){
    // We cannot safely dispatch a potentially cancelled assignment without
    // a current status. Keep the job queued for a later check.
    throw new Error('Could not validate current assignment before WhatsApp dispatch');
  }
}
async function chooseDueJob(db:any,now:number) {
  // MongoDB filters due time before applying a limit, so >100 delayed retries
  // cannot starve a newer immediately due message. All new timestamps are UTC.
  const statuses={ $in:['queued','retry_wait'] };
  const due=await db.filter({
    status:statuses,available_at:{$lte:new Date(now).toISOString()}
  },'created_date',1);
  if(due.length) return {job:due[0],nextAt:now,pending:true};
  const earliest=await db.filter({status:statuses},'available_at',1);
  return {job:null,nextAt:earliest.length?asEpoch(earliest[0].available_at):Infinity,
    pending:earliest.length>0};
}
export async function drainWhatsAppOutbox(client:any,opts:any={}) {
  const db=client?.asServiceRole?.entities;
  if(!db) throw new Error('A backend service client is required');
  const controls=db.WhatsAppQueueControl;
  let control=await queueStage('control_read',()=>readWhatsAppQueueControl(client));
  if(!control.enabled) return {success:true,reason:'disabled',sent:0};
  if(control.paused) return {success:true,reason:'paused',sent:0};
  const first=await queueStage('due_job_query',()=>chooseDueJob(db.WhatsAppOutbox,Date.now()));
  const inFlight=await queueStage('inflight_query',()=>db.WhatsAppOutbox.filter({status:'sending'},'send_started_at',1));
  // A crashed worker can leave only a 'sending' record. The watchdog must
  // inspect it and mark unknown rather than treating the queue as empty.
  if(!first.pending && !inFlight.length) return {success:true,reason:'empty',sent:0};

  // Atomic compare-and-swap on one persistent singleton, not browser-local state.
  const nowMs=Date.now();
  if(control.lease_owner && asEpoch(control.lease_until)>nowMs) return {success:true,reason:'busy',sent:0};
  const token=randomToken();
  const wakeReason=['outbox_create','continue','watchdog','manual'].includes(opts.wakeReason)
    ? opts.wakeReason : 'unattributed';
  const claim=await queueStage('lease_acquire',()=>controls.updateMany({
    id:control.id,lease_owner:control.lease_owner||'',lease_until:control.lease_until||''
  },{$set:{
    lease_owner:token,lease_until:new Date(nowMs+LEASE_MS).toISOString(),
    last_worker_at:new Date(nowMs).toISOString(),
    last_worker_run_id:token,last_worker_wake_reason:wakeReason
  }}));
  if(claim?.updated!==1) return {success:true,reason:'busy',sent:0};
  const deadline=Date.now()+(Number(opts.maxRuntimeMs)||MAX_RUNTIME_MS);
  let accepted=0,failed=0,unknown=0,retried=0,skipped=0,processed=0,requestWake=false;
  let lastError='';
  try {
    await staleSendingToUnknown(client,Date.now());
    const maxPerRun=Math.max(1,Math.min(30,Number(control.max_messages_per_run)||16));
    while(processed<maxPerRun && Date.now()<deadline-5000) {
      control=await queueStage('control_reload',()=>controls.get(control.id));
      if(control.lease_owner!==token||!control.enabled||control.paused) break;
      const options=await queueStage('job_selection',()=>chooseDueJob(db.WhatsAppOutbox,Date.now()));
      if(!options.pending) break;
      if(!options.job) {
        const delay=options.nextAt-Date.now();
        if(delay>0 && delay<=60000 && Date.now()+delay<deadline-5000){await sleep(delay);continue;}
        break;
      }
      const currentJob=options.job;
      try {
        if(!(await isStillRelevant(client,currentJob))) {
          const expired=!!currentJob.expires_at && Number.isFinite(Date.parse(currentJob.expires_at))
            && Date.now()>=Date.parse(currentJob.expires_at);
          const outcome=expired?'expired':'cancelled';
          const changed=await db.WhatsAppOutbox.updateMany({id:currentJob.id,status:currentJob.status},{$set:{
            status:outcome,completed_at:new Date().toISOString(),
            last_error:expired?'Message expired before dispatch':'Assignment no longer requires supplier approval'
          }});
          // Settling a stale/obsolete job consumes a bounded worker slot too.
          // Otherwise a large backlog of cancelled assignments can spin
          // until the runtime deadline and hold up urgent valid messages.
          processed++;
          if(changed?.updated===1){
            skipped++;
            // A cancelled/expired private agreement link must not continue to
            // display "queued" in the customer delivery history forever.
            await syncWhatsAppStatus(client,currentJob,outcome,'');
          }
          continue;
        }
      }catch(error){lastError='Assignment status validation unavailable';break;}
      let provider;
      try {
        provider=jobCandidateProvider(options.job) || await resolveWhatsAppProvider(client);
      }catch(error) {
        lastError='WhatsApp provider selection unavailable';
        break; // Malformed global configuration needs operator attention.
      }
      const credentialsReady=provider==='wasender'
        ? !!Deno.env.get('WASENDER_API_KEY')
        : !!(Deno.env.get('GREEN_API_INSTANCE_ID')&&Deno.env.get('GREEN_API_TOKEN'));
      if(!credentialsReady){
        // No HTTP request can have occurred. This is safe to defer with the
        // SAME Outbox ID, leaving other-provider jobs free to make progress.
        // Do not spin over the same unconfigured job in the current batch.
        const nextAttemptAt=new Date(Date.now()+60_000).toISOString();
        const moved=await queueStage('provider_credentials_wait',()=>
          db.WhatsAppOutbox.updateMany({id:currentJob.id,status:currentJob.status},
            {$set:{status:'retry_wait',available_at:nextAttemptAt,
              last_error:'WhatsApp provider credentials unavailable; no send attempted',
              error_code:0,last_status_at:new Date().toISOString()}}));
        processed++;
        if(moved?.updated===1)retried++;
        continue;
      }
      const intervalMs=providerIntervalMs(control,provider);
      const providerLastDispatchAt=lastDispatchForProvider(control,provider);
      const wait=delayUntilNextSendMs(providerLastDispatchAt,Date.now(),intervalMs);
      // This is the only pacing decision. Idle first message is immediate.
      if(wait>0){
        if(Date.now()+wait>=deadline-5000) break;
        await sleep(wait);continue;
      }

      const job=options.job,attempt=Number(job.attempt_count||0)+1;
      const startedAt=new Date().toISOString();
      // Split due→rate-limited eligibility from eligibility→worker claim.
      // Rate barrier is captured from BEFORE this message takes its slot.
      // Base44 timestamps and worker clocks may differ by a few milliseconds.
      // A job already selected as due must not be attributed a future due-time.
      const dueAt=Math.min(Date.parse(startedAt),Math.max(asEpoch(job.created_date),asEpoch(job.available_at)));
      const prevDispatch=asEpoch(providerLastDispatchAt);
      const rateReadyAt=Math.max(dueAt,prevDispatch?prevDispatch+intervalMs:0);
      const jobClaim=await queueStage('job_claim',()=>db.WhatsAppOutbox.updateMany({id:job.id,status:job.status},{$set:{
        status:'sending',send_started_at:startedAt,attempt_count:attempt,lease_token:token,provider,
        worker_run_id:token,worker_wake_reason:wakeReason,job_claimed_at:startedAt,
        rate_ready_at:rateReadyAt?new Date(rateReadyAt).toISOString():startedAt,
        prior_dispatch_at:providerLastDispatchAt,configured_interval_ms:intervalMs,
        transport_started_at:'',transport_finished_at:'',last_status_at:startedAt
      }}));
      if(jobClaim?.updated!==1)continue;  // Another worker already processed it.
      const timeSlot=await queueStage('rate_slot_claim',()=>controls.updateMany({id:control.id,lease_owner:token},{$set:{
        last_dispatched_at:startedAt,last_provider:provider,
        [provider==='green'?'last_green_dispatched_at':'last_wasender_dispatched_at']:startedAt,
        next_allowed_at:new Date(Date.now()+intervalMs).toISOString(),last_worker_at:startedAt
      }}));
      if(timeSlot?.updated!==1) {
        await db.WhatsAppOutbox.updateMany({id:job.id,status:'sending',lease_token:token},{$set:{status:'queued',send_started_at:''}});
        lastError='Lost WhatsApp worker lease before dispatch';
        break;
      }
      processed++;
      // This interval measures the transport function (including a private
      // file's just-in-time signed URL), not strictly HTTP/network alone.
      const transportStartedAt=new Date().toISOString();
      let transportFinishedAt='';
      try {
        // Only this line reaches a provider. Never call the public enqueue method.
        const receipt=await (opts.transport||sendWhatsAppTransport)(job,provider,client);
        transportFinishedAt=new Date().toISOString();
        await db.WhatsAppOutbox.update(job.id,{
          status:'accepted',provider_message_id:receipt.messageId||'',completed_at:new Date().toISOString(),
          transport_started_at:transportStartedAt,transport_finished_at:transportFinishedAt,
          last_error:'',error_code:0,last_status_at:new Date().toISOString()
        });
        accepted++;
        await syncWhatsAppStatus(client,await db.WhatsAppOutbox.get(job.id).catch(()=>job),'accepted',receipt.messageId||'');
      }catch(error){
        transportFinishedAt ||= new Date().toISOString();
        const outcome=classifyWhatsAppError(error,attempt,Number(job.max_attempts||3));
        await db.WhatsAppOutbox.update(job.id,{
          status:outcome.status,available_at:outcome.retryAt||job.available_at,
          error_code:outcome.code,last_error:outcome.reason,completed_at:new Date().toISOString(),
          transport_started_at:transportStartedAt,transport_finished_at:transportFinishedAt,
          last_status_at:new Date().toISOString()
        });
        if(outcome.status==='unknown') unknown++;
        if(outcome.status==='failed') failed++;
        if(outcome.status==='retry_wait') retried++;
        if(outcome.status!=='retry_wait') await syncWhatsAppStatus(client,await db.WhatsAppOutbox.get(job.id).catch(()=>job),outcome.status,'');
        // HTTP 401/403 is a DEFINITE rejection for this job. Report its
        // failed state, but do not stop unrelated queued jobs (including the
        // backup provider) until the next five-minute watchdog. Never retry
        // this rejected job without an explicit administrative decision.
        if(outcome.code===401||outcome.code===403) {
          console.error('[WhatsAppOutbox] Provider authentication rejected a job');
        }
      }
    }
  } finally {
    const existing=await queueStage('lease_final_read',()=>controls.get(control.id));
    if(existing?.lease_owner===token){
      const remainder=await queueStage('remaining_query',()=>chooseDueJob(db.WhatsAppOutbox,Date.now()));
      // Kick a successor after any completed batch, even when empty. This also
      // closes the race where a new job arrives between the last queue read
      // and lease release; an empty successor exits without another wake.
      // The 5-minute watchdog remains a crash-recovery fallback only.
      requestWake=processed>0 && !!remainder.job && !existing.paused && existing.enabled && !lastError;
      const released=await queueStage('lease_release',()=>controls.updateMany({id:control.id,lease_owner:token},{$set:{
        lease_owner:'',lease_until:'',
        last_worker_at:new Date().toISOString(),last_error:lastError,
        last_worker_finished_at:new Date().toISOString(),last_batch_count:processed,
        last_batch_elapsed_ms:Math.max(0,Date.now()-nowMs)
      }}));
      // Base44's entity-UPDATE workflow must be woken with a real update(),
      // not updateMany(): an atomic CAS write alone may not emit the entity
      // trigger. This was leaving the remainder for the 5-minute watchdog.
      // Make the wake observable AFTER lease release, and only if due work
      // remains. No empty-queue cascade / credits on every run.
      if(requestWake && released?.updated===1){
        const wakeAt=new Date(Math.max(Date.now(),asEpoch(existing.wake_requested_at)+1)).toISOString();
        try {
          await queueStage('continue_wake',()=>controls.update(control.id,{wake_requested_at:wakeAt}));
        }catch(error){
          console.error('[WhatsAppOutbox] continuation wake failed; watchdog will retry');
          requestWake=false;
        }
      }
    }
  }
  return {success:true,reason:lastError?'blocked':'processed',accepted,failed,unknown,retried,skipped,processed,
    continued:requestWake};
}
