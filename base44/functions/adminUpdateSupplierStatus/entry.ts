import {createClientFromRequest} from 'npm:@base44/sdk@0.8.38';
import {persistAuthorizedSupplierStatus} from '../../shared/supplierStatusPersistence.ts';
import {recalculateEventStatus} from '../../shared/eventReadiness.ts';

// Existing admin status controls, now sharing the exact supplier-status CAS
// with the supplier dashboard and authenticated WhatsApp buttons.
// Never accepts a client-selected status source, supplier identity override,
// revision bypass, or provider transport request. No WhatsApp sends here.
const idOk=(value:unknown)=>typeof value==='string'&&
 /^[A-Za-z0-9_-]{3,128}$/.test(value);
Deno.serve(async(req)=>{
 if(req.method!=='POST')
  return Response.json({success:false,error:'Method not allowed'},{status:405});
 try{
  const client=createClientFromRequest(req);
  const actor=await client.auth.me().catch(()=>null);
  if(!actor)return Response.json({success:false,error:'Unauthorized'},{status:401});
  if(actor.role!=='admin')
   return Response.json({success:false,error:'Administrator required'},{status:403});
  const body=await req.json().catch(()=>({}));
  const {eventServiceId,supplierId,newStatus,expectedStatus}=body;
  if(!idOk(eventServiceId)||!idOk(supplierId)||
    !['pending','confirmed','rejected'].includes(newStatus)||
    !['pending','confirmed','rejected'].includes(expectedStatus)||
    (body.supplierNote!==undefined&&
      (typeof body.supplierNote!=='string'||body.supplierNote.length>1500)))
   return Response.json({success:false,error:'Invalid assignment status update'},{status:400});
  // This endpoint is deliberately staged. Direct EventService.update currently
  // triggers supplier Push, pending reminders and Google-calendar workflows.
  // Do not route admin UI here until all those side effects have an
  // idempotent replacement. No secret editing or automatic enablement.
  const flags=await client.asServiceRole.entities.AppSettings.filter({
   setting_key:'admin_supplier_status_atomic_rollout_enabled'
  },'-created_date',2,0,['setting_key','setting_value']);
  if(!Array.isArray(flags)||flags.length!==1||flags[0].setting_value!=='true')
   return Response.json({success:false,error:'Admin status migration is not enabled'},
    {status:423});
  const saved=await persistAuthorizedSupplierStatus(client.asServiceRole,{
   eventServiceId,supplierId,newStatus,expectedStatus,source:'admin',
   ...(body.supplierNote!==undefined?{supplierNote:body.supplierNote}:{})
  });
  // This is the same event readiness calculation used by the existing
  // supplier dashboard. A failure must NEVER retry the already committed CAS.
  let eventStatusUpdated=false;
  if(saved.kind==='changed'){
   try{
    await recalculateEventStatus(client.asServiceRole,saved.eventId);
    eventStatusUpdated=true;
   }catch{
    return Response.json({success:true,saved:true,
      eventStatusUpdated:false,eventId:saved.eventId,
      warning:'Event readiness requires refresh; supplier decision was saved'});
   }
  }
  return Response.json({success:true,saved:saved.kind==='changed',
   unchanged:saved.kind==='unchanged',eventId:saved.eventId,
   eventStatusUpdated});
 }catch(error){
  const code=Number((error as any)?.status);
  const status=[400,403,404,409,503].includes(code)?code:500;
  console.error('[AdminUpdateSupplierStatus] status update refused',
   error instanceof Error?error.name:'unknown');
  return Response.json({success:false,
   error:status===409?'Assignment changed; refresh the event and try again':
    status===500?'Could not update assignment':'Assignment status update unavailable'},
   {status});
 }
});
