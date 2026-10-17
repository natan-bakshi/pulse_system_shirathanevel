import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { processSupplierAssignmentIntents } from '../../shared/assignmentIntentReconciler.ts';

// Durable assignment-intent reconciliation. A disabled feature flag returns
// without scanning services or sending anything. No user-supplied recipients
// or arbitrary WhatsApp payloads are accepted here.
Deno.serve(async(req)=>{
  if(req.method!=='POST')return Response.json({success:false,error:'Method not allowed'},{status:405});
  try{
    const client=createClientFromRequest(req);
    const actor=await client.auth.me().catch(()=>null);
    if(actor?.role!=='admin')return Response.json({success:false,error:'Administrator required'},{status:403});
    const body=await req.json().catch(()=>({}));
    const id=String(body.eventServiceId||body.event_service_id||
      body.event?.entity_id||body.event?.entityid||body.data?.id||'');
    if(!/^[A-Za-z0-9_-]{3,100}$/.test(id))
      return Response.json({success:false,error:'EventService ID is required'},{status:400});
    const result=await processSupplierAssignmentIntents(client,id);
    return Response.json(result,{status:result.reason==='feature_disabled'?423:
      result.reason==='changed_concurrently'?409:200});
  }catch(error){
    console.error('[ReconcileSupplierAssignments] failed',error instanceof Error?error.name:'unknown');
    return Response.json({success:false,error:'Assignment intent reconciliation failed'},{status:500});
  }
});
