import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGreenV2ReminderWorkerCandidate,verifyV2ReminderTransport}
 from '../base44/shared/whatsappV2ReminderOutbound.ts';
import {verifiedSupplierNavigationTransport}
 from '../base44/shared/greenSupplierNavigation.ts';
import {captureSupplierButtonSnapshot}
 from '../base44/shared/greenSupplierButtonSnapshot.ts';
import {defaultSupplierTemplateButtonPolicy,
 SUPPLIER_TEMPLATE_NAVIGATION_FIELD}
 from '../base44/shared/greenSupplierTemplateButtonsPolicy.ts';
import {withSupplierPortalLink} from '../base44/shared/supplierPortalLink.ts';

const secret='v2-integration-reminder-test-signing-secret-12345678';
const now=Date.parse('2026-10-31T19:50:00Z');
const template='69817697d82b634ef3d7d4df';
const controls=()=>({
 id:'control-1',control_key:'global',enabled:true,paused:false,
 interactive_assignment_production_enabled:true,
 interactive_outbound_live_enabled:true,
 interactive_reminder_v2_outbound_enabled:true,
 interactive_reminder_v2_inbound_ever_enabled:true
});
const config=()=>({
 enabled:true,legacyProductionApproved:true,
 accountCapabilityVerified:true,capability:'mixed_url',
 senderAccountId:'9903183013',signingSecret:secret,
 officeNumber:'972541234567',officeLabel:'פנייה למשרד',
 supplierPortalLabel:'כניסה למערכת'
});
const messages=()=>({
 id:'outbox-reminder-12345',source_type:'event_reminder',
 source_id:'event-12345',message_type:'text',
 message_text:withSupplierPortalLink('מחר אירוע · נא להגיע בזמן','supplier-123'),
 supplier_id:'supplier-123',chat_id:'972501234567@c.us',
 notification_template_id:template,
 requested_provider:'green',status:'queued',
 attempt_count:0,send_started_at:'',provider_message_id:'',
 interactive_v2_button_bindings_json:'',assignment_revision:'',
 interactive_button_bindings_json:'',sender_account_id:''
});
const compare=(row,q)=>Object.entries(q).every(([k,v])=>
 (row[k]??null)===(v??null));
function setup(){
 const control=controls(),job=messages();
 job.supplier_buttons_snapshot_json=captureSupplierButtonSnapshot(control,{
  sourceType:'event_reminder',notificationTemplateId:template,
  supplierId:job.supplier_id
 });
 assert.ok(job.supplier_buttons_snapshot_json);
 const metrics={updates:0,reads:0};let failMode='';
 const outbox={
  get:async id=>{metrics.reads++;return id===job.id?{...job}:null;},
  updateMany:async(q,{$set})=>{
   metrics.updates++;
   if(failMode==='before')throw Error('before write');
   if(!compare(job,q))return {updated:0};
   Object.assign(job,$set);
   if(failMode==='after')throw Error('committed then timed out');
   return {updated:1};
  }
 };
 const client={asServiceRole:{entities:{WhatsAppOutbox:outbox}}};
 const prepare=()=>prepareGreenV2ReminderWorkerCandidate({
  client,job:{...job},control,config:config(),provider:'green',now
 });
 return {job,control,client,metrics,prepare,setFailMode:x=>failMode=x};
}
test('real signed supplier reminder gets one frozen HMAC snapshot CAS before first provider attempt',async()=>{
 const f=setup();
 const prepared=await f.prepare();
 assert.equal(prepared.kind,'reminder_v2');
 assert.equal(prepared.job.message_kind,'supplier_reminder');
 assert.equal(prepared.job.company_id,'shirat_hanevel');
 assert.equal(prepared.job.resource_id,prepared.job.id);
 assert.equal(prepared.job.recipient_id,prepared.job.supplier_id);
 assert.equal(f.metrics.updates,1);
 assert.deepEqual(prepared.preview.body.buttons.map(x=>x.type),
  ['reply','url','url']);
 assert.deepEqual(prepared.preview.body.buttons.map(x=>x.buttonText),
  ['קיבלתי','כניסה למערכת','פנייה למשרד']);
 assert.equal(prepared.preview.method,'sendInteractiveButtons');
 assert.equal(prepared.preview.body.chatId,prepared.job.chat_id);
 assert.equal(await verifyV2ReminderTransport({
  job:{...f.job,status:'sending'},
  provider:'green',preview:prepared.preview,
  signingSecret:secret,expectedSenderAccountId:'9903183013',now,
  verifyNavigation:verifiedSupplierNavigationTransport
 }),true);
 const second=await f.prepare();
 assert.equal(second.preview.body.buttons[0].buttonId,
  prepared.preview.body.buttons[0].buttonId,
  'existing signed ID is reused, never regenerated');
 assert.equal(f.metrics.updates,1,'no second CAS for frozen snapshot');
});
test('429 definite retry reuses exact ID, while ambiguous/unknown or changed Green account fail closed',async()=>{
 const f=setup();
 const prepared=await f.prepare();
 const id=prepared.preview.body.buttons[0].buttonId;
 Object.assign(f.job,{status:'retry_wait',attempt_count:1,error_code:429,
  send_started_at:new Date(now).toISOString(),provider_message_id:''});
 const retried=await f.prepare();
 assert.equal(retried.preview.body.buttons[0].buttonId,id);
 assert.equal(f.metrics.updates,1);
 const changedConfig={...config(),senderAccountId:'9903183014'};
 await assert.rejects(prepareGreenV2ReminderWorkerCandidate({
  client:f.client,job:{...f.job},control:f.control,provider:'green',
  config:changedConfig,now
 }),/snapshot_identity_changed|signed_snapshot_invalid/);
 f.job.status='unknown';
 await assert.rejects(f.prepare(),/signed_job_retry_requires_review/);
});
test('unsupported notifications, groups, previous attempts and no-buttons selections leave old send unchanged',async()=>{
 for(const fields of [
  {source_type:'manual_trigger'}, {message_type:'document'},
  {chat_id:'120000000@g.us'}, {requested_provider:'wasender'},
  {supplier_id:''},{notification_template_id:''},
  {attempt_count:1}, {status:'accepted'},
  {send_started_at:new Date(now).toISOString()}
 ]){
  const f=setup();
  Object.assign(f.job,fields);
  assert.equal(await f.prepare(),null,JSON.stringify(fields));
  assert.equal(f.metrics.updates,0);
 }
 const none=setup();
 const raw=defaultSupplierTemplateButtonPolicy();
 raw.templates[template]={portal:false,office:false,
  portalLabel:'',officeLabel:''};
 none.control[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]=JSON.stringify(raw);
 none.job.supplier_buttons_snapshot_json=captureSupplierButtonSnapshot(none.control,{
  sourceType:'event_reminder',notificationTemplateId:template,
  supplierId:none.job.supplier_id
 });
 assert.equal(await none.prepare(),null);
 assert.equal(none.metrics.updates,0);
 const disabled=setup();
 disabled.control.interactive_reminder_v2_outbound_enabled=false;
 assert.equal(await disabled.prepare(),null);
 assert.equal(disabled.metrics.updates,0);
});
test('uncertain snapshot CAS never uses regenerated button ID or calls provider',async()=>{
 const f=setup();
 f.setFailMode('after');
 const accepted=await f.prepare();
 assert.equal(accepted.kind,'reminder_v2');
 assert.equal(f.metrics.updates,1);
 const noCommit=setup();
 noCommit.setFailMode('before');
 await assert.rejects(noCommit.prepare(),/snapshot_write_uncertain/);
 assert.equal(noCommit.metrics.updates,1);
 assert.equal(noCommit.job.interactive_v2_button_bindings_json,'');
});
test('fake or mutated final payload is rejected even with valid snapshot and supplier ID',async()=>{
 const f=setup(),{preview}=await f.prepare();
 const job={...f.job,status:'sending'};
 const run=async(p,patch={})=>verifyV2ReminderTransport({
  job:{...job,...patch},provider:'green',preview:p,
  signingSecret:secret,expectedSenderAccountId:'9903183013',now,
  verifyNavigation:verifiedSupplierNavigationTransport
 });
 assert.equal(await run(preview),true);
 const mutations=[
  p=>{p.body.buttons[0].buttonId='wa2_FAKEFAKEFAKEFAKEFAKE22';},
  p=>{p.body.buttons[0].buttonText='סגרתי את השיבוץ';},
  p=>{p.body.buttons[1].url='https://evil.example.com';},
  p=>{p.body.chatId='972509999999@c.us';},
  p=>{p.body.buttons.push(p.body.buttons[0]);},
  p=>{p.navigation.body.buttons[0].url='https://evil.example.com';}
 ];
 for(const mutate of mutations){
  const altered=structuredClone(preview);
  mutate(altered);
  assert.equal(await run(altered),false,JSON.stringify(altered).slice(0,150));
 }
 assert.equal(await run(preview,{provider:'wasender'}),true,
  'provider field from job is not trusted for transport; trusted provider arg is authoritative');
 assert.equal(await verifyV2ReminderTransport({
  job,provider:'wasender',preview,
  signingSecret:secret,expectedSenderAccountId:'9903183013',now,
  verifyNavigation:verifiedSupplierNavigationTransport
 }),false);
});
