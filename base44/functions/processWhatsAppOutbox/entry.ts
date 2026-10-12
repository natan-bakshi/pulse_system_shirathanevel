import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';
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
    const result=await drainWhatsAppOutbox(client);
    return Response.json(result);
  }catch(error){
    console.error('[WhatsAppOutbox] worker failed:',error instanceof Error?error.name:'unknown');
    return Response.json({success:false,error:'WhatsApp queue worker failed; jobs remain in the outbox'}, {status:500});
  }
});
