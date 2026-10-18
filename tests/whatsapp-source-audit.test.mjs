import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeWhatsAppSourceAudit} from '../base44/shared/whatsappSourceAudit.ts';

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
