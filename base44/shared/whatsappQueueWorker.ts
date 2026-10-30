// One server-side dispatcher for every WhatsApp source. Shared durable queue control
// serializes simultaneous workflows, prevents duplicates and rate limits across providers.
import { readWhatsAppQueueControl } from './whatsappOutbox.ts';
import { resolveWhatsAppProvider } from './whatsappProviderConfig.ts';
import { sendWhatsAppTransport } from './whatsappSend.ts';
import {prepareGreenInteractiveWorkerCandidate} from './whatsappInteractiveWorkerBridge.ts';
import {readAssignmentIntents} from './assignmentIntent.ts';

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
// Keep agreement source state aligned with the persisted Outbox receipt.
// This function must NEVER contact WhatsApp or enqueue a new Outbox job.
async function updateAgreementDeliveryMirror(client:any,job:any,status:string,messageId:string){
  const db=client.asServiceRole.entities;
  await db.ClientMessageDelivery.update(job.client_message_delivery_id,{
    state:status,provider_message_id:status==='accepted'?messageId||'':'',
    ...(status==='accepted'?{sent_at:new Date().toISOString()}:{})
  });
  const delivery=await db.ClientMessageDelivery.get?.(job.client_message_delivery_id);
  if(delivery?.kind==='signed_copy'&&delivery.agreement_id){
    const updated=await db.EventAgreement.updateMany({id:delivery.agreement_id},{$set:{copy_state:status}});
    if(updated?.updated!==1)throw new Error('Agreement copy mirror update was not confirmed');
  }
}

async function updateCardSetupWhatsAppMirror(client:any,job:any,status:string,messageId:string){
  await client.asServiceRole.entities.CardSetupRequest.update(job.card_setup_request_id,{
    link_message_state:status==='accepted'?'accepted':
      status==='unknown'?'unknown':status==='failed'?'rejected':
      ['cancelled','resolved','expired'].includes(status)?'cancelled':'queued',
    ...(status==='accepted'?{link_message_id:messageId||''}:{})
  });
}

export async function syncWhatsAppStatus(client:any,job:any,status:string,messageId:string) {
  const db=client.asServiceRole.entities;
  // Each downstream mirror is independently best-effort. One broken entity
  // must not suppress receipt propagation to unrelated agreements/cards.
  if(job.in_app_notification_id && status==='accepted') {
    try {
      await db.InAppNotification.update(job.in_app_notification_id,{
        whatsapp_sent:true,whatsapp_message_id:messageId||''
      });
      if(job.mirror_sync_pending===true) {
        await db.WhatsAppOutbox.updateMany({id:job.id,mirror_sync_pending:true},
          {$set:{mirror_sync_pending:false,mirror_sync_last_attempt_at:new Date().toISOString()}});
      }
    }catch(error){
      // A temporary InApp write failure must not turn provider ACCEPTED into
      // UNKNOWN, and must not cause a second WhatsApp send. Persist a repair
      // flag instead; the ALREADY EXISTING watchdog safely retries the mirror.
      console.error('[WhatsAppOutbox] InApp status sync failed; scheduling mirror-only repair');
      try {
        await db.WhatsAppOutbox.updateMany({id:job.id,status:'accepted'},{$set:{
          mirror_sync_pending:true,mirror_sync_last_attempt_at:new Date().toISOString()
        }});
      }catch(repairError){console.error('[WhatsAppOutbox] Mirror repair flag not persisted');}
    }
  }
  if(job.client_message_delivery_id) {
    try {
      await updateAgreementDeliveryMirror(client,job,status,messageId);
      if(job.delivery_mirror_sync_pending===true){
        await db.WhatsAppOutbox.updateMany({
          id:job.id,status,delivery_mirror_sync_pending:true
        },{$set:{delivery_mirror_sync_pending:false,delivery_mirror_sync_last_attempt_at:new Date().toISOString()}});
      }
    }catch(error){
      // The provider's outcome remains authoritative; an unavailable business
      // mirror is NEVER grounds for a second send, or for demoting ACCEPTED.
      console.error('[WhatsAppOutbox] agreement mirror unavailable; source-only repair queued');
      try{
        await db.WhatsAppOutbox.updateMany({id:job.id,status},{$set:{
          delivery_mirror_sync_pending:true,delivery_mirror_sync_last_attempt_at:new Date().toISOString()
        }});
      }catch{console.error('[WhatsAppOutbox] agreement mirror repair flag could not be persisted');}
    }
  }
  if(job.card_setup_request_id) {
    try{
      await updateCardSetupWhatsAppMirror(client,job,status,messageId);
      if(job.card_mirror_sync_pending===true){
        await db.WhatsAppOutbox.updateMany({
          id:job.id,status,card_mirror_sync_pending:true
        },{$set:{card_mirror_sync_pending:false,card_mirror_sync_last_attempt_at:new Date().toISOString()}});
      }
    }catch{
      // The customer's card is unchanged. Provider receipt remains in Outbox;
      // repair the card-link mirror without ever sending a new WhatsApp.
      console.error('[WhatsAppOutbox] card mirror unavailable; source-only repair queued');
      try{
        await db.WhatsAppOutbox.updateMany({id:job.id,status},{$set:{
          card_mirror_sync_pending:true,card_mirror_sync_last_attempt_at:new Date().toISOString()
        }});
      }catch{console.error('[WhatsAppOutbox] card mirror repair flag could not be persisted');}
    }
  }
}
// Repair only proven provider-ACCEPTED source mirrors. This never contacts
// Green API/Wasender, never modifies an UNKNOWN/FAILED job, and costs one
// filtered read per existing five-minute watchdog. Work is bounded to 10.
export async function reconcileAcceptedWhatsAppMirrors(client:any,limit=10){
  const db=client.asServiceRole.entities;
  const rows=await db.WhatsAppOutbox.filter({
    status:'accepted',mirror_sync_pending:true
  },'-created_date',Math.max(1,Math.min(10,limit)),0,
  ['id','status','provider_message_id','in_app_notification_id','mirror_sync_pending']);
  let repaired=0,failed=0;
  for(const row of rows){
    if(!row.in_app_notification_id){failed++;continue;}
    try{
      await db.InAppNotification.update(row.in_app_notification_id,{
        whatsapp_sent:true,whatsapp_message_id:row.provider_message_id||''
      });
      const cas=await db.WhatsAppOutbox.updateMany({
        id:row.id,status:'accepted',mirror_sync_pending:true
      },{$set:{mirror_sync_pending:false,mirror_sync_last_attempt_at:new Date().toISOString()}});
      if(cas?.updated===1)repaired++;
      else failed++;
    }catch(error){
      failed++;
      console.error('[WhatsAppOutbox] Deferred mirror repair failed');
    }
  }
  return {examined:rows.length,repaired,failed};
}
// Repair ONLY the stored business receipt, with one bounded read in the
// existing five-minute watchdog. No provider HTTP, token regeneration or
// enqueue. An UNKNOWN remains UNKNOWN; a failed mirror never changes its job.
export async function reconcileAgreementWhatsAppMirrors(client:any,limit=10){
  const db=client.asServiceRole.entities;
  const states=['accepted','unknown','failed','cancelled','expired','resolved'];
  const rows=await db.WhatsAppOutbox.filter({
    delivery_mirror_sync_pending:true,status:{$in:states}
  },'created_date',Math.max(1,Math.min(10,limit)),0,
  ['id','status','provider_message_id','client_message_delivery_id','delivery_mirror_sync_pending']);
  let repaired=0,failed=0;
  for(const row of rows){
    if(!row.client_message_delivery_id){failed++;continue;}
    try{
      await updateAgreementDeliveryMirror(client,row,row.status,row.provider_message_id||'');
      const changed=await db.WhatsAppOutbox.updateMany({
        id:row.id,status:row.status,delivery_mirror_sync_pending:true
      },{$set:{
        delivery_mirror_sync_pending:false,delivery_mirror_sync_last_attempt_at:new Date().toISOString()
      }});
      if(changed?.updated===1)repaired++;
      else failed++;
    }catch{
      failed++;
      console.error('[WhatsAppOutbox] agreement source-only mirror repair unavailable');
    }
  }
  return {examined:rows.length,repaired,failed};
}

// Card-setup source repairs are independent of payment processing. Repair
// only a terminal WhatsApp receipt already persisted in Outbox. No provider
// HTTP, no tokenization, no customer/account charging, and no resend.
export async function reconcileCardSetupWhatsAppMirrors(client:any,limit=10){
  const db=client.asServiceRole.entities;
  const states=['accepted','unknown','failed','cancelled','expired','resolved'];
  const rows=await db.WhatsAppOutbox.filter({
    card_mirror_sync_pending:true,status:{$in:states}
  },'created_date',Math.max(1,Math.min(10,limit)),0,
  ['id','status','provider_message_id','card_setup_request_id','card_mirror_sync_pending']);
  let repaired=0,failed=0;
  for(const row of rows){
    if(!row.card_setup_request_id){failed++;continue;}
    try{
      await updateCardSetupWhatsAppMirror(client,row,row.status,row.provider_message_id||'');
      const updated=await db.WhatsAppOutbox.updateMany({
        id:row.id,status:row.status,card_mirror_sync_pending:true
      },{$set:{card_mirror_sync_pending:false,card_mirror_sync_last_attempt_at:new Date().toISOString()}});
      if(updated?.updated===1)repaired++;
      else failed++;
    }catch{
      failed++;
      console.error('[WhatsAppOutbox] card setup source-only mirror repair unavailable');
    }
  }
  return {examined:rows.length,repaired,failed};
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
    // A supplier may be rejected and later re-assigned while an OLD queued
    // notification is still waiting (quiet hours, rate limit, or outage).
    // Checking only 'pending' would send that superseded original job AND
    // the new revision. Inspect only this supplier's latest durable intent;
    // a different supplier's later revision must not invalidate this one.
    if(svc.assignment_intent_mode==='durable_v1'){
      const intents=readAssignmentIntents(svc.assignment_notification_intents||'[]');
      const latest=[...intents].reverse().find(i=>i.supplier_id===job.supplier_id);
      if(latest && (job.idempotency_key!==latest.key||
        !['requested','queued','accepted'].includes(latest.state)))return false;
    }
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
// Provider HTTP and durable receipt writes are separate failure domains.
// Retry ONLY the database acknowledgement, never the provider transport.
// An unconfirmed result stays 'sending' until conservative watchdog review.
export async function persistWhatsAppProviderOutcome(outbox:any,job:any,patch:any){
  try{
    await outbox.update(job.id,patch);
    return true;
  }catch{
    console.error('[WhatsAppOutbox] provider receipt DB write unconfirmed; verifying same job');
  }
  const matches=(record:any)=>record?.status===patch.status &&
    (patch.status!=='accepted'||record.provider_message_id===patch.provider_message_id);
  try{
    if(matches(await outbox.get(job.id)))return true;
  }catch{console.error('[WhatsAppOutbox] receipt verification read unavailable');}
  try{
    const result=await outbox.updateMany({
      id:job.id,status:'sending',lease_token:job.lease_token
    },{$set:patch});
    if(result?.updated===1)return true;
  }catch{console.error('[WhatsAppOutbox] receipt recovery CAS write unconfirmed');}
  try{
    if(matches(await outbox.get(job.id)))return true;
  }catch{console.error('[WhatsAppOutbox] receipt recovery verification unavailable');}
  return false;
}

export async function drainWhatsAppOutbox(client:any,opts:any={}) {
  const db=client?.asServiceRole?.entities;
  if(!db) throw new Error('A backend service client is required');
  const controls=db.WhatsAppQueueControl;
  // The authenticated backend wrapper has already read this singleton. Reuse
  // it for the preflight; CAS claim and per-job reload still enforce current
  // state. Direct/test callers without preflight retain the existing read.
  let control=opts.initialControl?.control_key==='global'
    ? opts.initialControl
    : await queueStage('control_read',()=>readWhatsAppQueueControl(client));
  if(!control.enabled) return {success:true,reason:'disabled',sent:0};
  if(control.paused) return {success:true,reason:'paused',sent:0};
  const first=await queueStage('due_job_query',()=>chooseDueJob(db.WhatsAppOutbox,Date.now()));
  // On the hot CREATE path, due work can be dispatched without scanning
  // every in-flight record. Stale sends are still inspected on each watchdog
  // and whenever 'sending' is the only work left in an otherwise empty queue.
  const checkInFlight=opts.wakeReason==='watchdog'||!first.pending;
  const inFlight=checkInFlight
    ? await queueStage('inflight_query',()=>db.WhatsAppOutbox.filter({status:'sending'},'send_started_at',1))
    : [];
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
    if(checkInFlight)await staleSendingToUnknown(client,Date.now());
    const maxPerRun=Math.max(1,Math.min(30,Number(control.max_messages_per_run)||16));
    while(processed<maxPerRun && Date.now()<deadline-5000) {
      control=await queueStage('control_reload',()=>controls.get(control.id));
      if(control.lease_owner!==token||!control.enabled||control.paused) break;
      const options=await queueStage('job_selection',()=>chooseDueJob(db.WhatsAppOutbox,Date.now()));
      if(!options.pending) break;
      if(!options.job) {
        // Future-only jobs cannot hold the GLOBAL worker lease for up to
        // 45 seconds and block a newly created urgent message. Release now;
        // the existing watchdog resumes scheduled jobs when due.
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
      }catch(error){
        // Pre-provider validation failed. Defer ONLY this assignment safely
        // so it never prevents unrelated invoices or customer messages.
        const retryAt=new Date(Date.now()+30_000).toISOString();
        const moved=await queueStage('assignment_validation_defer',()=>
          db.WhatsAppOutbox.updateMany({id:currentJob.id,status:currentJob.status},{$set:{
            status:'retry_wait',available_at:retryAt,
            last_error:'Assignment state temporarily unavailable; no send attempted',
            last_status_at:new Date().toISOString()
          }}));
        processed++;
        if(moved?.updated===1)retried++;
        continue;
      }
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

      // A previously frozen interactive message must never silently turn into
      // a plain-text resend after rollback, misconfiguration or manual retry.
      // Keep other invoice/reminder jobs moving, but require manual review for
      // the affected assignment. No extra DB reads for ordinary messages.
      const frozen=options.job.source_type==='assignment_new'&&!!(
        options.job.interactive_qa_required===true||
        options.job.interactive_button_bindings_json||
        options.job.sender_account_id||options.job.assignment_revision);
      // assignment_button_feedback pins the original Green SENDER ACCOUNT,
      // but is an ordinary queued text acknowledgement, not a new frozen
      // assignment with action buttons. The transport verifies that sender;
      // never quarantine the feedback merely because it has an account ID.
      if(frozen&&(!opts.interactiveConfig||
        control.interactive_outbound_live_enabled!==true)){
        const held=await queueStage('interactive_disabled_hold',()=>
          db.WhatsAppOutbox.updateMany({
            id:options.job.id,status:options.job.status,
            attempt_count:options.job.attempt_count??null
          },{$set:{status:'failed',error_code:0,
            last_error:'Frozen interactive assignment needs manual review; rollout or trusted credentials unavailable',
            completed_at:new Date().toISOString(),last_status_at:new Date().toISOString()}}));
        if(held?.updated!==1){
          lastError='Cannot safely quarantine frozen interactive assignment';
          break;
        }
        processed++;failed++;
        continue;
      }
      // Dormant owner-gated bridge. The production wrapper deliberately does
      // NOT supply opts.interactiveConfig; the control schema defaults OFF.
      // Ordinary WhatsApp jobs avoid every extra lookup and retain their
      // exact transport, pacing, UNKNOWN and idempotency behavior.
      let candidate:any={kind:'legacy',reason:'trusted_interactive_config_unavailable',job:options.job,preview:null};
      if(opts.interactiveConfig && control.interactive_outbound_live_enabled===true){
        try{
          candidate=await queueStage('interactive_pre_dispatch',()=>
            prepareGreenInteractiveWorkerCandidate(client,options.job,provider,
              control,opts.interactiveConfig));
        }catch{
          // No provider attempt has occurred. Quarantine ONLY this job;
          // leave other suppliers/invoices free to drain normally.
          const refused=await queueStage('interactive_pre_dispatch_hold',()=>
            db.WhatsAppOutbox.updateMany({
              id:options.job.id,status:options.job.status
            },{$set:{status:'failed',error_code:0,
              last_error:'Interactive preparation failed before provider dispatch; review required',
              completed_at:new Date().toISOString(),last_status_at:new Date().toISOString()}}));
          if(refused?.updated!==1){
            lastError='Interactive job preparation not safely quarantined';break;
          }
          processed++;failed++;
          continue;
        }
      }
      // A marked QA job stays interactive-only even if a trusted scope has
      // changed, so bridge fallback must never select the plain-text sender.
      if(options.job.interactive_qa_required===true&&candidate.kind!=='interactive'){
        const held=await queueStage('marked_qa_plaintext_hold',()=>
          db.WhatsAppOutbox.updateMany({
            id:options.job.id,status:options.job.status,
            interactive_qa_required:true
          },{$set:{status:'failed',error_code:0,
            last_error:'QA assignment requires signed buttons; plain text prohibited',
            completed_at:new Date().toISOString(),last_status_at:new Date().toISOString()}}));
        if(held?.updated!==1){
          lastError='Marked QA assignment could not be safely held';break;
        }
        processed++;failed++;continue;
      }
      const job=candidate.job,attempt=Number(job.attempt_count||0)+1;
      const startedAt=new Date().toISOString();
      // Split due→rate-limited eligibility from eligibility→worker claim.
      // Rate barrier is captured from BEFORE this message takes its slot.
      // Base44 timestamps and worker clocks may differ by a few milliseconds.
      // A job already selected as due must not be attributed a future due-time.
      const dueAt=Math.min(Date.parse(startedAt),Math.max(asEpoch(job.created_date),asEpoch(job.available_at)));
      const prevDispatch=asEpoch(providerLastDispatchAt);
      const rateReadyAt=Math.max(dueAt,prevDispatch?prevDispatch+intervalMs:0);
      // The frozen account, revision and entire signed snapshot must still
      // equal the verified pre-dispatch record when we claim the job.
      const claimFilter:any={id:job.id,status:job.status};
      if(candidate.kind==='interactive')Object.assign(claimFilter,{
        attempt_count:job.attempt_count??null,
        sender_account_id:job.sender_account_id,
        assignment_revision:job.assignment_revision,
        interactive_button_bindings_json:job.interactive_button_bindings_json
      });
      const jobClaim=await queueStage('job_claim',()=>db.WhatsAppOutbox.updateMany(claimFilter,{$set:{
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
        await db.WhatsAppOutbox.updateMany({id:job.id,status:'sending',lease_token:token},{$set:{
          status:candidate.kind==='interactive'?job.status:'queued',
          send_started_at:candidate.kind==='interactive'?job.send_started_at||'':'',
          ...(candidate.kind==='interactive'?{attempt_count:job.attempt_count||0}:{})
        }});
        lastError='Lost WhatsApp worker lease before dispatch';
        break;
      }
      processed++;
      // This interval measures the transport function (including a private
      // file's just-in-time signed URL), not strictly HTTP/network alone.
      const transportStartedAt=new Date().toISOString();
      let receipt:any=null,transportError:any=null;
      try{
        // This is the ONLY provider call. It is never retried by this worker.
        const dispatchJob=candidate.kind==='interactive'
          ? {...job,status:'sending',provider,lease_token:token,
             attempt_count:attempt,send_started_at:startedAt}:job;
        receipt=await (opts.transport||sendWhatsAppTransport)(
          dispatchJob,provider,client,candidate.preview);
        if(!String(receipt?.messageId||'').trim())
          throw Object.assign(new Error('Provider returned no verified message ID'),{
            deliveryUncertain:true,errorCode:502
          });
      }catch(error){transportError=error;}
      const transportFinishedAt=new Date().toISOString();
      const outcome=transportError
        ? classifyWhatsAppError(transportError,attempt,Number(job.max_attempts||3))
        : {status:'accepted',code:0,retryAt:'',reason:''};
      const patch={
        ...(control.interactive_assignment_production_enabled===true&&
           job.source_type==='assignment_new'&&provider==='green'
           ?{interactive_fallback_reason:candidate.kind==='interactive'
             ?'interactive_signed':String(candidate.reason||'legacy_fallback').slice(0,100)}:{}),
        status:outcome.status,
        provider_message_id:outcome.status==='accepted'?String(receipt.messageId):'',
        available_at:outcome.retryAt||job.available_at,
        error_code:outcome.code,last_error:outcome.reason,
        completed_at:new Date().toISOString(),
        transport_started_at:transportStartedAt,transport_finished_at:transportFinishedAt,
        last_status_at:new Date().toISOString()
      };
      // A DB failure AFTER provider acceptance must not be interpreted as a
      // provider rejection. Confirm/update the receipt without another HTTP.
      const confirmed=await persistWhatsAppProviderOutcome(db.WhatsAppOutbox,job,patch);
      if(!confirmed){
        lastError='Provider result persistence unverified; manual reconciliation required';
        break; // Do not continue while the provider receipt remains unconfirmed.
      }
      if(outcome.status==='accepted')accepted++;
      else if(outcome.status==='unknown')unknown++;
      else if(outcome.status==='failed')failed++;
      else if(outcome.status==='retry_wait')retried++;
      if(outcome.status!=='retry_wait'){
        const mirroredJob=await db.WhatsAppOutbox.get(job.id).catch(()=>null);
        await syncWhatsAppStatus(client,mirroredJob||{...job,...patch},
          outcome.status,patch.provider_message_id);
      }
      // Definite 401/403 must not block other queued providers' messages.
      if(outcome.code===401||outcome.code===403)
        console.error('[WhatsAppOutbox] Provider authentication rejected a job');
    }
  } finally {
    const existing=await queueStage('lease_final_read',()=>controls.get(control.id));
    if(existing?.lease_owner===token){
      const released=await queueStage('lease_release',()=>controls.updateMany({id:control.id,lease_owner:token},{$set:{
        lease_owner:'',lease_until:'',
        last_worker_at:new Date().toISOString(),last_error:lastError,
        last_worker_finished_at:new Date().toISOString(),last_batch_count:processed,
        last_batch_elapsed_ms:Math.max(0,Date.now()-nowMs)
      }}));
      // The previous order queried remaining jobs BEFORE releasing the lease.
      // A new Outbox CREATE in that gap triggered a busy worker and was then
      // missed, leaving the message until the five-minute watchdog.
      // Read ONCE after release: any new due job arriving while busy is now
      // visible. This also covers a future-only worker (processed=0) that
      // received a new urgent CREATE while its lease was still held. Only
      // invoke a successor if due work really remains.
      if(released?.updated===1 && !existing.paused && existing.enabled &&
        !lastError && (processed>0 || !first.job)){
        const remainder=await queueStage('remaining_query',()=>chooseDueJob(db.WhatsAppOutbox,Date.now()));
        requestWake=!!remainder.job;
        if(requestWake){
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
  }
  return {success:true,reason:lastError?'blocked':'processed',accepted,failed,unknown,retried,skipped,processed,
    continued:requestWake};
}
