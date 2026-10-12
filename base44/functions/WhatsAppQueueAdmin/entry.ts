import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';
import { readWhatsAppQueueControl } from '../../shared/whatsappOutbox.ts';
import { drainWhatsAppOutbox } from '../../shared/whatsappQueueWorker.ts';
import { resolveWhatsAppProvider } from '../../shared/whatsappProviderConfig.ts';

const OWNER_EMAIL='natib8000@gmail.com';
const response=(v:any,code=200)=>Response.json(v,{status:code});
Deno.serve(async(req)=>{
  if(req.method!=='POST')return response({success:false,error:'Method not allowed'},405);
  try{
    const client=createClientFromRequest(req);
    const actor=await client.auth.me().catch(()=>null);
    if(!actor||actor.role!=='admin'||String(actor.email||'').trim().toLowerCase()!==OWNER_EMAIL){
      return response({success:false,error:'System owner permission required'},403);
    }
    const body=await req.json().catch(()=>({}));
    const action=body.action;
    const entity=client.asServiceRole.entities.WhatsAppQueueControl;
    if(action==='configure'){
      const current=await readWhatsAppQueueControl(client);
      const seconds=Number(body.minIntervalSeconds);
      const batch=Number(body.maxMessagesPerRun);
      if(!Number.isInteger(seconds)||seconds<1||seconds>60||!Number.isInteger(batch)||batch<1||batch>30
         ||typeof body.enabled!=='boolean'||typeof body.paused!=='boolean'){
        return response({success:false,error:'Queue settings invalid'},400);
      }
      // Never switch back to legacy direct dispatch while an active outbox
      // backlog exists: it could overlap messages still held by this queue.
      if(current.enabled === true && body.enabled === false) {
        const backlog=await client.asServiceRole.entities.WhatsAppOutbox.filter({
          status:{$in:['queued','retry_wait','sending']}
        },'created_date',1);
        if(backlog.length) return response({
          success:false,error:'יש הודעות פעילות בתור. אפשר להשהות את התור, אך לא לכבות אותו לפני טיפול בהן.'
        },409);
      }
      const shouldWake=body.enabled && !body.paused &&
        (!current.enabled || current.paused);
      await entity.update(current.id,{
        min_interval_seconds:seconds,max_messages_per_run:batch,
        enabled:body.enabled,paused:body.paused,
        ...(shouldWake?{wake_requested_at:new Date().toISOString()}:{})
      });
      console.log('[WhatsAppQueue] central settings changed by system owner');
    } else if(action==='kick') {
      // Explicit user action can send pending messages; never run during status.
      const dispatch=await drainWhatsAppOutbox(client);
      return response({success:true,dispatch});
    } else if(action!=='status'){
      return response({success:false,error:'Unsupported queue action'},400);
    }
    const current=await readWhatsAppQueueControl(client);
    const jobs=await client.asServiceRole.entities.WhatsAppOutbox.list('-created_date',500);
    const totals:Record<string,number>={};
    for(const job of jobs)totals[job.status]=(totals[job.status]||0)+1;
    const waitMs=Math.max(0,Date.parse(current.next_allowed_at||'')-Date.now())||0;
    const busy=!!current.lease_owner&&Date.parse(current.lease_until||'')>Date.now();
    return response({
      success:true,config:{enabled:current.enabled===true,paused:current.paused===true,
        minIntervalSeconds:Number(current.min_interval_seconds)||7,
        maxMessagesPerRun:Number(current.max_messages_per_run)||16},
      totals,historyTruncated:jobs.length>=500,workerBusy:busy,
      nextAllowedInSeconds:Math.ceil(waitMs/1000),
      nextQueued:jobs.filter((x:any)=>['queued','retry_wait'].includes(x.status)).length,
      lastWorkerAt:current.last_worker_at||null,lastDispatchedAt:current.last_dispatched_at||null,
      lastError:current.last_error||'',activeProvider:await resolveWhatsAppProvider(client),
      latest:jobs.slice(0,35).map((j:any)=>({
        id:j.id,source:j.source_type,status:j.status,kind:j.message_type,
        createdAt:j.created_date,attemptCount:j.attempt_count,provider:j.provider||'',
        errorCode:j.error_code||null,error:j.last_error||'',messageIdPresent:!!j.provider_message_id
      }))
    });
  }catch(error){
    console.error('[WhatsAppQueueAdmin] failed:',error instanceof Error?error.name:'unknown');
    return response({success:false,error:'WhatsApp queue settings/status unavailable'},500);
  }
});
