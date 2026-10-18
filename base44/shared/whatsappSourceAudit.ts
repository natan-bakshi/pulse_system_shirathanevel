import {canonicalAssignmentUpdatedDate} from './assignmentWhatsApp.ts';
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
  // Group only ORIGINAL legacy assignment keys: V2 revision-based keys are
  // intentionally a separate scheme. Group equivalent UTC millisecond
  // instants, not raw 6-digit microsecond strings. This reveals the exact
  // incident where two independently accepted Green API jobs had timestamps
  // .719000 vs .719051 for one EventService/supplier assignment.
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
