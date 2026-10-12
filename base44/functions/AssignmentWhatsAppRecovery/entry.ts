import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';
import { candidateFromLive, israelDay } from '../../shared/assignmentRecovery.ts';
import { resolveWhatsAppProvider, hasSelectedWhatsAppProviderCredentials } from '../../shared/whatsappProviderConfig.ts';
import { sendWhatsAppToChat } from '../../shared/whatsappSend.ts';
import { checkWasenderSessionStatus } from '../../shared/wasenderSend.ts';

const MAX_BATCH = 80;
const RECOVERY_SEND_INTERVAL_MS = 70_000; // Trial allows only one message per minute.
const ALLOWED_HOURS = new Set([8,24,48,72]);
const OWNER_EMAIL = 'natib8000@gmail.com';
const reply = (body: unknown, status = 200) => Response.json(body, {status});
const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,90}$/.test(value);

async function inventory(base44: any, hours: number) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const services = await base44.asServiceRole.entities.EventService.filter(
    { updated_date: { $gte: since } }, '-updated_date', 500
  );
  if (!Array.isArray(services)) throw new Error('EventService inventory is unavailable');
  if (services.length >= 500) throw new Error('Too many changed services; narrow the time window before recovery');
  const [events, suppliers, serviceTypes, templates, history] = await Promise.all([
    base44.asServiceRole.entities.Event.list(),
    base44.asServiceRole.entities.Supplier.list(),
    base44.asServiceRole.entities.Service.list(),
    base44.asServiceRole.entities.NotificationTemplate.filter({ type: 'SUPPLIER_NEW_ASSIGNMENT', is_active: true }),
    base44.asServiceRole.entities.AssignmentMessageRecovery.list('-created_date', 500)
  ]);
  const template = templates?.[0];
  if (!template || !template.allowed_channels?.includes('whatsapp')) {
    throw new Error('Supplier assignment WhatsApp template is missing or disabled');
  }
  const eventById = new Map(events.map((item: any)=>[item.id,item]));
  const supplierById = new Map(suppliers.map((item: any)=>[item.id,item]));
  const serviceById = new Map(serviceTypes.map((item: any)=>[item.id,item]));
  const priorByKey = new Map<string,any>();
  for (const prior of history) {
    if (!priorByKey.has(prior.recovery_key)) priorByKey.set(prior.recovery_key, prior);
  }
  const items: any[] = [];
  const incidentDate = israelDay();
  for(const service of services) {
    if(service.is_external)continue;
    let ids: string[] = [];
    try { ids = typeof service.supplier_ids === 'string' ? JSON.parse(service.supplier_ids || '[]') : service.supplier_ids || []; } catch {}
    if (!Array.isArray(ids)) continue;
    for(const supplierId of ids){
      const candidate=candidateFromLive(service, supplierById.get(String(supplierId)), eventById.get(service.event_id), serviceById.get(service.service_id), template, incidentDate);
      if(!candidate)continue;
      const prior=priorByKey.get(candidate.recoveryKey);
      items.push({
        eventServiceId: candidate.eventServiceId, eventId:candidate.eventId, supplierId:candidate.supplierId,
        eventName:candidate.eventName, supplierName:candidate.supplierName, serviceName:candidate.serviceName,
        eventDate:candidate.eventDate, eventTime:candidate.eventTime, updatedAt:candidate.updatedAt,
        channel:candidate.channel, message:candidate.message,
        recoveryState:prior?.state||'not_prepared',
        approvedForReplay:prior?.approved_for_replay === true,
        recoveryId:prior?.id||''
      });
    }
  }
  return { items, incidentDate, changedServices:services.length };
}

async function queueStatus(base44: any) {
  const records = await base44.asServiceRole.entities.AssignmentMessageRecovery.list('-created_date', 500);
  const byState:Record<string,number>={};
  for (const item of records) {
    byState[item.state]=(byState[item.state]||0)+1;
    if(item.state==='queued') {
      const key=item.approved_for_replay === true ? 'ready_to_send' : 'waiting_review';
      byState[key]=(byState[key]||0)+1;
    }
  }
  return {
    summary: byState,
    rows: records.map((x:any)=>({
      id:x.id, eventServiceId:x.event_service_id, supplierId:x.supplier_id, incidentDate:x.incident_date,
      state:x.state, approvedForReplay:x.approved_for_replay===true, provider:x.provider||'', attemptedAt:x.attempted_at||'',
      completedAt:x.completed_at||'', errorCode:x.error_code||null, attemptCount:x.attempt_count||0,
      messageId:!!x.provider_message_id
    }))
  };
}

async function ensureLiveRecipient(client:any, row:any) {
  const [svc,supplier,event,template] = await Promise.all([
    client.asServiceRole.entities.EventService.get(row.event_service_id),
    client.asServiceRole.entities.Supplier.get(row.supplier_id),
    client.asServiceRole.entities.Event.get(row.event_id),
    client.asServiceRole.entities.NotificationTemplate.filter({type:'SUPPLIER_NEW_ASSIGNMENT',is_active:true})
  ]);
  if (!template?.length) return null;
  const source=svc?.service_id ? await client.asServiceRole.entities.Service.get(svc.service_id).catch(()=>null) : null;
  return candidateFromLive(svc,supplier,event,source,template[0],row.incident_date);
}

Deno.serve(async (req) => {
  if(req.method!=='POST') return reply({success:false,error:'Method not allowed'},405);
  try {
    const base44=createClientFromRequest(req);
    const user=await base44.auth.me().catch(()=>null);
    if(!user)return reply({success:false,error:'Unauthorized'},401);
    if(user.role!=='admin'||String(user.email||'').toLowerCase()!==OWNER_EMAIL) return reply({success:false,error:'Only system owner can perform recovery'},403);
    let body:any;
    try {body=await req.json();}catch{return reply({success:false,error:'Invalid payload'},400)}
    const action=body?.action;
    if(action==='status') return reply({success:true,...await queueStatus(base44)});
    if(action==='preview'){
      const hours=Number(body.hours || 8);
      if(!ALLOWED_HOURS.has(hours))return reply({success:false,error:'Invalid time window'},400);
      const view=await inventory(base44,hours);
      return reply({success:true,...view,...await queueStatus(base44)});
    }
    if(action==='prepare'){
      const hours=Number(body.hours||8);
      const selected=body.selection;
      if(!ALLOWED_HOURS.has(hours)||!Array.isArray(selected)||selected.length===0||selected.length>MAX_BATCH) {
        return reply({success:false,error:'Choose between 1 and 80 valid assignments'},400);
      }
      if(selected.some((x:any)=>!validId(x?.eventServiceId)||!validId(x?.supplierId))) {
        return reply({success:false,error:'Invalid assignment identifiers'},400);
      }
      const desired=[...new Set(selected.map((x:any)=>x.eventServiceId+'|'+x.supplierId))];
      if(desired.length!==selected.length) return reply({success:false,error:'Repeated assignment selection'},400);
      const view=await inventory(base44,hours);
      const candidates=new Map(view.items.map((x:any)=>[x.eventServiceId+'|'+x.supplierId,x]));
      const prior=await base44.asServiceRole.entities.AssignmentMessageRecovery.list('-created_date',500);
      const byKey=new Map(prior.map((r:any)=>[r.recovery_key,r]));
      let prepared=0,excluded=0;
      for(const tuple of desired){
        const candidate:any=candidates.get(tuple);
        if(!candidate){excluded++;continue;}
        const key=view.incidentDate+'|'+candidate.eventServiceId+'|'+candidate.supplierId;
        const oldRow:any=byKey.get(key);
        if(oldRow){
          if(oldRow.state==='queued' && oldRow.approved_for_replay !== true){
            await base44.asServiceRole.entities.AssignmentMessageRecovery.update(oldRow.id,{approved_for_replay:true,created_by_admin_id:user.id});
            prepared++;
          } else excluded++;
          continue;
        }
        await base44.asServiceRole.entities.AssignmentMessageRecovery.create({
          recovery_key:key,incident_date:view.incidentDate,event_id:candidate.eventId,
          event_service_id:candidate.eventServiceId,supplier_id:candidate.supplierId,
          state:'queued',approved_for_replay:true,message_snapshot:candidate.message,attempt_count:0,
          created_by_admin_id:user.id
        });
        byKey.set(key,{recovery_key:key,state:'queued',approved_for_replay:true});prepared++;
      }
      return reply({success:true,prepared,excluded,...await queueStatus(base44)});
    }
    if(action==='sendNext'){
      const entities=base44.asServiceRole.entities.AssignmentMessageRecovery;
      const recent=await entities.filter({attempted_at:{$gte:new Date(Date.now()-RECOVERY_SEND_INTERVAL_MS).toISOString()}},'-attempted_at',3);
      if(recent.length>0){
        const last=Date.parse(recent[0].attempted_at);
        return reply({success:true,waitingSeconds:Math.max(1,Math.ceil((RECOVERY_SEND_INTERVAL_MS-(Date.now()-last))/1000)),...await queueStatus(base44)});
      }
      const stale=await entities.filter({state:'dispatching'},'-attempted_at',50);
      if(stale.length>0){
        // Crash/timeout after claiming could mean a message was accepted. Never resume automatically.
        const oldest=stale.filter((r:any)=>Date.now()-Date.parse(r.attempted_at||'')>300_000);
        for(const row of oldest) await entities.updateMany({id:row.id,state:'dispatching'},{$set:{state:'unknown',last_error:'Recovery attempt interrupted; delivery requires manual review',completed_at:new Date().toISOString()}});
        const active=stale.length-oldest.length;
        if(active>0)return reply({success:true,waitingSeconds:70,blocked:'Another recovery send is in progress',...await queueStatus(base44)});
      }
      const queue=await entities.filter({state:'queued',approved_for_replay:true},'created_date',100);
      if(!queue.length)return reply({success:true,finished:true,...await queueStatus(base44)});
      const provider=await resolveWhatsAppProvider(base44);
      if(!(await hasSelectedWhatsAppProviderCredentials(base44))) return reply({success:false,error:'Active WhatsApp provider credentials are missing'},409);
      if(provider==='wasender'){
        const status=await checkWasenderSessionStatus();
        if(!status.connected) return reply({success:false,error:'WasenderAPI is not connected; no messages sent'},409);
      }
      const row=queue[0];
      const candidate=await ensureLiveRecipient(base44,row);
      if(!candidate){
        await entities.updateMany({id:row.id,state:'queued'},{$set:{state:'skipped',last_error:'Assignment is no longer pending or recipient is unavailable',completed_at:new Date().toISOString()}});
        return reply({success:true,skipped:true,...await queueStatus(base44)});
      }
      // Only the original reviewed text may be sent. A changed event requires a new preview/plan.
      if(row.message_snapshot!==candidate.message){
        await entities.updateMany({id:row.id,state:'queued'},{$set:{state:'skipped',last_error:'Assignment details changed since preview; review again',completed_at:new Date().toISOString()}});
        return reply({success:true,skipped:true,...await queueStatus(base44)});
      }
      const now=new Date().toISOString();
      const claim=await entities.updateMany({id:row.id,state:'queued'},{$set:{
        state:'dispatching',attempted_at:now,attempt_count:Number(row.attempt_count||0)+1,provider
      }});
      if(claim?.updated!==1) return reply({success:true,waitingSeconds:2,...await queueStatus(base44)});
      // Two browser tabs must not send separate recipients simultaneously.
      const activeClaims = await entities.filter({state:'dispatching'},'attempted_at',20);
      if(activeClaims.length>1){
        const winner=[...activeClaims].sort((a:any,b:any)=>String(a.attempted_at||'').localeCompare(String(b.attempted_at||''))||String(a.id).localeCompare(String(b.id)))[0];
        if(winner.id!==row.id){
          await entities.updateMany({id:row.id,state:'dispatching'},{$set:{state:'queued',attempted_at:''}});
          return reply({success:true,waitingSeconds:70,blocked:'Another recovery dispatch has the send slot',...await queueStatus(base44)});
        }
      }
      try{
        const result=await sendWhatsAppToChat(candidate.destination,row.message_snapshot,base44);
        await entities.update(row.id,{state:'accepted',provider_message_id:result.messageId||'',completed_at:new Date().toISOString(),last_error:''});
        return reply({success:true,sent:true,deliveryStatus:'accepted_not_delivered',waitingSeconds:70,...await queueStatus(base44)});
      } catch(error){
        const code=Number((error as any)?.errorCode||0);
        const uncertain=(error as any)?.deliveryUncertain===true;
        const attempts=Number(row.attempt_count||0)+1;
        const state=uncertain?'unknown':code===429&&attempts<3?'queued':'rejected';
        await entities.update(row.id,{
          state, error_code:code||502,
          last_error:uncertain?'Provider response inconclusive; do not resend automatically':code===429?'Provider rate limit (429)':'Provider rejected recovery message',
          completed_at:new Date().toISOString()
        });
        return reply({success:true,sent:false,errorCode:code||502,recoveryState:state,waitingSeconds:70,...await queueStatus(base44)});
      }
    }
    return reply({success:false,error:'Unsupported action'},400);
  }catch(error){
    console.error('[AssignmentWhatsAppRecovery] failed:',error instanceof Error?error.name:'error');
    return reply({success:false,error:'Recovery request failed; no bulk sends were initiated automatically'},500);
  }
});
