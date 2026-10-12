// One server-side dispatcher for every WhatsApp source. Shared durable queue control
// serializes simultaneous workflows, prevents duplicates and rate limits across providers.
import { readWhatsAppQueueControl } from './whatsappOutbox.ts';
import { resolveWhatsAppProvider } from './whatsappProviderConfig.ts';
import { sendWhatsAppTransport } from './whatsappSend.ts';

const MAX_RUNTIME_MS = 100_000;      // Below Base44 function execution limits.
const LEASE_MS = 210_000;            // Safely longer than a single worker lifetime.
const MAX_PAGE = 100;
const sleep = (ms: number) => new Promise(resolve=>setTimeout(resolve, ms));
function asEpoch(value: any): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
export function delayUntilNextSend(lastDispatchedAt: string, now = Date.now(), intervalSeconds = 7) {
  const previous=asEpoch(lastDispatchedAt);
  // No previous message => send immediately, never sleep before an idle first message.
  return previous ? Math.max(0, previous + Math.max(0, intervalSeconds)*1000 - now) : 0;
}
export function classifyWhatsAppError(error: any, attempt: number, maxAttempts = 3, now = Date.now()) {
  const code=Number(error?.errorCode || 0);
  if(error?.deliveryUncertain === true || code===408 || code>=500 || (!code && error?.errorCode !== 400)) {
    return {status:'unknown',code:code||502,retryAt:'',reason:'Provider outcome unknown: manual verification required'};
  }
  if(code===429&&attempt<maxAttempts) {
    const pause=Math.min(180,15*Math.pow(2,Math.max(0,attempt-1)));
    return {status:'retry_wait',code,retryAt:new Date(now+pause*1000).toISOString(),reason:'Rate limit 429 - scheduled for central retry'};
  }
  return {status:'failed',code:code||400,retryAt:'',reason:code===429?'Rate limit exhausted retries':'Provider rejected the message'};
}
function randomToken() {
  return typeof crypto!=='undefined' && crypto.randomUUID ? crypto.randomUUID() : 'worker-'+Date.now()+'-'+Math.random();
}
async function safeCompletionLinks(client:any,job:any,status:string,messageId:string) {
  const db=client.asServiceRole.entities;
  try {
    if(job.in_app_notification_id && status==='accepted') await db.InAppNotification.update(job.in_app_notification_id,{whatsapp_sent:true,whatsapp_message_id:messageId||''});
    if(job.client_message_delivery_id) await db.ClientMessageDelivery.update(job.client_message_delivery_id,{
      state:status,provider_message_id:status==='accepted' ? messageId||'' : '',
      ...(status==='accepted'?{sent_at:new Date().toISOString()}:{})
    });
    if(job.card_setup_request_id) await db.CardSetupRequest.update(job.card_setup_request_id,{
      link_message_state:status==='accepted'?'accepted':status==='unknown'?'unknown':status==='failed'?'rejected':'queued',
      ...(status==='accepted'?{link_message_id:messageId||''}:{})
    });
  }catch(error){
    console.error('[WhatsAppOutbox] linked status update failed:',error instanceof Error?error.name:'unknown');
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
      if(updated?.updated===1) count++;
    }
  }
  return count;
}
async function chooseDueJob(db:any,now:number) {
  // Stable FIFO. One queue for assignments, invoices, documents and reminders.
  const pool=await db.filter({status:{$in:['queued','retry_wait']}},'created_date',MAX_PAGE);
  let due:any=null;
  let nextAt=Infinity;
  for(const record of pool) {
    const ready=asEpoch(record.available_at);
    if(!ready||ready<=now) {due=record;break;}
    nextAt=Math.min(nextAt,ready);
  }
  return {job:due,nextAt,pending:pool.length};
}
export async function drainWhatsAppOutbox(client:any,opts:any={}) {
  const db=client?.asServiceRole?.entities;
  if(!db) throw new Error('A backend service client is required');
  const controls=db.WhatsAppQueueControl;
  let control=await readWhatsAppQueueControl(client);
  if(!control.enabled) return {success:true,reason:'disabled',sent:0};
  if(control.paused) return {success:true,reason:'paused',sent:0};
  const first=await chooseDueJob(db.WhatsAppOutbox,Date.now());
  const inFlight=await db.WhatsAppOutbox.filter({status:'sending'},'send_started_at',1);
  // A crashed worker can leave only a 'sending' record. The watchdog must
  // inspect it and mark unknown rather than treating the queue as empty.
  if(!first.pending && !inFlight.length) return {success:true,reason:'empty',sent:0};

  // Atomic compare-and-swap on one persistent singleton, not browser-local state.
  const nowMs=Date.now();
  if(control.lease_owner && asEpoch(control.lease_until)>nowMs) return {success:true,reason:'busy',sent:0};
  const token=randomToken();
  const claim=await controls.updateMany({
    id:control.id,lease_owner:control.lease_owner||'',lease_until:control.lease_until||''
  },{$set:{
    lease_owner:token,lease_until:new Date(nowMs+LEASE_MS).toISOString(),
    last_worker_at:new Date(nowMs).toISOString()
  }});
  if(claim?.updated!==1) return {success:true,reason:'busy',sent:0};
  const deadline=Date.now()+MAX_RUNTIME_MS;
  let accepted=0,failed=0,unknown=0,retried=0,processed=0,requestWake=false;
  let lastError='';
  try {
    await staleSendingToUnknown(client,Date.now());
    const maxPerRun=Math.max(1,Math.min(30,Number(control.max_messages_per_run)||16));
    while(processed<maxPerRun && Date.now()<deadline-5000) {
      control=await controls.get(control.id);
      if(control.lease_owner!==token||!control.enabled||control.paused) break;
      const options=await chooseDueJob(db.WhatsAppOutbox,Date.now());
      if(!options.pending) break;
      if(!options.job) {
        const delay=options.nextAt-Date.now();
        if(delay>0 && delay<=60000 && Date.now()+delay<deadline-5000){await sleep(delay);continue;}
        break;
      }
      const interval=Math.max(0,Math.min(60,Number(control.min_interval_seconds)||0));
      const wait=delayUntilNextSend(control.last_dispatched_at,Date.now(),interval);
      // Delay is BETWEEN provider calls, not before the first call of an idle queue.
      if(wait>0) {
        if(Date.now()+wait>=deadline-5000) break;
        await sleep(wait);continue;
      }
      let provider;
      try {
        provider=await resolveWhatsAppProvider(client);
        if(provider==='wasender'&&!Deno.env.get('WASENDER_API_KEY'))throw new Error('Wasender session key unavailable');
        if(provider==='green'&&(!Deno.env.get('GREEN_API_INSTANCE_ID')||!Deno.env.get('GREEN_API_TOKEN')))throw new Error('Green API credentials unavailable');
      }catch(error) {
        lastError='WhatsApp provider not configured';
        break;  // Keep queued jobs intact; settings page shows this error.
      }

      const job=options.job,attempt=Number(job.attempt_count||0)+1;
      const startedAt=new Date().toISOString();
      const jobClaim=await db.WhatsAppOutbox.updateMany({id:job.id,status:job.status},{$set:{
        status:'sending',send_started_at:startedAt,attempt_count:attempt,lease_token:token,provider,last_status_at:startedAt
      }});
      if(jobClaim?.updated!==1)continue;  // Another worker already processed it.
      const timeSlot=await controls.updateMany({id:control.id,lease_owner:token},{$set:{
        last_dispatched_at:startedAt,
        next_allowed_at:new Date(Date.now()+interval*1000).toISOString(),last_worker_at:startedAt
      }});
      if(timeSlot?.updated!==1) {
        await db.WhatsAppOutbox.updateMany({id:job.id,status:'sending',lease_token:token},{$set:{status:'queued',send_started_at:''}});
        lastError='Lost WhatsApp worker lease before dispatch';
        break;
      }
      processed++;
      try {
        // Only this line reaches a provider. Never call the public enqueue method.
        const receipt=await (opts.transport||sendWhatsAppTransport)(job,provider,client);
        await db.WhatsAppOutbox.update(job.id,{
          status:'accepted',provider_message_id:receipt.messageId||'',completed_at:new Date().toISOString(),
          last_error:'',error_code:0,last_status_at:new Date().toISOString()
        });
        accepted++;
        await safeCompletionLinks(client,job,'accepted',receipt.messageId||'');
      }catch(error){
        const outcome=classifyWhatsAppError(error,attempt,Number(job.max_attempts||3));
        await db.WhatsAppOutbox.update(job.id,{
          status:outcome.status,available_at:outcome.retryAt||job.available_at,
          error_code:outcome.code,last_error:outcome.reason,completed_at:new Date().toISOString(),
          last_status_at:new Date().toISOString()
        });
        if(outcome.status==='unknown') unknown++;
        if(outcome.status==='failed') failed++;
        if(outcome.status==='retry_wait') retried++;
        if(outcome.status!=='retry_wait') await safeCompletionLinks(client,job,outcome.status,'');
        if(outcome.code===401||outcome.code===403) {lastError='WhatsApp provider authorization rejected';break;}
      }
    }
  } finally {
    const existing=await controls.get(control.id);
    if(existing?.lease_owner===token){
      const remainder=await chooseDueJob(db.WhatsAppOutbox,Date.now());
      // Kick a successor after any completed batch, even when empty. This also
      // closes the race where a new job arrives between the last queue read
      // and lease release; an empty successor exits without another wake.
      // The 5-minute watchdog remains a crash-recovery fallback only.
      requestWake=(processed>0 || !!remainder.job) && !existing.paused && existing.enabled && !lastError;
      await controls.updateMany({id:control.id,lease_owner:token},{$set:{
        lease_owner:'',lease_until:'',
        last_worker_at:new Date().toISOString(),last_error:lastError,
        ...(requestWake?{wake_requested_at:new Date().toISOString()}: {})
      }});
    }
  }
  return {success:true,reason:lastError?'blocked':'processed',accepted,failed,unknown,retried,processed,
    continued:requestWake};
}
