import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { readWhatsAppQueueControl } from '../../shared/whatsappOutbox.ts';
import { drainWhatsAppOutbox, delayUntilNextSendMs, providerIntervalMs, lastDispatchForProvider, syncWhatsAppStatus } from '../../shared/whatsappQueueWorker.ts';
import { resolveWhatsAppProvider } from '../../shared/whatsappProviderConfig.ts';
import { summarizeWhatsAppOutbox } from '../../shared/whatsappQueueMetrics.ts';

const OWNER_EMAIL = 'natib8000@gmail.com';
const MAX_PAGE = 60;
const MAX_ACTION_BATCH = 100;
const MAX_INTERVAL_MS = 300_000;
// Base44 supports server-side field projections. Loading full message bodies,
// private document URLs and captions for 500 status records on EVERY settings
// refresh was unnecessary and slowed the admin screen significantly.
const LIST_FIELDS=['id','source_type','source_id','status','message_type',
  'chat_id','requested_provider','created_date','available_at','attempt_count',
  'provider','error_code','last_error','provider_message_id','manual_review_note',
  'manual_action','resolution','archived','manual_retry_count'];
const TIMING_FIELDS=['created_date','available_at','send_started_at','completed_at',
  'job_claimed_at','rate_ready_at','prior_dispatch_at','configured_interval_ms',
  'transport_started_at','transport_finished_at','status','attempt_count',
  'provider','requested_provider','worker_wake_reason'];
const HISTORY_FIELDS=LIST_FIELDS;
const ACTIVE = new Set(['queued','retry_wait','sending']);
const CANCELLABLE = new Set(['queued','retry_wait']);
const ARCHIVABLE = new Set(['accepted','failed','cancelled','expired','resolved']);
const EDITABLE_FAILED = new Set(['failed','unknown']);
const RESPONSE = (data:any,status=200)=>Response.json(data,{status});
const isJobId = (id:any)=> typeof id==='string' && /^[A-Za-z0-9_-]{3,128}$/.test(id);
const clean = (value:any, max=250)=>String(value||'').trim().slice(0,max);
const nowIso=()=>new Date().toISOString();

function validateInterval(value:any):number {
  if(typeof value !== 'number' || !Number.isInteger(value) || value<0 || value>MAX_INTERVAL_MS) {
    throw Object.assign(new Error('Invalid provider interval: expected integer milliseconds between 0 and 300000'),{status:400});
  }
  return value;
}
function renderJob(job:any,includeBody=false){
  const chat=String(job.chat_id||'');
  const mask=chat.length>7?'•••'+chat.slice(-9):'•••';
  const result:any={
    id:job.id,source:job.source_type||'system',sourceId:job.source_id||'',
    status:job.status,kind:job.message_type,recipient:mask,
    requestedProvider:job.requested_provider||job.provider||'',
    createdAt:job.created_date,availableAt:job.available_at,attemptCount:job.attempt_count||0,
    provider:job.provider||'',errorCode:job.error_code||null,error:job.last_error||'',
    messageIdPresent:!!job.provider_message_id,manualReview:job.manual_review_note||'',
    manualAction:job.manual_action||'',resolution:job.resolution||'',
    archived:job.archived===true,manualRetryCount:job.manual_retry_count||0,
    canCancel:CANCELLABLE.has(job.status),canRetry:EDITABLE_FAILED.has(job.status),
    canResolve:EDITABLE_FAILED.has(job.status),
    canArchive:ARCHIVABLE.has(job.status)
  };
  if(includeBody){
    result.chatId=chat;
    result.text=job.message_type==='text'?(job.message_text||''):(job.caption||'');
    result.fileName=job.message_type==='document'?(job.file_name||''):'';
    result.providerMessageId=job.provider_message_id||'';
    result.completedAt=job.completed_at||'';
    result.manualActionAt=job.manual_action_at||'';
  }
  return result;
}
async function queueStatus(client:any){
  const control=await readWhatsAppQueueControl(client);
  const provider=await resolveWhatsAppProvider(client);
  const ms=providerIntervalMs(control,provider);
  const entity=client.asServiceRole.entities.WhatsAppOutbox;
  const jobs=await entity.list('-created_date',500,0,HISTORY_FIELDS);
  const totals:Record<string,number>={};
  for(const job of jobs){
    if(job.archived===true)continue;
    totals[job.status]=(totals[job.status]||0)+1;
  }
  const busy=!!control.lease_owner&&Date.parse(control.lease_until||'')>Date.now();
  const waitMs=delayUntilNextSendMs(lastDispatchForProvider(control,provider),Date.now(),ms);
  const wasenderMs=Number.isInteger(control.wasender_interval_ms)?control.wasender_interval_ms:
    Math.max(0,Number(control.min_interval_seconds||7)*1000);
  const greenMs=Number.isInteger(control.green_interval_ms)?control.green_interval_ms:
    Math.max(0,Number(control.min_interval_seconds||7)*1000);
  return {
    success:true,
    config:{
      enabled:control.enabled===true,paused:control.paused===true,
      wasenderIntervalMs:wasenderMs,greenIntervalMs:greenMs,
      maxMessagesPerRun:Number(control.max_messages_per_run)||16
    },
    totals,historyTruncated:jobs.length>=500,workerBusy:busy,
    nextAllowedInSeconds:Math.ceil(waitMs/1000),nextAllowedInMs:waitMs,
    nextQueued:(totals.queued||0)+(totals.retry_wait||0),
    lastWorkerAt:control.last_worker_at||null,lastInvokedAt:control.last_invoked_at||null,
    lastInvocationResult:control.last_invocation_result||'',lastDispatchedAt:control.last_dispatched_at||null,
    lastWorkerWakeReason:control.last_worker_wake_reason||null,
    lastWorkerRunId:control.last_worker_run_id||null,
    lastWorkerFinishedAt:control.last_worker_finished_at||null,
    lastBatchCount:Number.isFinite(control.last_batch_count)?control.last_batch_count:null,
    lastBatchElapsedMs:Number.isFinite(control.last_batch_elapsed_ms)?control.last_batch_elapsed_ms:null,
    lastError:control.last_error||'',activeProvider:provider,
    currentIntervalMs:ms,
    latest:jobs.filter((x:any)=>x.archived!==true).slice(0,20).map((x:any)=>renderJob(x))
  };
}
async function listJobs(client:any,body:any){
  const status=clean(body.status,35);
  const source=clean(body.source,64);
  const allowed=new Set(['queued','sending','accepted','retry_wait','unknown','failed','cancelled','expired','resolved']);
  if(status && status!=='all'&&!allowed.has(status))return RESPONSE({success:false,error:'Invalid queue status filter'},400);
  const offset=Number(body.offset||0);
  if(!Number.isInteger(offset)||offset<0||offset>5000)return RESPONSE({success:false,error:'Invalid offset'},400);
  const db=client.asServiceRole.entities.WhatsAppOutbox;
  const query:any={};
  if(status&&status!=='all')query.status=status;
  if(source&&source!=='all')query.source_type=source;
  const rows=Object.keys(query).length
    ?await db.filter(query,'-created_date',MAX_PAGE+1,offset,LIST_FIELDS)
    :await db.list('-created_date',MAX_PAGE+1,offset,LIST_FIELDS);
  return RESPONSE({success:true,rows:rows.slice(0,MAX_PAGE)
    .filter((x:any)=>body.showArchived===true||x.archived!==true).map((x:any)=>renderJob(x)),
    nextOffset:rows.length>MAX_PAGE?offset+MAX_PAGE:null,totalUnknown:true});
}
async function mutateOne(client:any,jobId:string,action:string,body:any,actor:any){
  if(!isJobId(jobId))return {success:false,error:'Invalid message ID',statusCode:400};
  const entity=client.asServiceRole.entities.WhatsAppOutbox;
  const row=await entity.get(jobId).catch(()=>null);
  if(!row)return {success:false,error:'Message not found',statusCode:404};
  const prior=String(row.status||'');
  const note=clean(body.note,1000);
  const stamp=nowIso();
  const patch:any={manual_action:action,manual_action_by:actor.id||actor.email,
    manual_action_at:stamp,manual_review_note:note,last_status_at:stamp};
  if(action==='cancel'){
    if(!CANCELLABLE.has(prior))return {success:false,error:'Only queued or retry-wait messages can be cancelled',statusCode:409};
    patch.status='cancelled';patch.completed_at=stamp;patch.last_error='Cancelled by system administrator before dispatch';
  }else if(action==='retry'){
    if(!EDITABLE_FAILED.has(prior))return {success:false,error:'Manual retry is restricted to failed/unknown messages',statusCode:409};
    if(prior==='unknown' && (body.verifiedNotSent!==true || note.length<12)){
      return {success:false,error:'Unknown delivery requires explicit provider verification and a written reason',statusCode:409};
    }
    if(prior==='failed'&&note.length<5)return {success:false,error:'Add a reason for retry',statusCode:400};
    patch.status='queued';patch.available_at=stamp;patch.error_code=0;patch.last_error='';
    patch.archived=false;patch.archived_at='';
    patch.send_started_at='';patch.completed_at='';patch.lease_token='';
    // Do not display timestamps belonging to a previous, manually verified
    // send attempt when a job is returned to the pending queue.
    patch.worker_run_id='';patch.worker_wake_reason='';patch.job_claimed_at='';
    patch.rate_ready_at='';patch.prior_dispatch_at='';patch.configured_interval_ms=0;
    patch.transport_started_at='';patch.transport_finished_at='';
    patch.attempt_count=0;patch.manual_retry_count=(Number(row.manual_retry_count)||0)+1;
    patch.resolution=prior==='unknown'?'verified_not_sent_then_requeued':'definite_failure_requeued';
  }else if(action==='resolve'){
    if(!EDITABLE_FAILED.has(prior))return {success:false,error:'Only failed/unknown messages can be resolved',statusCode:409};
    if(note.length<5)return {success:false,error:'A resolution note is required',statusCode:400};
    const how=body.resolution;
    if(!['handled_outside','no_longer_needed'].includes(how))
      return {success:false,error:'Invalid resolution',statusCode:400};
    patch.status='resolved';patch.completed_at=stamp;patch.resolution=how;
  }else if(action==='archive'){
    if(!ARCHIVABLE.has(prior))return {success:false,error:'Active or unknown messages must be handled before archiving',statusCode:409};
    patch.archived=true;patch.archived_at=stamp;
  }else if(action==='unarchive'){
    if(row.archived!==true)return {success:false,error:'Message is not archived',statusCode:409};
    patch.archived=false;patch.archived_at='';
  }else return {success:false,error:'Unsupported action',statusCode:400};
  const changed=await entity.updateMany({id:jobId,status:prior,...(action==='unarchive'?{archived:true}:{})},{$set:patch});
  if(changed?.updated!==1)return {success:false,error:'Message changed concurrently; refresh and retry',statusCode:409};
  if(['cancel','resolve','retry'].includes(action)){
    await syncWhatsAppStatus(client,{...row,...patch},patch.status,'');
  }
  return {success:true,updated:1,status:patch.status||prior};
}
// Safe no-send diagnostics. Do not take a worker lease or call a provider.
async function diagnoseQueue(client:any){
  const db=client.asServiceRole.entities,checks:any[]=[];
  const step=async(name:string,fn:()=>Promise<any>)=>{
    try{
      const result=await fn();
      checks.push({step:name,ok:true});
      return result;
    }catch(error){
      checks.push({step:name,ok:false,kind:error instanceof Error?error.name:'unknown'});
      throw Object.assign(new Error('Diagnostic failed at '+name),{queuePhase:name,checks});
    }
  };
  try{
    const control=await step('control_read',()=>readWhatsAppQueueControl(client));
    const due=await step('due_query',()=>db.WhatsAppOutbox.filter({
      status:{$in:['queued','retry_wait']},available_at:{$lte:new Date().toISOString()}
    },'created_date',3));
    await step('inflight_query',()=>db.WhatsAppOutbox.filter({status:'sending'},'send_started_at',1));
    const provider=await step('provider_selection',()=>resolveWhatsAppProvider(client));
    if(due[0]?.event_service_id){
      const svc=await step('assignment_read',()=>db.EventService.get(due[0].event_service_id));
      if(svc?.event_id)await step('event_read',()=>db.Event.get(svc.event_id));
    }
    const supported=typeof db.WhatsAppQueueControl.updateMany==='function' &&
      typeof db.WhatsAppOutbox.updateMany==='function';
    checks.push({step:'atomic_updateMany_available',ok:supported});
    return {success:supported,checks,provider,queueEnabled:control.enabled===true,
      paused:control.paused===true,dueCountSample:due.length,
      leaseBusy:!!control.lease_owner && Date.parse(control.lease_until||'')>Date.now(),
      noMessagesSent:true};
  }catch(error){
    return {success:false,checks,failedStep:(error as any)?.queuePhase||'unknown',
      noMessagesSent:true};
  }
}
async function bulkAction(client:any,body:any,actor:any){
  const ids=body.ids;
  if(!Array.isArray(ids)||ids.length===0||ids.length>MAX_ACTION_BATCH||new Set(ids).size!==ids.length||
    ids.some(x=>!isJobId(x))||body.confirm!==true){
    return RESPONSE({success:false,error:'Confirm and select 1–100 unique message IDs'},400);
  }
  const action=body.action==='bulkCancel'?'cancel':body.action==='bulkArchive'?'archive':null;
  if(!action)return RESPONSE({success:false,error:'Invalid bulk action'},400);
  let updated=0;const skipped:any[]=[];
  for(const id of ids){
    const result=await mutateOne(client,id,action,{note:body.note||''},actor);
    if(result.success)updated++;else skipped.push({id,error:result.error});
  }
  return RESPONSE({success:true,updated,skipped});
}
Deno.serve(async(req)=>{
  if(req.method!=='POST')return RESPONSE({success:false,error:'Method not allowed'},405);
  try{
    const client=createClientFromRequest(req);
    const actor=await client.auth.me().catch(()=>null);
    if(!actor||actor.role!=='admin'||String(actor.email||'').trim().toLowerCase()!==OWNER_EMAIL){
      return RESPONSE({success:false,error:'System owner permission required'},403);
    }
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||'status');
    const entity=client.asServiceRole.entities.WhatsAppQueueControl;
    if(action==='configure'){
      const current=await readWhatsAppQueueControl(client);
      const wasender=validateInterval(body.wasenderIntervalMs);
      const green=validateInterval(body.greenIntervalMs);
      const batch=Number(body.maxMessagesPerRun);
      if(!Number.isInteger(batch)||batch<1||batch>30||
        typeof body.enabled!=='boolean'||typeof body.paused!=='boolean'){
        return RESPONSE({success:false,error:'Invalid queue settings'},400);
      }
      if(current.enabled===true && body.enabled===false){
        const backlog=await client.asServiceRole.entities.WhatsAppOutbox.filter({
          status:{$in:['queued','retry_wait','sending']}
        },'created_date',1);
        if(backlog.length)return RESPONSE({success:false,
          error:'יש הודעות פעילות בתור. אפשר להשהות, אך לא לכבות לפני סיום הטיפול בהן.'},409);
      }
      const shouldWake=body.enabled&&!body.paused&&(!current.enabled||current.paused);
      await entity.update(current.id,{
        wasender_interval_ms:wasender,green_interval_ms:green,
        max_messages_per_run:batch,enabled:body.enabled,paused:body.paused,
        ...(shouldWake?{wake_requested_at:nowIso()}:{})
      });
      console.log('[WhatsAppQueueAdmin] Per-provider queue settings updated');
      return RESPONSE(await queueStatus(client));
    }
    if(action==='status')return RESPONSE(await queueStatus(client));
    if(action==='metrics'){
      // Explicit read-only request; no provider calls and no message contents.
      // Avoid querying another 200 records every time settings are opened.
      const rows=await client.asServiceRole.entities.WhatsAppOutbox.list('-created_date',200,0,TIMING_FIELDS);
      return RESPONSE({success:true,metrics:summarizeWhatsAppOutbox(rows,nowIso())});
    }
    if(action==='diagnose')return RESPONSE(await diagnoseQueue(client));
    if(action==='list')return await listJobs(client,body);
    if(action==='get'){
      if(!isJobId(body.id))return RESPONSE({success:false,error:'Invalid message ID'},400);
      const row=await client.asServiceRole.entities.WhatsAppOutbox.get(body.id).catch(()=>null);
      return row?RESPONSE({success:true,message:renderJob(row,true)})
        :RESPONSE({success:false,error:'Message not found'},404);
    }
    if(action==='kick'){
      // Explicit system-owner action. A failure can occur after one or more
      // provider calls, so never claim that nothing was sent.
      try {
        const dispatch=await drainWhatsAppOutbox(client,{wakeReason:'manual'});
        return RESPONSE({success:true,dispatch});
      }catch(error){
        const phase=clean((error as any)?.queuePhase||'unclassified',64);
        const kind=clean((error as any)?.originalName||((error as any)?.name)||'unknown',64);
        console.error('[WhatsAppQueueAdmin] worker kick failed phase='+phase+' kind='+kind);
        try{
          const c=await readWhatsAppQueueControl(client);
          await entity.update(c.id,{last_error:'worker_'+phase+'_'+kind,last_invocation_result:'error'});
        }catch{console.error('[WhatsAppQueueAdmin] diagnostic status could not be stored');}
        return RESPONSE({success:false,phase,kind,
          error:'עובד WhatsApp נכשל בשלב '+phase+' ('+kind+'). יש לבדוק את התור והספק לפני ניסיון חוזר; ייתכן שהשליחה כבר החלה.'},500);
      }
    }
    if(['cancel','retry','resolve','archive','unarchive'].includes(action)){
      const result=await mutateOne(client,body.id,action,body,actor);
      const {statusCode=200,...data}=result;
      return RESPONSE(data,statusCode);
    }
    if(['bulkCancel','bulkArchive'].includes(action))return bulkAction(client,body,actor);
    return RESPONSE({success:false,error:'Unsupported queue action'},400);
  }catch(error){
    const status=Number((error as any)?.status)||500;
    console.error('[WhatsAppQueueAdmin] failed:',error instanceof Error?error.name:'unknown');
    const phase=clean((error as any)?.queuePhase||'server_request',64);
    return RESPONSE({success:false,phase,
      error:status===400?String((error as any)?.message||'Invalid settings'):
      'תקלה במנגנון התור ('+phase+'). יש לבדוק את מצב ההודעות לפני ניסיון חוזר.'},status);
  }
});
