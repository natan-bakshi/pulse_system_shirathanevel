import {canonicalAssignmentUpdatedDate} from './assignmentWhatsApp.ts';

// The business scheduler is NOT the transport Outbox. A pending, conditional
// reminder can be healthy while WhatsAppOutbox is empty. Return only coarse
// counts; never expose its JSON data (which contains private phones/content).
// Older rows without idempotency_key still have a per-row scheduled-wa:<id>
// fallback later, but cannot dedupe two different Pending rows for one intent.
export function summarizePendingWhatsAppAudit(rows:any[],nowIso:string,maxSample=151){
  const now=Date.parse(String(nowIso||''));
  let whatsappWaiting=0,withBusinessKey=0,legacyWithoutBusinessKey=0;
  let scheduledFuture=0,scheduledDue=0,invalidScheduledTime=0,malformedData=0;
  const byTemplate=new Map<string,number>();
  for(const row of rows||[]){
    let data:any={};
    try{data=row.data?JSON.parse(row.data):{};}catch{malformedData++;continue;}
    if(data?.send_whatsapp!==true)continue;
    whatsappWaiting++;
    if(typeof data.idempotency_key==='string'&&data.idempotency_key.trim())withBusinessKey++;
    else legacyWithoutBusinessKey++;
    const due=Date.parse(String(row.scheduled_for||''));
    if(!Number.isFinite(due)||!Number.isFinite(now))invalidScheduledTime++;
    else if(due>now)scheduledFuture++;
    else scheduledDue++;
    const type=String(row.template_type||'unknown').slice(0,80);
    byTemplate.set(type,(byTemplate.get(type)||0)+1);
  }
  return {
    sampledPending:rows?.length||0,
    sampleTruncated:(rows?.length||0)>=maxSample,
    whatsappWaiting,withBusinessKey,legacyWithoutBusinessKey,
    scheduledFuture,scheduledDue,invalidScheduledTime,malformedData,
    byTemplate:[...byTemplate.entries()].sort((a,b)=>b[1]-a[1])
      .slice(0,20).map(([templateType,count])=>({templateType,count})),
    noMessagesSent:true,providerAcceptanceIsNotDelivery:true,
    interpretation:'Business reminders awaiting their time/condition are NOT yet WhatsAppOutbox jobs. Due does not prove stuck; verify the scheduled worker separately.'
  };
}

// Read-only grouping of SAME supplier + EventService + canonical save
// timestamp. Independent edits minutes apart must not be conflated.
// This function NEVER contacts the provider or changes queue records.
export function findDuplicateAssignmentVersions(jobs:any[],limit=25){
  const assignmentGroups=new Map<string,any[]>();
  for(const job of jobs||[]){
    if(job?.source_type!=='assignment_new')continue;
    const key=String(job.idempotency_key||'');
    const match=key.match(/^assignment:([^:]+):([^:]+):(.+):SUPPLIER_NEW_ASSIGNMENT$/);
    if(!match||!/^\d{4}-\d{2}-\d{2}T/.test(match[3]))continue;
    if(job.event_service_id && String(job.event_service_id)!==match[1])continue;
    if(job.supplier_id && String(job.supplier_id)!==match[2])continue;
    const groupKey=[match[1],match[2],canonicalAssignmentUpdatedDate(match[3])].join('|');
    const group=assignmentGroups.get(groupKey)||[];
    group.push(job);assignmentGroups.set(groupKey,group);
  }
  const duplicateAssignments:any[]=[];
  for(const group of assignmentGroups.values()){
    if(group.length<2 || duplicateAssignments.length>=limit)continue;
    const first=String(group[0].idempotency_key||'').match(/^assignment:([^:]+):([^:]+):/);
    duplicateAssignments.push({
      eventServiceId:first?.[1]||'',supplierId:first?.[2]||'',
      jobIds:group.map(j=>String(j.id)).slice(0,8),
      statuses:group.map(j=>String(j.status||'')).slice(0,8),
      createdAt:group[0].created_date||null,
      distinctRawKeys:new Set(group.map(j=>j.idempotency_key)).size,
      classification:'duplicate_assignment_business_version'
    });
  }
  return duplicateAssignments;
}

// Read-only reconciliation between Outbox receipts and InApp mirrors.
// Sampled records cannot prove historical delivery or non-delivery: legacy
// WhatsApp sends preceded the central Outbox, and Push-only notifications
// legitimately have no WhatsApp job.
export function summarizeWhatsAppSourceAudit(notifications:any[],jobs:any[],nowIso:string){
  const source=new Map((notifications||[]).map(n=>[String(n.id),n]));
  const linked=new Map<string,any[]>();
  for(const job of jobs||[]){
    if(!job?.in_app_notification_id)continue;
    const id=String(job.in_app_notification_id);
    const rows=linked.get(id)||[];
    rows.push(job);linked.set(id,rows);
  }
  const acceptedWithoutMirror:any[]=[];
  const unknownWithSentMirror:any[]=[];
  const unlinkedSentFlag:any[]=[];
  const unlinkedUnsentCount={value:0};
  const withoutRecentSource:any[]=[];
  const limit=25;
  const duplicateAssignments=findDuplicateAssignmentVersions(jobs,limit);
  for(const job of jobs||[]){
    const id=String(job?.in_app_notification_id||'');
    if(id && !source.has(id) && withoutRecentSource.length<limit){
      withoutRecentSource.push({
        jobId:String(job.id),inAppId:id,status:String(job.status||''),
        sourceType:String(job.source_type||''),createdAt:job.created_date||null
      });
    }
  }
  for(const note of notifications||[]){
    const id=String(note.id);
    const receipts=linked.get(id)||[];
    if(!receipts.length){
      if(note.whatsapp_sent===true){
        if(unlinkedSentFlag.length<limit)unlinkedSentFlag.push({
          inAppId:id,templateType:String(note.template_type||''),createdAt:note.created_date||null,
          classification:'legacy_or_unlinked_cannot_infer_delivery'
        });
      }else unlinkedUnsentCount.value++;
      continue;
    }
    if(receipts.some(r=>r.status==='accepted') && note.whatsapp_sent!==true &&
       acceptedWithoutMirror.length<limit){
      const r=receipts.find(x=>x.status==='accepted');
      acceptedWithoutMirror.push({
        inAppId:id,jobId:String(r.id),sourceType:String(r.source_type||''),
        createdAt:r.created_date||null,classification:'provider_accepted_mirror_not_updated'
      });
    }
    if(receipts.some(r=>r.status==='unknown') && note.whatsapp_sent===true &&
       unknownWithSentMirror.length<limit){
      const r=receipts.find(x=>x.status==='unknown');
      unknownWithSentMirror.push({
        inAppId:id,jobId:String(r.id),createdAt:r.created_date||null,
        classification:'unknown_transport_but_source_flag_true'
      });
    }
  }
  return {
    sampledAt:nowIso,sampledInApp:notifications?.length||0,sampledOutbox:jobs?.length||0,
    cappedSamples:true,providerAcceptanceIsNotDelivery:true,noMessagesSent:true,
    acceptedWithoutMirror,unknownWithSentMirror,unlinkedSentFlag,duplicateAssignments,
    sourceOutsideSample:withoutRecentSource,
    unlinkedUnsentCount:unlinkedUnsentCount.value,
    caveat:'No linked Outbox row does not prove a WhatsApp error (legacy/PUSH-only/outside sample).'
  };
}
