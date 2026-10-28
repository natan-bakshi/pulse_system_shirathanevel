import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { sendWhatsAppToChat, toChatId } from '../../shared/whatsappSend.ts';
import { readWhatsAppQueueControl } from '../../shared/whatsappOutbox.ts';
import { resolveNotificationDelay } from '../../shared/quietHours.ts';
import { assignmentWhatsAppContext, renderAssignmentWhatsApp, supplierAssignmentTargetChatId, supplierTargetChatId } from '../../shared/assignmentWhatsApp.ts';

// Reliable, explicit supplier-notification safeguard called *after* successful
// EventService saves. It does not change assignments. Entity triggers may run
// concurrently; both paths use the same idempotency key.
Deno.serve(async(req)=>{
  if(req.method!=='POST')return Response.json({success:false,error:'Method not allowed'},{status:405});
  try{
    const client=createClientFromRequest(req);
    const actor=await client.auth.me().catch(()=>null);
    if(actor?.role!=='admin')return Response.json({success:false,error:'Administrator required'},{status:403});
    const body=await req.json().catch(()=>({}));
    const eventServiceId=String(body.eventServiceId||'');
    const requested=body.newSupplierIds;
    if(!/^[a-zA-Z0-9_-]{8,100}$/.test(eventServiceId)||
      !Array.isArray(requested)||requested.length>40||requested.some(x=>typeof x!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(x))){
      return Response.json({success:false,error:'Invalid assignment notification request'},{status:400});
    }
    const ids=[...new Set(requested)];
    if(ids.length===0)return Response.json({success:true,requested:0,queued:0,accepted:0,skipped:0});
    const db=client.asServiceRole.entities;
    const svc=await db.EventService.get(eventServiceId);
    if(!svc||svc.is_external)return Response.json({success:false,error:'Event service is unavailable or external'},{status:409});
    const assigned=typeof svc.supplier_ids==='string'?JSON.parse(svc.supplier_ids||'[]'):svc.supplier_ids||[];
    const statuses=typeof svc.supplier_statuses==='string'?JSON.parse(svc.supplier_statuses||'{}'):svc.supplier_statuses||{};
    if(!Array.isArray(assigned))throw new Error('Malformed supplier assignments');
    // Independent reads happen together. Before this change every assignment
    // save waited for Event, Template, QueueControl and Service sequentially.
    const [event,templates,control,service]=await Promise.all([
      db.Event.get(svc.event_id),
      db.NotificationTemplate.filter({type:'SUPPLIER_NEW_ASSIGNMENT',is_active:true},'-created_date',2),
      readWhatsAppQueueControl(client),
      svc.service_id?db.Service.get(svc.service_id).catch(()=>null):Promise.resolve(null)
    ]);
    if(!event||['cancelled','completed'].includes(event.status)){
      return Response.json({success:false,error:'Event is no longer eligible for supplier notifications'},{status:409});
    }
    const template=templates[0];
    if(!template || !(template.allowed_channels||[]).includes('whatsapp')){
      return Response.json({success:true,requested:ids.length,queued:0,accepted:0,skipped:ids.length,
        reason:'WhatsApp assignment template is intentionally disabled'});
    }
    const textTemplate=template.whatsapp_body_template||template.body_template||'';
    const result={success:true,requested:ids.length,queued:0,accepted:0,skipped:0,errors:[] as string[],jobIds:[] as string[]};
    // Fetch contacts concurrently in bounded groups, but retain sequential
    // queue insertion to respect the one global idempotency/ordering lock.
    const suppliers=new Map<string,any>();
    for(let i=0;i<ids.length;i+=8){
      const chunk=ids.slice(i,i+8);
      const records=await Promise.all(chunk.map(id=>db.Supplier.get(id).catch(()=>null)));
      chunk.forEach((id,j)=>suppliers.set(id,records[j]));
    }
    for(const supplierId of ids){
      try{
        if(!assigned.includes(supplierId)||(statuses?.[supplierId]&&statuses[supplierId]!=='pending')){
          result.skipped++;continue;
        }
        const supplier=suppliers.get(supplierId);
        if(!supplier||supplier.whatsapp_enabled===false){result.skipped++;continue;}
        const chatId=supplierAssignmentTargetChatId(supplier,svc,supplierId,
          toChatId,k=>Deno.env.get(k));
        if(!chatId){result.errors.push('Supplier '+supplierId+': WhatsApp destination missing');continue;}
        const text=renderAssignmentWhatsApp(textTemplate,event,svc,supplier,service?.service_name||'');
        if(!text){result.errors.push('Supplier '+supplierId+': WhatsApp content missing');continue;}
        const delay=resolveNotificationDelay(supplier);
        if(delay.shouldDelay && control.enabled!==true){
          result.errors.push('Supplier '+supplierId+': quiet hours require central queue to be active');
          continue;
        }
        const response=await sendWhatsAppToChat(chatId,text,client,
          assignmentWhatsAppContext(svc,supplierId,template.type,delay));
        // A duplicate key may refer to an old FAILED/UNKNOWN/EXPIRED job.
        // It is NOT success and must never silently become "skipped":
        // this is precisely how managers lose confidence that notifications
        // were sent. We report the existing state but do not re-enqueue it.
        if(response.queued===true && ['queued','retry_wait','sending'].includes(response.status)) {
          result.queued++;
        } else if(response.status==='accepted' || response.legacyDirect===true) {
          result.accepted++;
        } else if(response.deduplicated && ['unknown','failed','cancelled','expired','resolved'].includes(response.status)) {
          result.errors.push('Supplier '+supplierId+': previous WhatsApp message is '+response.status+'; manual review required, not automatically resent');
        } else {
          result.errors.push('Supplier '+supplierId+': WhatsApp was not confirmed as queued or accepted');
        }
        if(response.jobId)result.jobIds.push(response.jobId);
      }catch(error){
        const code=Number((error as any)?.errorCode)||0;
        result.errors.push('Supplier '+supplierId+': queue insertion failed'+(code?' ('+code+')':''));
        console.error('[EnsureAssignmentWhatsApp] Could not queue supplier assignment:',supplierId,
          error instanceof Error?error.name:'unknown');
      }
    }
    result.success=result.errors.length===0;
    return Response.json(result,{status:result.success?200:207});
  }catch(error){
    console.error('[EnsureAssignmentWhatsApp] request failure:',error instanceof Error?error.name:'unknown');
    return Response.json({success:false,error:'Assignment WhatsApp queue verification failed'},{status:500});
  }
});
