import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { drainWhatsAppOutbox } from '../../shared/whatsappQueueWorker.ts';

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
    const request=await req.json().catch(()=>({}));
    const wakeReason=['outbox_create','continue','watchdog'].includes(request?.wakeReason)
      ? request.wakeReason : 'unattributed';
    // Record a harmless invocation heartbeat even while the queue is disabled.
    // This allows us to verify that entity/scheduled workflows actually reach
    // an authenticated worker, without sending a test WhatsApp message.
    const controlRows=await client.asServiceRole.entities.WhatsAppQueueControl.filter({control_key:'global'},'-created_date',2);
    if(controlRows.length!==1)return Response.json({success:false,error:'Queue control missing or duplicated'},{status:409});
    // Idle watchdog runs should not write entities or trigger any other workflow.
    if(!controlRows[0].enabled || controlRows[0].paused){
      return Response.json({success:true,reason:controlRows[0].paused?'paused':'disabled',sent:0});
    }
    const work=await client.asServiceRole.entities.WhatsAppOutbox.filter({
      status:{$in:['queued','retry_wait','sending']}
    },'created_date',1);
    if(!work.length)return Response.json({success:true,reason:'empty',sent:0});
    await client.asServiceRole.entities.WhatsAppQueueControl.update(controlRows[0].id,{last_invoked_at:new Date().toISOString()});
    const result=await drainWhatsAppOutbox(client,{wakeReason});
    await client.asServiceRole.entities.WhatsAppQueueControl.update(controlRows[0].id,{last_invocation_result:result.reason||''});
    return Response.json(result);
  }catch(error){
    console.error('[WhatsAppOutbox] worker failed:',error instanceof Error?error.name:'unknown');
    return Response.json({success:false,error:'WhatsApp queue worker failed; jobs remain in the outbox'}, {status:500});
  }
});
