import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { drainWhatsAppOutbox, reconcileAcceptedWhatsAppMirrors, reconcileAgreementWhatsAppMirrors, reconcileCardSetupWhatsAppMirrors } from '../../shared/whatsappQueueWorker.ts';
import { sweepPendingSupplierAssignmentIntents } from '../../shared/assignmentIntentReconciler.ts';
import { reconcileStalledAgreementEnqueues } from '../../shared/agreementQueueReconciler.ts';
import { reconcileStalledCardSetupEnqueues } from '../../shared/cardSetupQueueReconciler.ts';
import { alertUnknownWhatsAppOutcomes } from '../../shared/whatsappUnknownReviewAlerts.ts';

// Invoked by Outbox CREATE workflow, queue wake-up workflow and one 5-minute
// crash watchdog. Does not accept arbitrary message/recipient parameters.
Deno.serve(async (req) => {
  if(req.method!=='POST')return Response.json({success:false,error:'Method not allowed'},{status:405});
  try{
    const client=createClientFromRequest(req);
    const actor=await client.auth.me().catch(()=>null);
    if(!actor || actor.role!=='admin'){
      return Response.json({success:false,error:'Unauthorized queue worker'},{status:403});
    }
    // Only telemetry reads this hint. The server still selects/locks every job;
    // an untrusted caller cannot specify recipients or bypass the rate limit.
    let request:any={};
    try{request=typeof req.json==='function'?await req.json():{};}catch{}
    const wakeReason=['outbox_create','continue','watchdog'].includes(request?.wakeReason)
      ? request.wakeReason : 'unattributed';
    // Record a harmless invocation heartbeat even while the queue is disabled.
    // This allows us to verify that entity/scheduled workflows actually reach
    // an authenticated worker, without sending a test WhatsApp message.
    const controlRows=await client.asServiceRole.entities.WhatsAppQueueControl.filter({control_key:'global'},'-created_date',2);
    if(controlRows.length!==1)return Response.json({success:false,error:'Queue control missing or duplicated'},{status:409});
    if(wakeReason==='watchdog'){
      // Without this heartbeat, a healthy but empty queue looks as though the
      // worker died days ago. One bounded CAS write per EXISTING watchdog run
      // proves that the scheduled workflow reached authenticated backend code.
      // updateMany does NOT wake the entity UPDATE/continue workflow.
      try{
        await client.asServiceRole.entities.WhatsAppQueueControl.updateMany({
          id:controlRows[0].id
        },{$set:{last_watchdog_at:new Date().toISOString()}});
      }catch(error){
        console.error('[WhatsAppOutbox] Watchdog heartbeat could not be persisted');
      }
    }
    // Disabled/paused queues still have an observable watchdog heartbeat.
    // Preserve the existing no-extra-read behavior while the queue is paused.
    if(!controlRows[0].enabled || controlRows[0].paused){
      return Response.json({success:true,reason:controlRows[0].paused?'paused':'disabled',sent:0});
    }
    // Reuse our existing five-minute watchdog for missed durable intents
    // and source-only mirror repairs. None of the repair routines contacts a
    // provider; all scans are bounded and separate from regular queue wakes.
    if(wakeReason==='watchdog'){
      try{await sweepPendingSupplierAssignmentIntents(client,{maxServices:4});}
      catch(error){console.error('[WhatsAppOutbox] intent watchdog unavailable',error instanceof Error?error.name:'unknown');}
      // Rescue stalled agreement source intents using stored receipts only.
      // No replay if a crashed enqueue did not leave an Outbox row.
      try{await reconcileStalledAgreementEnqueues(client,8);}
      catch(error){console.error('[WhatsAppOutbox] stalled agreement journal check unavailable');}
      try{await reconcileStalledCardSetupEnqueues(client,8);}
      catch(error){console.error('[WhatsAppOutbox] stalled card setup journal check unavailable');}
      try{await reconcileAcceptedWhatsAppMirrors(client,10);}
      catch(error){console.error('[WhatsAppOutbox] InApp mirror repair watchdog unavailable');}
      try{await reconcileAgreementWhatsAppMirrors(client,10);}
      catch(error){console.error('[WhatsAppOutbox] agreement mirror repair watchdog unavailable');}
      try{await reconcileCardSetupWhatsAppMirrors(client,10);}
      catch(error){console.error('[WhatsAppOutbox] card mirror repair watchdog unavailable');}
      // Owner notification is source-only; UNKNOWN jobs are never replayed.
      // Run even when there are no queued sends, without a new Cron job.
      try{await alertUnknownWhatsAppOutcomes(client,{limit:8});}
      catch(error){console.error('[WhatsAppOutbox] unknown-result owner alerts unavailable');}
    }
    const work=await client.asServiceRole.entities.WhatsAppOutbox.filter({
      status:{$in:['queued','retry_wait','sending']}
    },'created_date',1);
    if(!work.length)return Response.json({success:true,reason:'empty',sent:0});
    // Telemetry is not a prerequisite for sending. The previous code returned
    // HTTP 500 without dispatching a queued job when this harmless write failed.
    try{
      await client.asServiceRole.entities.WhatsAppQueueControl.update(
        controlRows[0].id,{last_invoked_at:new Date().toISOString()});
    }catch{console.error('[WhatsAppOutbox] invocation telemetry unavailable');}
    const result=await drainWhatsAppOutbox(client,{wakeReason,initialControl:controlRows[0]});
    // A lost telemetry acknowledgement AFTER dispatch is not a send failure.
    try{
      await client.asServiceRole.entities.WhatsAppQueueControl.update(
        controlRows[0].id,{last_invocation_result:result.reason||''});
    }catch{console.error('[WhatsAppOutbox] result telemetry unavailable');}
    return Response.json(result);
  }catch(error){
    console.error('[WhatsAppOutbox] worker failed:',error instanceof Error?error.name:'unknown');
    return Response.json({success:false,error:'WhatsApp queue worker failed; jobs remain in the outbox'}, {status:500});
  }
});
