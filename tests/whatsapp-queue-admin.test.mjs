import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {delayUntilNextSendMs,providerIntervalMs,lastDispatchForProvider} from '../base44/shared/whatsappQueueWorker.ts';
import {summarizeWhatsAppOutbox} from '../base44/shared/whatsappQueueMetrics.ts';
import {summarizeInboundWhatsAppReceipts} from '../base44/shared/whatsappInboundAudit.ts';
import {inspectInboundReceiptReadOnly} from '../base44/shared/whatsappInboundInvestigation.ts';
import {summarizeWhatsAppInteractiveReadiness} from '../base44/shared/whatsappInteractiveReadiness.ts';
import {greenButtonQaSafeSummary} from '../base44/shared/greenButtonQaLaunch.ts';
import {inspectGreenButtonQaAssignmentReadOnly} from '../base44/shared/greenButtonQaAssignmentPreflight.ts';
import {enrollOneGreenButtonQaAssignment} from '../base44/shared/greenButtonQaEnrollment.ts';
import {inspectOfficeAssignmentReference} from '../base44/shared/whatsappOfficeReferenceLookup.ts';
import {inspectUnknownGreenQuarantineReadOnly} from '../base44/shared/greenUnknownCallbackQuarantine.ts';
import {scrubExpiredUnknownGreenRecoveryOnDemand} from '../base44/shared/greenUnknownRecoveryCleanup.ts';
import {inspectUnknownGreenRecoveryStructureReadOnly} from '../base44/shared/greenUnknownRecoveryReview.ts';
import {fingerprintUnknownGreenCallback} from '../base44/shared/greenUnknownCallbackQuarantine.ts';
import {encryptUnknownGreenRecovery} from '../base44/shared/greenUnknownRecoveryEnvelope.ts';
import {summarizeWhatsAppSourceAudit,summarizePendingWhatsAppAudit,summarizePaymentReminderAudit,summarizeTaskWhatsAppAudit,findDuplicateAssignmentVersions} from '../base44/shared/whatsappSourceAudit.ts';

const UNIT_RECOVERY_KEY=Buffer.alloc(32,31).toString('base64url');
const UNIT_SIGNING_SECRET='synthetic-owner-admin-action-signing-secret-123456789';
function context({actor={role:'admin',email:'natib8000@gmail.com'},state={},jobs=[],notifications=[],pendingRows=[],inboundRows=[],quarantineRows=[],officeServices=[],officeEvents=[],officeSuppliers=[]}={}){
 const record={id:'control',control_key:'global',enabled:false,paused:false,
   green_interval_ms:7000,wasender_interval_ms:7000,max_messages_per_run:16,
   lease_owner:'',lease_until:'',last_dispatched_at:'',last_worker_at:'',...state};
 const syncs=[],calls=[],interactiveOps=[],listProjections=[],pendingProjections=[],inboundProjections=[],unknownProjections=[],cleanupReads=[],cleanupWrites=[],officeReads=[],greenAudits=[];
 const matches=(record,query)=>Object.entries(query||{}).every(([key,val])=>{
   if(val&&typeof val==='object'&&('$in' in val))return val.$in.includes(record[key]);
   if(val&&typeof val==='object'&&('$lte' in val))
    return typeof record[key]==='string'&&record[key]<=val.$lte;
   return record[key]===val;
 });
 const jobEntity={
   list:async(_sort,limit=500,offset=0,fields)=>{listProjections.push(fields);return jobs.slice(offset,offset+limit);},
   filter:async(query,_sort,limit=500,offset=0)=>jobs.filter(x=>matches(x,query)).slice(offset,offset+limit),
   get:async(id)=>{officeReads.push('outbox');return jobs.find(x=>x.id===id)||null;},
   updateMany:async(query,{ $set })=>{
     const found=jobs.filter(x=>matches(x,query));
     for(const job of found)Object.assign(job,$set);
     return {updated:found.length};
   }
 };
 const client={auth:{me:async()=>actor},asServiceRole:{entities:{
   WhatsAppQueueControl:{update:async(_id,patch)=>Object.assign(record,patch),
     filter:async()=>[record]},
   EventService:{filter:async()=>[],get:async id=>{
     officeReads.push('service');
     return officeServices.length?officeServices.find(x=>x.id===id)||null:{
       id:'service-123',supplier_statuses:'{"supplier-123":"confirmed"}',
       assignment_intent_mode:'durable_v1',assignment_notification_intents:JSON.stringify([{
         supplier_id:'supplier-123',revision:2,state:'accepted',
         key:'assignment:service-123:supplier-123:r2:SUPPLIER_NEW_ASSIGNMENT'}])
     };
   }},
   Event:{get:async id=>{officeReads.push('event');return officeEvents.find(x=>x.id===id)||null;}},
   Supplier:{get:async id=>{officeReads.push('supplier');return officeSuppliers.find(x=>x.id===id)||null;}}, 
   WhatsAppOutbox:jobEntity,
   AppSettings:{filter:async()=>[]},
   InAppNotification:{list:async(_sort,limit,offset,fields)=>{listProjections.push(fields);return notifications.slice(offset,offset+limit);}},
   PendingPushNotification:{filter:async(_q,_sort,limit,offset,fields)=>{pendingProjections.push(fields);return pendingRows.slice(offset,offset+limit);}},
   Payment:{list:async()=>[]},
   Task:{list:async()=>[]},
   WhatsAppInboundReceipt:{
     list:async(_sort,limit,offset,fields)=>{
       inboundProjections.push(fields);return inboundRows.slice(offset,offset+limit);
     },
     get:async(id)=>inboundRows.find(x=>x.id===id)||null
   },
   WhatsAppInboundQuarantine:{
     list:async(_sort,limit,offset,fields)=>{
       unknownProjections.push(fields);
       return quarantineRows.slice(offset,offset+limit).map(row=>
        Object.fromEntries(fields.map(key=>[key,row[key]])));
     },
     filter:async(query,_sort,limit,offset,fields)=>{
       cleanupReads.push(fields);
       return quarantineRows.filter(row=>matches(row,query))
        .slice(offset,offset+limit).map(row=>
         Object.fromEntries(fields.map(key=>[key,row[key]])));
     },
     get:async id=>quarantineRows.find(row=>row.id===id)||null,
     updateMany:async(query,{$set})=>{
       cleanupWrites.push(Object.keys($set));
       const items=quarantineRows.filter(row=>matches(row,query));
       for(const row of items)Object.assign(row,$set);
       return {updated:items.length};
     }
   }
 }}};
 let handler=null;
 const js=esbuild.transformSync(fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
 }).code;
 vm.runInNewContext(js,{
   exports:{},module:{exports:{}},console:{error:()=>{},log:()=>{}},
   Deno:{serve:fn=>handler=fn,env:{get:key=>({
     GREEN_API_INSTANCE_ID:'9903183013',
     GREEN_API_TOKEN:'SYNTHETIC-GREEN-ONLY-API-TOKEN-1234567890',
     WHATSAPP_INTERACTIVE_SIGNING_SECRET:UNIT_SIGNING_SECRET,
     GREEN_UNKNOWN_RECOVERY_ENCRYPTION_KEY:UNIT_RECOVERY_KEY,
     GREEN_UNKNOWN_RECOVERY_KEY_ID:'v1-green-recovery'
   })[key]}}, 
   Response:{json:(body,{status=200}={})=>({body,status})},
   require:name=>{
     if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(name.endsWith('whatsappOutbox.ts'))return {readWhatsAppQueueControl:async()=>record};
     if(name.endsWith('whatsappQueueWorker.ts'))return {
       drainWhatsAppOutbox:async()=>{calls.push('dispatch');return {accepted:0,reason:'empty'}},
       providerIntervalMs,delayUntilNextSendMs,lastDispatchForProvider,
       syncWhatsAppStatus:async(_client,job,status)=>syncs.push({id:job.id,status})
     };
     if(name.endsWith('whatsappProviderConfig.ts'))return {resolveWhatsAppProvider:async()=> 'wasender'};
     if(name.endsWith('whatsappInteractiveSettingsStore.ts'))return {
       readSavedWhatsAppInteractivePolicy:async(_client,provider)=>{
         interactiveOps.push({kind:'get',provider});
         return {setting:{companyId:'shirat_hanevel',provider,messageKind:'assignment',version:1,
           officeNumber:'',policy:{enabled:false,quoteAssignment:false,buttons:[]}},configured:false,corrupt:false};
       },
       saveWhatsAppInteractivePolicyDraft:async(_client,data)=>{
         interactiveOps.push({kind:'save',provider:data.provider});
         if(data.policy?.enabled)throw Object.assign(Error('Interactive rollout disabled'),{status:400});
         return {setting:{companyId:'shirat_hanevel',provider:data.provider,messageKind:'assignment',version:2,
           officeNumber:data.officeNumber,policy:data.policy},configured:true,corrupt:false};
       }
     };
     if(name.endsWith('whatsappQueueMetrics.ts'))return {summarizeWhatsAppOutbox};
     if(name.endsWith('whatsappInboundAudit.ts'))return {summarizeInboundWhatsAppReceipts};
     if(name.endsWith('whatsappInboundInvestigation.ts'))return {inspectInboundReceiptReadOnly};
     if(name.endsWith('whatsappOfficeReferenceLookup.ts'))return {inspectOfficeAssignmentReference};
     if(name.endsWith('greenUnknownCallbackQuarantine.ts'))return {inspectUnknownGreenQuarantineReadOnly};
     if(name.endsWith('greenUnknownRecoveryCleanup.ts'))return {scrubExpiredUnknownGreenRecoveryOnDemand};
     if(name.endsWith('greenUnknownRecoveryReview.ts'))return {inspectUnknownGreenRecoveryStructureReadOnly};
     if(name.endsWith('greenWebhookSettingsAudit.ts'))return {
       inspectGreenWebhookSettingsReadOnly:async options=>{
         greenAudits.push({...options});
         return {source:'green_api_get_settings_read_only',
           webhookConfigured:true,webhookTokenConfigured:true,
           existingWebhookMustBePreserved:true,
           notificationFlags:{incomingWebhook:'yes'},
           activeCategories:1,noMessagesSent:true,noDatabaseQueries:true,
           providerReadCalls:1,webhookSettingChangesMade:false,
           safeToReplaceWebhookUrl:false};
       }
     };
     if(name.endsWith('greenButtonQaScopedV2.ts'))return {greenButtonQaScopedV2Enabled:()=>false};
     if(name.endsWith('greenButtonQaLaunch.ts'))return {greenButtonQaSafeSummary};
     if(name.endsWith('greenButtonQaAssignmentPreflight.ts'))return {
       inspectGreenButtonQaAssignmentReadOnly
     };
     if(name.endsWith('greenButtonQaEnrollment.ts'))return {
       enrollOneGreenButtonQaAssignment
     };
     if(name.endsWith('whatsappInteractiveReadiness.ts'))return {
       inspectGreenInteractiveReadinessReadOnly:async()=>summarizeWhatsAppInteractiveReadiness({
        control:record,selectedProvider:'green',assignmentIntentEnabled:false,
        greenInstanceAvailable:false,greenTokenAvailable:false,
        webhookCredentialAvailable:false,actionSigningKeyAvailable:false,
        draftConfigured:false,draftCorrupt:false
       })
     };
     if(name.endsWith('whatsappSourceAudit.ts'))return {summarizeWhatsAppSourceAudit,summarizePendingWhatsAppAudit,summarizePaymentReminderAudit,summarizeTaskWhatsAppAudit,findDuplicateAssignmentVersions};
     throw Error('Unexpected import: '+name);
   }
 });
 return {record,jobs,syncs,calls,interactiveOps,listProjections,pendingProjections,inboundProjections,unknownProjections,cleanupReads,cleanupWrites,officeReads,greenAudits,invoke:async(action,params={})=>await handler({
   method:'POST',json:async()=>({action,...params})
 })};
}
const config={enabled:true,paused:false,wasenderIntervalMs:2500,greenIntervalMs:180,maxMessagesPerRun:16};
const makeJob=(id,status='queued')=>({id,status,chat_id:'972501234567@c.us',message_type:'text',message_text:'Hello',source_type:'assignment_new',available_at:new Date().toISOString(),created_date:new Date().toISOString(),attempt_count:0,archived:false});

test('queue status flags only same-business-version assignment duplicates without extra DB reads',async()=>{
 const make=(id,service,supplier,time)=>({
  ...makeJob(id,'accepted'),
  source_type:'assignment_new',event_service_id:service,supplier_id:supplier,
  idempotency_key:'assignment:'+service+':'+supplier+':'+time+':SUPPLIER_NEW_ASSIGNMENT'
 });
 const rows=[
  make('job-a1','svc-a','supplier-a','2026-10-18T10:22:19.719000'),
  make('job-a2','svc-a','supplier-a','2026-10-18T10:22:19.719051'),
  make('job-b1','svc-b','supplier-b','2026-10-18T06:39:07.866000'),
  make('job-b2','svc-b','supplier-b','2026-10-18T06:39:07.866640'),
  make('job-c1','svc-c','supplier-c','2026-10-13T16:01:30.402000'),
  make('job-c2','svc-c','supplier-c','2026-10-13T16:03:03.411000')
 ];
 const ctx=context({jobs:rows});
 const r=await ctx.invoke('status');
 assert.equal(r.status,200);
 assert.equal(r.body.duplicateAssignmentVersions.count,2,
   'Two microsecond collisions qualify; independent saves remain separate');
 assert.equal(r.body.duplicateAssignmentVersions.providerAcceptanceIsNotDelivery,true);
 assert.equal(ctx.listProjections.length,1,'Reuse existing projected status read');
 assert.equal(ctx.listProjections[0].includes('idempotency_key'),true);
 assert.equal(ctx.listProjections[0].includes('event_service_id'),true);
 assert.equal(ctx.listProjections[0].includes('supplier_id'),true);
 assert.equal(JSON.stringify(r.body.latest).includes('idempotency_key'),false);
 assert.equal(ctx.calls.length,0,'Read-only status must not dispatch provider');
});
test('owner review deep link opens queue details and filters unknown without dispatch',()=>{
 const settings=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 const messages=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueMessages.jsx','utf8');
 assert.match(settings,/id="whatsapp-queue"/);
 assert.match(settings,/open=\{expanded\}/);
 assert.match(settings,/duplicateAssignmentVersions\.count/);
 assert.match(settings,/onClick=\{\(\)=>run\('sourceAudit'\)\}/);
 assert.match(messages,/get\('whatsappQueue'\)==='review'/);
 assert.match(messages,/\?'unknown':'all'/);
});
test('non-system owner cannot read or modify queue operations',async()=>{
 for(const actor of [null,{role:'admin',email:'other@example.com'},{role:'supplier',email:'natib8000@gmail.com'}]){
   const ctx=context({actor,jobs:[makeJob('job-123','queued')]});
   for(const action of ['status','configure','list','get','cancel','retry','resolve','archive','kick','sourceAudit','interactiveGet','interactiveSave','inboundAudit','inboundInspect','interactiveReadiness','greenButtonQaReadiness','greenButtonQaAssignmentPreflight','greenButtonQaEnroll','officeReferenceLookup','greenWebhookSettingsAudit','unknownCallbackAudit','unknownRecoveryExpiryCleanup','unknownRecoveryStructureReview']){
     const res=await ctx.invoke(action,{...config,id:'job-123'});
     assert.equal(res.status,403);
   }
   assert.equal(ctx.calls.length,0);
 }
});
test('owner unknown Green callback audit is projected, on-demand, masked and NEVER mutates supplier',async()=>{
 const sample={id:'quarantine-1',
  quarantine_key:'gq1_'+'a'.repeat(64),
  payload_mac:'b'.repeat(64),provider:'green',company_id:'shirat_hanevel',
  format_code:'unrecognized_interactive',state:'needs_review',
  provider_event_at:'2026-10-26T12:00:00Z',
  registered_at:'2026-10-26T12:00:01Z',
  review_code:'unrecognized_button_format',
  raw_message_text:'PRIVATE-NEVER-EXPOSE',
  sender_chat:'972501234567@c.us'};
 const ctx=context({quarantineRows:[sample]});
 const state=JSON.stringify(ctx.record);
 await ctx.invoke('status');
 await ctx.invoke('interactiveReadiness');
 assert.equal(ctx.unknownProjections.length,0,
  'normal queue page and readiness NEVER scan unknown quarantine');
 const result=await ctx.invoke('unknownCallbackAudit');
 assert.equal(result.status,200);
 assert.equal(result.body.success,true);
 assert.equal(result.body.unknownCallbackLiveHandlerEnabled,false);
 assert.equal(result.body.audit.pendingReview,1);
 assert.equal(result.body.audit.sampleCount,1);
 assert.equal(result.body.audit.list[0].reference,'a'.repeat(12));
 assert.equal(result.body.audit.unknownButtonsNeverAutoApproved,true);
 assert.equal(ctx.unknownProjections.length,1);
 assert.equal(ctx.unknownProjections[0].includes('raw_message_text'),false);
 assert.equal(ctx.unknownProjections[0].includes('payload_mac'),true);
 assert.equal(ctx.calls.length,0);
 assert.equal(ctx.officeReads.length,0);
 assert.equal(JSON.stringify(ctx.record),state);
 const serialized=JSON.stringify(result.body);
 for(const hidden of ['PRIVATE-NEVER-EXPOSE','972501234567','gq1_',
  'b'.repeat(64),'a'.repeat(64)])
  assert.equal(serialized.includes(hidden),false,hidden);
});
test('owner reviewed recovery shows only safe structural hints and never decrypts in routine dashboard',async()=>{
 const now=Date.now();
 const callback={
  typeWebhook:'incomingMessageReceived',
  idMessage:'3EB0STRUCTURERECOVERYUNIT12345',
  timestamp:Math.floor((now-1000)/1000),
  instanceData:{idInstance:9903183013,typeInstance:'whatsapp'},
  senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us',
   senderName:'SECRET-SUPPLIER-DO-NOT-RETURN'},
  messageData:{typeMessage:'futureInteractiveBetaReply',
   betaReply:{selectedId:'SECRET-SELECTED-APPROVE',
    stanzaId:'SECRET-ORIGINAL-OUTBOX-ID'}}
 };
 const identity=await fingerprintUnknownGreenCallback(callback,{
  expectedInstanceId:'9903183013',
  fingerprintSecret:UNIT_SIGNING_SECRET,now
 });
 const envelope=await encryptUnknownGreenRecovery(callback,identity,{
  encryptionKey:UNIT_RECOVERY_KEY,keyId:'v1-green-recovery',
  ownerRetentionApproved:true,now
 });
 const record={id:'review-row-01',...identity,...envelope,
  registered_at:new Date(now).toISOString()};
 const ctx=context({quarantineRows:[record]});
 await ctx.invoke('status');
 await ctx.invoke('interactiveReadiness');
 assert.equal(ctx.unknownProjections.length,0);
 assert.equal(ctx.cleanupReads.length,0);
 const audit=await ctx.invoke('unknownCallbackAudit');
 assert.equal(audit.status,200);
 const row=audit.body.audit.list[0];
 assert.equal(row.reviewRecordId,record.id);
 assert.equal(row.reference,record.quarantine_key.slice(-12));
 const review=await ctx.invoke('unknownRecoveryStructureReview',{
  id:row.reviewRecordId,reference:row.reference
 });
 assert.equal(review.status,200);
 assert.equal(review.body.success,true);
 assert.equal(review.body.review.hasSelectionIdentifierHint,true);
 assert.equal(review.body.review.hasOriginalMessageReferenceHint,true);
 assert.equal(review.body.review.neverApproveOrRejectSupplier,true);
 assert.equal(review.body.review.callbackReleasedToBrowser,false);
 assert.equal(review.body.noMessagesSent,true);
 assert.equal(review.body.unknownCallbackLiveHandlerEnabled,false);
 assert.equal(ctx.cleanupWrites.length,0);
 assert.equal(ctx.calls.length,0);
 assert.equal(ctx.greenAudits.length,0);
 const serialized=JSON.stringify(review.body);
 for(const secret of ['SECRET-SUPPLIER-DO-NOT-RETURN',
  'SECRET-SELECTED-APPROVE','SECRET-ORIGINAL-OUTBOX-ID',
  '972501234567',record.id,record.recovery_ciphertext,
  UNIT_RECOVERY_KEY,UNIT_SIGNING_SECRET])
  assert.equal(serialized.includes(secret),false,secret);
 const invalid=await ctx.invoke('unknownRecoveryStructureReview',{
  id:record.id,reference:'f'.repeat(12)
 });
 assert.equal(invalid.status,503);
 assert.equal(JSON.stringify(invalid.body).includes('972501234567'),false);
});
test('owner-triggered expiry scrub removes ONLY expired optional ciphertext and never runs on dashboard status',async()=>{
 const rows=[
  {id:'expired-1',provider:'green',company_id:'shirat_hanevel',
   recovery_status:'encrypted',recovery_version:'aes256gcm-v1',
   recovery_key_id:'v1-green-recovery',recovery_nonce:'AAAAAAAAAAAAAAAA',
   recovery_ciphertext:'ABCDEFGHIJKLMNOPQRSTUVWXYZZZZZ',
   recovery_expires_at:'2026-01-02T00:00:00Z',quarantine_key:'gq1_metadata_only'},
  {id:'not-expired',provider:'green',company_id:'shirat_hanevel',
   recovery_status:'encrypted',recovery_version:'aes256gcm-v1',
   recovery_key_id:'v1-green-recovery',recovery_nonce:'BBBBBBBBBBBBBBBB',
   recovery_ciphertext:'ABCDEFGHIJKLMNOPQRSTUVWXYZZZZZ',
   recovery_expires_at:'2030-01-02T00:00:00Z'}
 ];
 const ctx=context({quarantineRows:rows});
 await ctx.invoke('status');
 await ctx.invoke('interactiveReadiness');
 assert.equal(ctx.cleanupReads.length,0);
 assert.equal(ctx.cleanupWrites.length,0);
 const response=await ctx.invoke('unknownRecoveryExpiryCleanup');
 assert.equal(response.status,200);
 assert.equal(response.body.success,true);
 assert.equal(response.body.cleanup.scrubbed,1);
 assert.equal(response.body.cleanup.runOnlyOnOwnerClick,true);
 assert.equal(response.body.cleanup.retentionAutomaticallyEnforced,false);
 assert.equal(response.body.cleanup.backupPhysicalErasureNotVerified,true);
 assert.equal(ctx.cleanupReads.length,1);
 assert.equal(ctx.cleanupWrites.length,1);
 assert.equal(rows[0].recovery_status,'erased');
 assert.equal(rows[0].recovery_nonce,'');
 assert.equal(rows[0].recovery_ciphertext,'');
 assert.equal(rows[0].quarantine_key,'gq1_metadata_only');
 assert.equal(rows[1].recovery_status,'encrypted');
 assert.notEqual(rows[1].recovery_ciphertext,'');
 assert.equal(ctx.calls.length,0);
 assert.equal(ctx.officeReads.length,0);
 const serialized=JSON.stringify(response.body);
 for(const sensitive of ['expired-1','not-expired','ABCDEFGHIJKLMNOP','v1-green-recovery'])
  assert.equal(serialized.includes(sensitive),false,sensitive);
});
test('owner-only Green GetSettings audit is opt-in one provider GET and zero DB/queue mutation',async()=>{
 const ctx=context();
 await ctx.invoke('status');
 await ctx.invoke('interactiveReadiness');
 assert.equal(ctx.greenAudits.length,0,'status/readiness never contacts Green API');
 const statusBefore=JSON.stringify(ctx.record);
 const result=await ctx.invoke('greenWebhookSettingsAudit');
 assert.equal(result.status,200);
 assert.equal(result.body.success,true);
 assert.equal(result.body.settings.webhookConfigured,true);
 assert.equal(result.body.settings.existingWebhookMustBePreserved,true);
 assert.equal(result.body.settings.safeToReplaceWebhookUrl,false);
 assert.equal(result.body.settings.noDatabaseQueries,true);
 assert.equal(result.body.noMessagesSent,true);
 assert.equal(ctx.greenAudits.length,1);
 assert.equal(ctx.greenAudits[0].instanceId,'9903183013');
 assert.equal(ctx.greenAudits[0].apiToken,'SYNTHETIC-GREEN-ONLY-API-TOKEN-1234567890');
 assert.equal(ctx.calls.length,0);
 assert.equal(ctx.officeReads.length,0);
 assert.equal(JSON.stringify(ctx.record),statusBefore);
 const serialized=JSON.stringify(result.body);
 for(const secret of ['9903183013','SYNTHETIC-GREEN-ONLY-API-TOKEN-1234567890',
  'webhookUrlToken','PRIVATE-WEBHOOK-DOMAIN'])
  assert.equal(serialized.includes(secret),false,secret);
 const again=await ctx.invoke('status');
 assert.equal(again.status,200);
 assert.equal(ctx.greenAudits.length,1,'owner status refresh MUST NOT call Green');
});
test('owner office-reference lookup is exact, bounded, masked and performs no provider send',async()=>{
 const row={...makeJob('outbox-ABC123','accepted'),
  event_service_id:'service-ABC123',supplier_id:'supplier-ABC123',
  source_type:'assignment_new',provider:'green',provider_message_id:'PRIVATE-PROVIDER-MESSAGE',
  sender_account_id:'9903183013',chat_id:'972501234567@c.us',
  assignment_revision:'r3',interactive_button_bindings_json:'PRIVATE-ACTION-TOKEN',
  idempotency_key:'assignment:service-ABC123:supplier-ABC123:r3:SUPPLIER_NEW_ASSIGNMENT',
  message_text:'PRIVATE-EVENT-MESSAGE'};
 const service={id:'service-ABC123',event_id:'event-ABC123',service_name:'הרכב מוזיקלי',
  supplier_ids:'["supplier-ABC123"]',supplier_statuses:'{"supplier-ABC123":"pending"}',
  assignment_intent_mode:'durable_v1',
  assignment_notification_intents:JSON.stringify([{
   supplier_id:'supplier-ABC123',revision:3,state:'accepted',
   key:'assignment:service-ABC123:supplier-ABC123:r3:SUPPLIER_NEW_ASSIGNMENT'
  }])};
 const ctx=context({jobs:[row],officeServices:[service],
  officeEvents:[{id:'event-ABC123',event_name:'אירוע לדוגמה',event_date:'2027-06-14',client_phone:'PRIVATE-PHONE'}],
  officeSuppliers:[{id:'supplier-ABC123',supplier_name:'נגן לדוגמה',phone:'0509999999'}]});
 await ctx.invoke('status');
 assert.deepEqual(ctx.officeReads,[],'normal status must not query office lookup');
 const result=await ctx.invoke('officeReferenceLookup',{reference:row.id});
 assert.equal(result.status,200);
 assert.equal(result.body.lookup.reference,row.id);
 assert.equal(result.body.lookup.eventName,'אירוע לדוגמה');
 assert.equal(result.body.lookup.serviceName,'הרכב מוזיקלי');
 assert.equal(result.body.lookup.supplierName,'נגן לדוגמה');
 assert.equal(result.body.lookup.originState,'current_revision');
 assert.equal(result.body.noMessagesSent,true);
 assert.deepEqual(ctx.officeReads,['outbox','service','supplier','event']);
 assert.equal(ctx.calls.length,0);
 for(const hidden of ['PRIVATE-PROVIDER-MESSAGE','PRIVATE-ACTION-TOKEN','PRIVATE-EVENT-MESSAGE',
  '0509999999','PRIVATE-PHONE','972501234567','9903183013'])
  assert.equal(JSON.stringify(result.body).includes(hidden),false,hidden);
 const invalid=await ctx.invoke('officeReferenceLookup',{reference:'outbox-ABC123 '});
 assert.equal(invalid.status,400);
 assert.equal(ctx.officeReads.length,4,'invalid reference must not touch DB');
 const missing=await ctx.invoke('officeReferenceLookup',{reference:'missing-outbox'});
 assert.equal(missing.status,404);
 assert.equal(ctx.officeReads.length,5,'missing reference must not query related records');
});
test('interactive drafts are gated by system-owner auth and cannot dispatch WhatsApp',async()=>{
  const actor={role:'admin',email:'natib8000@gmail.com'};
  const ctx=context({actor});
  const saved=await ctx.invoke('interactiveSave',{provider:'green',expectedVersion:1,
    officeNumber:'972501234567',policy:{enabled:false,quoteAssignment:false,buttons:[]}});
  assert.equal(saved.status,200);
  assert.equal(saved.body.liveEnabled,false);
  assert.equal(saved.body.noMessagesSent,true);
  const read=await ctx.invoke('interactiveGet',{provider:'green'});
  assert.equal(read.status,200);
  assert.equal(read.body.liveEnabled,false);
  assert.deepEqual(ctx.interactiveOps.map(x=>x.kind),['save','get']);
  assert.equal(ctx.calls.length,0);
  const invalid=await ctx.invoke('interactiveSave',{provider:'green',expectedVersion:1,
    policy:{enabled:true,quoteAssignment:false,buttons:[]}});
  assert.equal(invalid.status,400);
  assert.equal(ctx.calls.length,0);
  const outsider=context({actor:{role:'admin',email:'other@example.com'}});
  assert.equal((await outsider.invoke('interactiveGet',{provider:'green'})).status,403);
  assert.equal((await outsider.invoke('interactiveSave',{provider:'green'})).status,403);
  assert.equal(outsider.interactiveOps.length,0);
});

test('inboundAudit is explicit owner-only, read-only, bounded and never exposes secrets, phone or body',async()=>{
 const inboundRows=[{id:'receipt-1',state:'processing',provider:'green',claim_until:'2026-10-01T00:00:00Z',
  phone:'private',raw_body:'secret-message',webhook_secret:'private-key'},
 {id:'receipt-2',state:'needs_review',provider:'wasender',claim_until:''}];
 const ctx=context({state:{inbound_guard_key:'pending-unverified-create'},inboundRows});
 await ctx.invoke('status');
 assert.equal(ctx.inboundProjections.length,0,'Routine status must not read inbound ledger');
 const response=await ctx.invoke('inboundAudit');
 assert.equal(response.status,200);
 assert.equal(response.body.liveInboundEnabled,false);
 assert.equal(response.body.audit.noMessagesSent,true);
 assert.equal(response.body.audit.registrationBlocked,true);
 assert.equal(response.body.audit.expiredProcessing,1);
 assert.equal(response.body.audit.totals.needs_review,1);
 assert.equal(ctx.inboundProjections.length,1);
 assert.deepEqual(Array.from(ctx.inboundProjections[0]),['id','state','claim_until','provider']);
 assert.equal(JSON.stringify(response.body).includes('secret-message'),false);
 assert.equal(JSON.stringify(response.body).includes('private-key'),false);
 assert.equal(JSON.stringify(response.body).includes('private'),false);
 assert.equal(ctx.calls.length,0);
});

test('single-chat QA owner readiness is separately opt-in and never exposes secrets or invokes Green',async()=>{
 const ctx=context({state:{interactive_outbound_live_enabled:false}});
 await ctx.invoke('status');
 await ctx.invoke('interactiveReadiness');
 assert.equal(ctx.greenAudits.length,0);
 const r=await ctx.invoke('greenButtonQaReadiness');
 assert.equal(r.status,200);
 assert.equal(r.body.success,true);
 assert.equal(r.body.qa.readyForQa,false);
 assert.equal(r.body.qa.restrictedToOnePrivateChat,true);
 assert.equal(r.body.qa.checks.find(x=>x.key==='owner_queue_gate').ready,false);
 assert.equal(ctx.calls.length,0);
 assert.equal(ctx.greenAudits.length,0);
 const text=JSON.stringify(r.body);
 assert.equal(text.includes(UNIT_SIGNING_SECRET),false);
 assert.equal(text.includes(UNIT_RECOVERY_KEY),false);
 assert.equal(text.includes('972501234567'),false);
});
test('interactiveReadiness is owner-only, explicitly on-demand and incapable of enabling a send',async()=>{
 const ctx=context();
 const status=await ctx.invoke('status');
 assert.equal(status.status,200);
 assert.equal(JSON.stringify(status.body).includes('activationEligible'),false);
 const result=await ctx.invoke('interactiveReadiness');
 assert.equal(result.status,200);
 assert.equal(result.body.readiness.activationEligible,false);
 assert.equal(result.body.readiness.noMessagesSent,true);
 assert.equal(result.body.readiness.liveSendConfigured,false);
 assert.ok(result.body.readiness.blockers.includes('real_callback_verified'));
 assert.equal(ctx.calls.length,0);
});
test('owner-only inboundInspect is explicit read-only, sanitized and never replays supplier mutations',async()=>{
 const original={id:'receipt-123',provider:'green',state:'needs_review',
  event_service_id:'service-123',supplier_id:'supplier-123',assignment_revision:'r2',
  action:'assignment_approve',result_code:'unknown_after_write',
  receipt_key:'private-provider-event-key',raw_body:'DO NOT EXPOSE',phone:'0500000000',
  actionToken:'secret-action-token',claim_until:'2026-10-01T00:00:00Z'};
 const ctx=context({state:{inbound_guard_key:'private-provider-event-key'},inboundRows:[original]});
 const result=await ctx.invoke('inboundInspect',{id:'receipt-123'});
 assert.equal(result.status,200);
 assert.equal(result.body.inspection.state,'needs_review');
 assert.equal(result.body.inspection.expectedStatus,'confirmed');
 assert.equal(result.body.inspection.currentStatus,'confirmed');
 assert.equal(result.body.inspection.businessMatchDoesNotProveCallbackCommitted,true);
 assert.equal(result.body.inspection.registrationBlocked,true);
 assert.equal(result.body.inspection.guardMatchesThisReceipt,true);
 assert.equal(result.body.inspection.automaticReplayAllowed,false);
 assert.equal(result.body.inspection.automaticGuardReleaseAllowed,false);
 assert.equal(result.body.noMessagesSent,true);
 const text=JSON.stringify(result.body);
 for(const secret of ['DO NOT EXPOSE','0500000000','private-provider-event-key','secret-action-token'])
  assert.equal(text.includes(secret),false);
 assert.equal(ctx.calls.length,0);
 const bad=await ctx.invoke('inboundInspect',{id:'abc\\nunsafe'});
 assert.equal(bad.status,400);
 const missing=await ctx.invoke('inboundInspect',{id:'receipt-other'});
 assert.equal(missing.status,404);
});
test('status/list/get are read only and mask recipient until owner requests detail',async()=>{
 const ctx=context({jobs:[makeJob('job-123')]});
 const status=await ctx.invoke('status');
 assert.equal(status.status,200);
 assert.equal(status.body.config.wasenderIntervalMs,7000);
 assert.equal(status.body.config.greenIntervalMs,7000);
 assert.equal(status.body.activeProvider,'wasender');
 const list=await ctx.invoke('list');
 assert.equal(list.status,200);assert.equal(list.body.rows.length,1);
 assert.equal(list.body.rows[0].chatId,undefined);
 assert.equal(list.body.rows[0].text,undefined);
 const detail=await ctx.invoke('get',{id:'job-123'});
 assert.equal(detail.body.message.chatId,'972501234567@c.us');
 assert.equal(detail.body.message.text,'Hello');
 assert.equal(ctx.calls.length,0);
});
test('lightweight read-only status/list/metrics use server-side field projection, not 500 message bodies',async()=>{
 const ctx=context({jobs:[makeJob('job-123')]});
 await ctx.invoke('status');
 await ctx.invoke('list');
 const m=await ctx.invoke('metrics');
 assert.equal(m.status,200);
 assert.ok(ctx.listProjections.length>=3);
 for(const fields of ctx.listProjections){
   assert.ok(Array.isArray(fields));
   for(const privateField of ['message_text','caption','document_url','file_uri','chat_id_secret']){
     assert.equal(fields.includes(privateField),false,'Never fetch private '+privateField+' when only summary needed');
   }
 }
 assert.ok(ctx.listProjections[0].includes('status'));
 assert.ok(ctx.listProjections.at(-1).includes('transport_finished_at'));
});
test('queue status distinguishes due jobs, quiet-hour futures and a genuinely empty queue',async()=>{
 const now=new Date().toISOString();
 const future=new Date(Date.now()+90*60*1000).toISOString();
 const due=makeJob('job-due','queued');
 due.available_at=now;
 const scheduled=makeJob('job-later','retry_wait');
 scheduled.available_at=future;
 const finished=makeJob('job-done','accepted');
 const archived=makeJob('job-archived','queued');
 archived.archived=true;
 const contextWithJobs=context({state:{enabled:true},jobs:[due,scheduled,finished,archived]});
 const r=await contextWithJobs.invoke('status');
 assert.equal(r.status,200);
 assert.equal(r.body.dueReadyCount,1);
 assert.equal(r.body.scheduledForFutureCount,1);
 assert.equal(r.body.workerBusy,false);
 assert.equal(r.body.historyTruncated,false);
 const empty=await context({state:{enabled:true},jobs:[]}).invoke('status');
 assert.equal(empty.body.dueReadyCount,0);
 assert.equal(empty.body.scheduledForFutureCount,0);
 assert.equal(empty.body.nextQueued,0);
});
test('queue settings UI does not label an empty queue ready to send',()=>{
 const source=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 assert.match(source,/view\.dueReadyCount/);
 assert.match(source,/view\.scheduledForFutureCount/);
 assert.match(source,/התור ריק/);
 assert.doesNotMatch(source,/מוכן לשליחה ללא המתנה/);
});
test('provider wait UI uses its own dispatch history, not the other provider cooldown',async()=>{
 const recent=new Date(Date.now()-1000).toISOString();
 const old=new Date(Date.now()-60000).toISOString();
 const ctx=context({state:{enabled:true,last_dispatched_at:recent,last_provider:'green',
   last_green_dispatched_at:recent,last_wasender_dispatched_at:old,
   green_interval_ms:5000,wasender_interval_ms:9000}});
 const r=await ctx.invoke('status');
 assert.equal(r.status,200);
 assert.equal(r.body.activeProvider,'wasender');
 assert.equal(r.body.nextAllowedInMs,0,
   'Wasender can send even when latest global dispatch was Green');
});
test('configure persists each provider in milliseconds and enables wake once',async()=>{
 const ctx=context();
 let r=await ctx.invoke('configure',config);
 assert.equal(r.status,200);
 assert.equal(ctx.record.wasender_interval_ms,2500);
 assert.equal(ctx.record.green_interval_ms,180);
 assert.ok(ctx.record.wake_requested_at);
 assert.equal(ctx.calls.length,0);
 r=await ctx.invoke('configure',{...config,wasenderIntervalMs:0,greenIntervalMs:250});
 assert.equal(r.status,200);
 assert.equal(ctx.record.wasender_interval_ms,0);
});
test('invalid provider intervals reject negative, fractional milliseconds and excessive values',async()=>{
 for(const bad of [-1,0.5,300001,null,'7000']){
   const ctx=context();
   const r=await ctx.invoke('configure',{...config,wasenderIntervalMs:bad});
   assert.equal(r.status,400);
   assert.equal(ctx.record.enabled,false);
 }
});
test('disable refuses to bypass active queued or retry-wait jobs, pause is reversible',async()=>{
 const ctx=context({state:{enabled:true},jobs:[makeJob('job-a','retry_wait')]});
 let r=await ctx.invoke('configure',{...config,enabled:false});
 assert.equal(r.status,409);
 assert.equal(ctx.record.enabled,true);
 r=await ctx.invoke('configure',{...config,paused:true});
 assert.equal(r.status,200);assert.equal(ctx.record.paused,true);
 r=await ctx.invoke('configure',{...config,paused:false});
 assert.equal(r.status,200);assert.equal(ctx.record.paused,false);
 assert.ok(ctx.record.wake_requested_at);
});
test('cancel only pending/retry and CAS never cancels in-flight',async()=>{
 const ctx=context({jobs:[makeJob('job-a','queued'),makeJob('job-b','sending')]});
 let r=await ctx.invoke('cancel',{id:'job-a'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].status,'cancelled');
 assert.deepEqual(ctx.syncs[0],{id:'job-a',status:'cancelled'});
 r=await ctx.invoke('cancel',{id:'job-b'});
 assert.equal(r.status,409);assert.equal(ctx.jobs[1].status,'sending');
});
test('bulk cancel and archive cannot mutate active/in-flight jobs',async()=>{
 const ctx=context({jobs:[makeJob('job-a','queued'),makeJob('job-b','retry_wait'),makeJob('job-c','sending')]});
 let r=await ctx.invoke('bulkCancel',{ids:['job-a','job-b','job-c'],confirm:true});
 assert.equal(r.status,200);assert.equal(r.body.updated,2);assert.equal(r.body.skipped.length,1);
 assert.equal(ctx.jobs[2].status,'sending');
 r=await ctx.invoke('bulkArchive',{ids:['job-a','job-b','job-c'],confirm:true});
 assert.equal(r.body.updated,2);
 assert.equal(ctx.jobs[0].archived,true);
 assert.equal(ctx.jobs[1].archived,true);
});
test('owner queue UI hides Retry for protected interactive records and never returns signed buttons',async()=>{
 const protectedJob={...makeJob('job-protected','failed'),
  sender_account_id:'9903183013',assignment_revision:'r4',
  interactive_button_bindings_json:'PRIVATE-SIGNED-SNAPSHOT',
  status:'failed'};
 const ctx=context({jobs:[protectedJob]});
 const listed=await ctx.invoke('list');
 assert.equal(listed.status,200);
 assert.equal(listed.body.rows[0].canRetry,false);
 assert.equal(listed.body.rows[0].interactiveReviewRequired,true);
 assert.equal(JSON.stringify(listed.body).includes('PRIVATE-SIGNED-SNAPSHOT'),false);
 assert.equal(JSON.stringify(listed.body).includes('9903183013'),false);
 const detailed=await ctx.invoke('get',{id:protectedJob.id});
 assert.equal(detailed.body.message.canRetry,false);
 assert.equal(JSON.stringify(detailed.body).includes('PRIVATE-SIGNED-SNAPSHOT'),false);
 const projected=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueMessages.jsx','utf8');
 assert.match(projected,/canRetry:EDITABLE_FAILED\.has\(job\.status\)&&!interactiveReviewRequired/);
 assert.match(ui,/row\.interactiveReviewRequired/);
});
test('pre-snapshot pilot marker is always protected from UI and manual retry',async()=>{
 for(const status of ['failed','unknown']){
  const pilot={...makeJob('job-marked-'+status,status),
   interactive_qa_required:true,attempt_count:0,
   sender_account_id:'',assignment_revision:'',
   interactive_button_bindings_json:''};
  const ctx=context({jobs:[pilot]});
  const listed=await ctx.invoke('list');
  assert.equal(listed.status,200);
  assert.equal(listed.body.rows[0].canRetry,false);
  assert.equal(listed.body.rows[0].interactiveReviewRequired,true);
  const detailed=await ctx.invoke('get',{id:pilot.id});
  assert.equal(detailed.body.message.canRetry,false);
  const retry=await ctx.invoke('retry',{id:pilot.id,
   note:'Verified invalid sender configuration',verifiedNotSent:true});
  assert.equal(retry.status,409);
  assert.match(retry.body.error,/provider reconciliation/);
  assert.equal(pilot.status,status);
  assert.equal(pilot.manual_retry_count,undefined);
  assert.equal(ctx.calls.length,0,'never send a pilot job via manual retry');
  const projected=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
  assert.match(projected,/LIST_FIELDS=\[[\s\S]*?'interactive_qa_required'\]/);
 }
});
test('manual admin retry refuses a frozen interactive assignment even after note or verifiedNotSent',async()=>{
 for(const oldState of ['failed','unknown']){
  const protectedJob={...makeJob('job-interactive',oldState),
   requested_provider:'green',sender_account_id:'9903183013',
   assignment_revision:'r4',interactive_button_bindings_json:'sealed-frozen-snapshot',
   provider_message_id:oldState==='unknown'?'':'',attempt_count:1};
  const ctx=context({jobs:[protectedJob]});
  const result=await ctx.invoke('retry',{id:protectedJob.id,
   note:'Verified with provider history: may not have sent',
   verifiedNotSent:true});
  assert.equal(result.status,409);
  assert.match(result.body.error,/Interactive assignment retry requires provider reconciliation/);
  assert.equal(protectedJob.status,oldState);
  assert.equal(protectedJob.attempt_count,1);
  assert.equal(ctx.calls.length,0);
 }
});
test('definitely failed messages can be retried with reason, no silent duplicates',async()=>{
 const ctx=context({jobs:[makeJob('job-a','failed'),makeJob('job-b','accepted')]});
 let r=await ctx.invoke('retry',{id:'job-a',note:'Verified invalid number corrected'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].status,'queued');assert.equal(ctx.jobs[0].manual_retry_count,1);
 r=await ctx.invoke('retry',{id:'job-b',note:'do not repeat'});
 assert.equal(r.status,409);assert.equal(ctx.jobs[1].status,'accepted');
});
test('unknown requires explicit verification of non-delivery and detailed note',async()=>{
 const ctx=context({jobs:[makeJob('job-u','unknown')]});
 let r=await ctx.invoke('retry',{id:'job-u',note:'No provider entry'});
 assert.equal(r.status,409);assert.equal(ctx.jobs[0].status,'unknown');
 r=await ctx.invoke('retry',{id:'job-u',verifiedNotSent:true,note:'Checked provider sent history: message absent'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].status,'queued');
 assert.equal(ctx.jobs[0].resolution,'verified_not_sent_then_requeued');
});
test('resolve unknown without resending; archive only terminal statuses',async()=>{
 const ctx=context({jobs:[makeJob('job-u','unknown'),makeJob('job-q','queued')]});
 let r=await ctx.invoke('archive',{id:'job-u'});assert.equal(r.status,409);
 r=await ctx.invoke('resolve',{id:'job-u',note:'Confirmed handled by phone',resolution:'handled_outside'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].status,'resolved');
 r=await ctx.invoke('archive',{id:'job-u'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].archived,true);
 r=await ctx.invoke('archive',{id:'job-q'});
 assert.equal(r.status,409);
});

test('sourceAudit is read-only and loads projected metadata only on explicit action',async()=>{
 const notifications=[
  {id:'inapp-a',whatsapp_sent:false,template_type:'SUPPLIER_EVENT_REMINDER'},
  {id:'inapp-b',whatsapp_sent:true,template_type:'PUSH_ONLY'}
 ];
 const jobs=[{...makeJob('job-abc','accepted'),in_app_notification_id:'inapp-a'}];
 const pendingRows=[{id:'p-1',template_type:'ADMIN_MISSING_ASSIGNMENT',scheduled_for:new Date(Date.now()+3600000).toISOString(),
   data:JSON.stringify({send_whatsapp:true,phone:'0501234567',whatsapp_message:'private text'})}];
 const ctx=context({jobs,notifications,pendingRows});
 await ctx.invoke('status');
 assert.equal(ctx.pendingProjections.length,0,'Regular status refresh must not read business schedules');
 assert.equal(ctx.listProjections.length,1,
   'Ordinary status must not fetch the InApp source audit');
 const a=await ctx.invoke('sourceAudit');
 assert.equal(a.status,200);
 assert.equal(a.body.success,true);
 assert.equal(a.body.audit.noMessagesSent,true);
 assert.equal(a.body.audit.acceptedWithoutMirror.length,1);
 assert.equal(a.body.audit.businessReminders.available,true);
 assert.equal(a.body.audit.businessReminders.whatsappWaiting,1);
 assert.equal(a.body.audit.businessReminders.legacyWithoutBusinessKey,1);
 assert.equal(ctx.pendingProjections.length,2);
 assert.ok(ctx.pendingProjections[0].includes('data'));
 assert.ok(ctx.pendingProjections[1].includes('related_task_id'));
 assert.equal(a.body.audit.tasks.available,true);
 assert.ok(!JSON.stringify(a.body).includes('0501234567'));
 assert.ok(!JSON.stringify(a.body).includes('private text'));
 assert.equal(ctx.calls.length,0,'Audit must never call worker or provider');
 assert.equal(ctx.listProjections.length,3);
 for(const fields of ctx.listProjections.slice(1)){
   assert.ok(fields.includes('id'));
   for(const sensitive of ['message','message_text','chat_id','file_uri','document_url','phone']){
     assert.equal(fields.includes(sensitive),false,'Source audit must NOT load '+sensitive);
   }
 }
});

test('admin explicit worker kick is only action that dispatches',async()=>{
 const ctx=context();
 await ctx.invoke('status');
 assert.equal(ctx.calls.length,0);
 await ctx.invoke('kick');
 assert.equal(ctx.calls.length,1);
});
