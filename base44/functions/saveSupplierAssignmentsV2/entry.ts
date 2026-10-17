import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { planAssignmentTransition } from '../../shared/assignmentIntent.ts';

// Phase 1 / OFF BY DEFAULT. The current assignment UI never invokes this.
// No WhatsApp provider or Outbox call is made here: the atomic EventService row
// contains notification intents that a separate reconciler will drain.
const FLAG_KEY='assignment_intent_v1_enabled';
const validId=(v:any)=>typeof v==='string'&&/^[A-Za-z0-9_-]{3,100}$/.test(v);
Deno.serve(async(req)=>{
  if(req.method!=='POST')return Response.json({success:false,error:'Method not allowed'},{status:405});
  try{
    const client=createClientFromRequest(req);
    const actor=await client.auth.me().catch(()=>null);
    if(actor?.role!=='admin')return Response.json({success:false,error:'Administrator required'},{status:403});
    const body=await req.json().catch(()=>({}));
    const serviceId=body.eventServiceId;
    if(!validId(serviceId)||typeof body.expectedUpdatedAt!=='string'||
      !Number.isFinite(Date.parse(body.expectedUpdatedAt))){
      return Response.json({success:false,error:'Valid EventService ID and expectedUpdatedAt are required'},{status:400});
    }
    // Fail closed. No setting row = OFF. Switching providers or a global
    // WhatsApp queue preference never enables this data-model migration.
    const db=client.asServiceRole.entities;
    const flags=await db.AppSettings.filter({setting_key:FLAG_KEY},'-created_date',2);
    if(flags.length!==1||flags[0].setting_value!=='true'){
      return Response.json({success:false,error:'Durable assignment-intent migration is not enabled'},{status:423});
    }
    const existing=await db.EventService.get(serviceId).catch(()=>null);
    if(!existing||existing.is_external)return Response.json({success:false,error:'Service unavailable'},{status:404});
    if(!existing.updated_date||existing.updated_date!==body.expectedUpdatedAt){
      return Response.json({success:false,error:'Assignments were changed by another editor; reload and try again'},{status:409});
    }
    const event=await db.Event.get(existing.event_id).catch(()=>null);
    if(!event||['cancelled','completed'].includes(event.status)){
      return Response.json({success:false,error:'Event is not eligible for new supplier assignments'},{status:409});
    }
    let plan;
    try{
      plan=planAssignmentTransition(existing,body,new Date().toISOString());
    }catch(e){
      return Response.json({success:false,error:e instanceof Error?e.message:'Invalid assignment input'},{status:400});
    }
    // CAS guards the complete business-save+intent write. If a competing
    // administrator edited this record, zero writes occur and client must
    // refresh instead of silently overwriting assignments.
    const updated=await db.EventService.updateMany({
      id:serviceId,updated_date:body.expectedUpdatedAt
    },{$set:plan.patch});
    if(updated?.updated!==1){
      return Response.json({success:false,error:'Concurrent edit: no assignment was saved; refresh the event'},{status:409});
    }
    // Base44's conditional updateMany CAS may not emit an entity UPDATE
    // workflow. The separate update() wake is intentional and is performed
    // AFTER the durable assignment+intent has been committed atomically.
    // A failed wake is recoverable from assignment_intents_pending by the
    // already scheduled WhatsApp watchdog; it must not turn a saved assignment
    // into a false business-save failure.
    let wakeRequested=false;
    if(plan.hasNewIntent){
      try{
        const previous=Date.parse(existing.assignment_intent_wake_at||'')||0;
        const stamp=new Date(Math.max(Date.now(),previous+1)).toISOString();
        await db.EventService.update(serviceId,{assignment_intent_wake_at:stamp});
        wakeRequested=true;
      }catch(error){
        console.error('[SaveSupplierAssignmentsV2] intent wake failed; watchdog will recover');
      }
    }
    return Response.json({
      success:true,saved:true,notificationIntentsPersisted:plan.intents.length,
      // Persisted is NOT queued/delivered; downstream status is separate.
      notificationState:plan.intents.length?'requested':'no_new_request',
      revision:plan.revision,reconcilerRequired:plan.hasNewIntent,
      wakeRequested,wakeFallbackRequired:plan.hasNewIntent&&!wakeRequested
    });
  }catch(error){
    console.error('[SaveSupplierAssignmentsV2] failed',error instanceof Error?error.name:'unknown');
    return Response.json({success:false,error:'Unable to save assignment request'},{status:500});
  }
});
