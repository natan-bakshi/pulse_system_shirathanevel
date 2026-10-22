import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeWhatsAppSourceAudit,summarizePendingWhatsAppAudit} from '../base44/shared/whatsappSourceAudit.ts';

const notifications=[
 {id:'inapp-a',whatsapp_sent:false,template_type:'SUPPLIER_EVENT_REMINDER',created_date:'2026-10-17T10:00:00Z'},
 {id:'inapp-b',whatsapp_sent:true,template_type:'CLIENT_PAYMENT_REMINDER',created_date:'2026-10-17T10:00:00Z'},
 {id:'inapp-c',whatsapp_sent:true,template_type:'LEGACY_DIRECT',created_date:'2026-10-10T10:00:00Z'},
 {id:'inapp-d',whatsapp_sent:false,template_type:'PUSH_ONLY',created_date:'2026-10-17T10:00:00Z'}
];
const jobs=[
 {id:'job-a',in_app_notification_id:'inapp-a',source_type:'event_reminder',status:'accepted',created_date:'2026-10-17T11:00:00Z'},
 {id:'job-b',in_app_notification_id:'inapp-b',source_type:'client_payment_reminder',status:'unknown',created_date:'2026-10-17T11:00:00Z'},
 {id:'job-orphan',in_app_notification_id:'old-inapp-outside-sample',source_type:'other',status:'accepted'},
 {id:'job-unlinked',in_app_notification_id:'',source_type:'manual_text',status:'accepted'}
];
test('business reminder audit distinguishes pending scheduler from provider Outbox without exposing content',()=>{
 const now='2026-10-19T08:00:00Z';
 const items=[
  {id:'pending-1',template_type:'ADMIN_MISSING_ASSIGNMENT',scheduled_for:'2026-10-19T07:30:00Z',
   data:JSON.stringify({send_whatsapp:true,whatsapp_message:'PRIVATE_MESSAGE',phone:'0501234567'})},
  {id:'pending-2',template_type:'SUPPLIER_PENDING_REMINDER',scheduled_for:'2026-10-20T05:00:00Z',
   data:JSON.stringify({send_whatsapp:true,phone:'0501234567',idempotency_key:'stable-reminder'})},
  {id:'push-only',template_type:'TASK_DUE_REMINDER',scheduled_for:'2026-10-19T07:00:00Z',
   data:JSON.stringify({send_push:true,send_whatsapp:false})},
  {id:'corrupt',template_type:'ADMIN_MISSING_ASSIGNMENT',scheduled_for:'2026-10-19T07:00:00Z',data:'broken'}
 ];
 const result=summarizePendingWhatsAppAudit(items,now);
 assert.equal(result.sampledPending,4);
 assert.equal(result.whatsappWaiting,2);
 assert.equal(result.scheduledDue,1);
 assert.equal(result.scheduledFuture,1);
 assert.equal(result.withBusinessKey,1);
 assert.equal(result.legacyWithoutBusinessKey,1);
 assert.equal(result.malformedData,1);
 assert.equal(result.sampleTruncated,false);
 assert.equal(result.byTemplate.length,2);
 const safe=JSON.stringify(result);
 assert.equal(safe.includes('PRIVATE_MESSAGE'),false);
 assert.equal(safe.includes('0501234567'),false);
 assert.equal(safe.includes('stable-reminder'),false);
 assert.equal(result.noMessagesSent,true);
});
test('business reminder audit reports sample cap and never claims due means failed',()=>{
 const entries=Array.from({length:151},(_,i)=>({
   id:'p-'+i,template_type:'ADMIN_QUOTE_FOLLOWUP',
   scheduled_for:'2026-10-19T01:00:00Z',data:'{"send_whatsapp":true}'
 }));
 const summary=summarizePendingWhatsAppAudit(entries,'2026-10-19T08:00:00Z');
 assert.equal(summary.sampleTruncated,true);
 assert.equal(summary.whatsappWaiting,151);
 assert.equal(summary.scheduledDue,151);
 assert.match(summary.interpretation,/Due does not prove stuck/);
});
test('audit identifies mirror drift without confusing API acceptance with delivery',()=>{
 const r=summarizeWhatsAppSourceAudit(notifications,jobs,'2026-10-17T12:00:00Z');
 assert.equal(r.noMessagesSent,true);
 assert.equal(r.providerAcceptanceIsNotDelivery,true);
 assert.equal(r.acceptedWithoutMirror.length,1);
 assert.deepEqual(r.acceptedWithoutMirror[0],{
   inAppId:'inapp-a',jobId:'job-a',sourceType:'event_reminder',
   createdAt:'2026-10-17T11:00:00Z',classification:'provider_accepted_mirror_not_updated'
 });
 assert.equal(r.unknownWithSentMirror.length,1);
 assert.equal(r.unknownWithSentMirror[0].jobId,'job-b');
 assert.equal(r.unlinkedSentFlag.length,1);
 assert.equal(r.unlinkedSentFlag[0].classification,'legacy_or_unlinked_cannot_infer_delivery');
 assert.equal(r.unlinkedUnsentCount,1,'Push-only without WhatsApp link is not automatically an error');
 assert.equal(r.sourceOutsideSample.length,1,'Not in a sample is not proof missing');
 assert.equal(r.sourceOutsideSample[0].jobId,'job-orphan');
 assert.equal(JSON.stringify(r).includes('0501234567'),false);
});
test('read-only audit finds the two VERIFIED assignment duplicate timestamp formats',()=>{
 const ids={service:'service-abc123',supplier:'supplier-abc123'};
 const mk=(id,date,status='accepted',supplier=ids.supplier)=>({
   id,source_type:'assignment_new',event_service_id:ids.service,supplier_id:supplier,
   status,created_date:'2026-10-18T10:22:21Z',
   idempotency_key:['assignment',ids.service,supplier,date,'SUPPLIER_NEW_ASSIGNMENT'].join(':')
 });
 const jobs=[
   mk('accepted-micro','2026-10-18T10:22:19.719051'),
   mk('accepted-milli','2026-10-18T10:22:19.719000'),
   mk('next-revision','2026-10-18T10:22:20.719000'),
   mk('another-supplier','2026-10-18T10:22:19.719000','accepted','supplier-other')
 ];
 const a=summarizeWhatsAppSourceAudit([],jobs,'2026-10-18T10:23:00Z');
 assert.equal(a.duplicateAssignments.length,1,'Only the same supplier and same millisecond are duplicates');
 assert.deepEqual(a.duplicateAssignments[0].jobIds,['accepted-micro','accepted-milli']);
 assert.deepEqual(a.duplicateAssignments[0].statuses,['accepted','accepted']);
 assert.equal(a.duplicateAssignments[0].distinctRawKeys,2);
 assert.equal(a.duplicateAssignments[0].classification,'duplicate_assignment_business_version');
 assert.equal(a.noMessagesSent,true);
});
test('audit never outputs message text or phone numbers even if model payload contains them',()=>{
 const notes=[{id:'inapp-secret',whatsapp_sent:true,template_type:'PRIVATE',
   message:'THE_MESSAGE_SECRET',phone:'0501234567'}];
 const docs=[{id:'job-secret',in_app_notification_id:'inapp-secret',status:'unknown',
   message_text:'THE_MESSAGE_SECRET',chat_id:'972501234567@c.us'}];
 const result=JSON.stringify(summarizeWhatsAppSourceAudit(notes,docs,'2026-10-17T12:00:00Z'));
 for(const p of ['THE_MESSAGE_SECRET','0501234567','972501234567@c.us'])assert.ok(!result.includes(p));
});
test('audit caps per-category UI samples and labels samples, never full history',()=>{
 const many=Array.from({length:60},(_,i)=>({id:'old-'+i,whatsapp_sent:true}));
 const r=summarizeWhatsAppSourceAudit(many,[],'2026-10-17T12:00:00Z');
 assert.equal(r.unlinkedSentFlag.length,25);
 assert.equal(r.cappedSamples,true);
 assert.equal(r.sampledInApp,60);
});

test('payment reminder audit separates accepted, pending, unknown and email/legacy without private data',async()=>{
 const {summarizePaymentReminderAudit}=await import('../base44/shared/whatsappSourceAudit.ts');
 const rows=[
  {id:'pay-1',link_expires_at:'2026-10-25T00:00:00Z',link_reminder_sent:false,payer_phone:'PRIVATE_PHONE'},
  {id:'pay-2',link_expires_at:'2026-10-25T00:00:00Z',link_reminder_sent:true},
  {id:'pay-3',link_expires_at:'2026-10-25T00:00:00Z',link_reminder_sent:false},
  {id:'pay-4',link_expires_at:'2026-10-25T00:00:00Z',link_reminder_sent:true}
 ];
 const mk=(id,status)=>({id:'job-'+id,source_type:'client_billing',status,
  idempotency_key:'payment-link-reminder:'+id+':2026-10-25T00:00:00Z',message_text:'PRIVATE_BODY'});
 const r=summarizePaymentReminderAudit(rows,[mk('pay-1','accepted'),mk('pay-2','unknown'),mk('pay-3','queued')]);
 assert.equal(r.acceptedWithoutFlag,1);
 assert.equal(r.unknownWithFlag,1);
 assert.equal(r.pendingWithOutbox,1);
 assert.equal(r.flaggedWithoutSampledReceipt,1);
 assert.equal(r.noMessagesSent,true);
 assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
