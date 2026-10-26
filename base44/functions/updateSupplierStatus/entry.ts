import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { recalculateEventStatus } from '../../shared/eventReadiness.ts';
import { persistAuthorizedSupplierStatus } from '../../shared/supplierStatusPersistence.ts';

// Existing supplier dashboard endpoint. Never accepts a channel/source selector
// from a client; WhatsApp calls will require separate authenticated admission.
Deno.serve(async(req)=>{
  if(req.method&&req.method!=='POST')
    return Response.json({error:'Method not allowed'},{status:405});
  try{
    const base44=createClientFromRequest(req);
    const user=await base44.auth.me();
    if(!user)return Response.json({error:'Unauthorized'},{status:401});
    const body=await req.json().catch(()=>({}));
    const {eventServiceId,newStatus}=body;
    if(!eventServiceId||!newStatus)
      return Response.json({error:'Missing required fields'},{status:400});
    if(!['pending','confirmed','rejected'].includes(newStatus))
      return Response.json({error:'Invalid status value'},{status:400});

    // Preserve the existing dashboard identity binding. A future webhook MUST
    // NOT treat a claimed phone number or client-supplied supplier ID as proof.
    const suppliers=await base44.asServiceRole.entities.Supplier.list();
    const email=typeof user.email==='string'?user.email.toLowerCase():'';
    const phone=user.phone;
    const matchingSupplier=suppliers.find(s=>
      (email&&Array.isArray(s.contact_emails)&&
       s.contact_emails.some(contact=>typeof contact==='string'&&contact.toLowerCase()===email))||
      (phone&&s.phone===phone)
    );
    if(!matchingSupplier)
      return Response.json({error:'No supplier profile found for this user'},{status:403});

    const saved=await persistAuthorizedSupplierStatus(base44.asServiceRole,{
      eventServiceId,supplierId:matchingSupplier.id,newStatus,source:'dashboard'
    });
    const eventStatus=await recalculateEventStatus(base44.asServiceRole,saved.eventId);
    return Response.json({
      success:true,status:newStatus,eventId:saved.eventId,
      newStatus:eventStatus.newStatus,...(saved.kind==='unchanged'?{unchanged:true}:{})
    });
  }catch(error){
    const code=Number((error as any)?.status);
    const status=[400,401,403,404,409,503].includes(code)?code:500;
    console.error('[updateSupplierStatus] error class:',error instanceof Error?error.name:'unknown');
    return Response.json({error:status===500?'Could not update supplier status':
      String((error as any)?.message||'Supplier status update unavailable')},{status});
  }
});
