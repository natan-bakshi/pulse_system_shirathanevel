import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {assignmentWhatsAppKey} from '../base44/shared/assignmentWhatsApp.ts';
import {SUPPLIER_PORTAL_URL,withSupplierPortalLink,
 productionAssignmentPrivateTarget} from '../base44/shared/supplierPortalLink.ts';
import {trustedGreenAssignmentProductionConfig,trustedGreenButtonQaConfig}
 from '../base44/shared/greenButtonQaLaunch.ts';
import {prepareGreenInteractiveWorkerCandidate}
 from '../base44/shared/whatsappInteractiveWorkerBridge.ts';
import {drainWhatsAppOutbox} from '../base44/shared/whatsappQueueWorker.ts';
const signing='production-routing-offline-signing-secret-0123456789012345';
const webhook='production-routing-offline-webhook-0123456789012345';
const owner='approved';
const vars={
 GREEN_BUTTONS_QA_SEND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'verified',
 GREEN_BUTTONS_QA_OWNER_APPROVED:owner,
 GREEN_API_INSTANCE_ID:'9903183013',
 GREEN_API_TOKEN:'long-offline-green-credential-01234567890123456',
 GREEN_API_WEBHOOK_TOKEN:webhook,
 WHATSAPP_INTERACTIVE_SIGNING_SECRET:signing
};
const env=(patch={})=>key=>({...vars,...patch})[key]||'';
const policy=JSON.stringify({
 companyId:'shirat_hanevel',provider:'green',messageKind:'assignment',
 version:1,officeNumber:'972551111111',
 policy:{enabled:false,quoteAssignment:false,buttons:[
  {action:'assignment_approve',label:'מאשר'},
  {action:'assignment_reject',label:'דוחה'},
  {action:'contact_office',label:'פנייה למשרד'}
 ]}
});
const control=()=>({
 control_key:'global',enabled:true,paused:false,
 interactive_outbound_live_enabled:true,
 interactive_assignment_production_enabled:true,
 interactive_assignment_production_ever_enabled:true,
 interactive_assignment_green_policy_json:policy
});
test('PRODUCTION can use proven Green credentials with NO QA event, supplier or chat pins',()=>{
 const c=control(),e=env();
 assert.equal(trustedGreenButtonQaConfig(c,e,true),null,
  'single-target QA must remain strictly scoped and unavailable without pins');
 const ready=trustedGreenAssignmentProductionConfig(c,e,'outbound');
 assert.ok(ready,'production must not depend on the obsolete QA recipient');
 assert.equal(ready.legacyProductionApproved,true);
 assert.equal(ready.qaChatId,undefined);
 assert.equal(ready.qaEventServiceId,undefined);
 assert.equal(ready.qaSupplierId,undefined);
 assert.equal(ready.supplierPortalUrl,SUPPLIER_PORTAL_URL);
 assert.equal(ready.accountCapabilityVerified,true);
});
test('production gates reject owner OFF, unverified provider, missing webhook, no send/inbound and corrupt policy',()=>{
 const variations=[
  [()=>({...control(),interactive_assignment_production_enabled:false}),env()],
  [control,env({GREEN_BUTTONS_QA_OWNER_APPROVED:''})],
  [control,env({GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:''})],
  [control,env({GREEN_BUTTONS_QA_INBOUND_ENABLED:''})],
  [control,env({GREEN_BUTTONS_QA_SEND_ENABLED:''})],
  [control,env({GREEN_API_WEBHOOK_TOKEN:''})],
  [()=>({...control(),interactive_assignment_green_policy_json:'not json'}),env()],
  [()=>({...control(),enabled:false}),env()],
  [()=>({...control(),paused:true}),env()]
 ];
 for(const [c,e] of variations)
  assert.equal(trustedGreenAssignmentProductionConfig(c(),e,'outbound'),null);
 const stopped={...control(),interactive_assignment_production_enabled:false};
 assert.equal(trustedGreenAssignmentProductionConfig(stopped,env(),'outbound'),null);
 assert.ok(trustedGreenAssignmentProductionConfig(stopped,env({GREEN_BUTTONS_QA_SEND_ENABLED:''}),'inbound'),
  'historical signed replies still verified even after outbound off');
});
test('new production assignment overrides GROUP chat to a PRIVATE supplier phone without saving preference',()=>{
 const supplier={id:'supplier-abc123',phone:'0521234567',
  preferred_channel:'group',whatsapp_group_url:'120363412345678909@g.us'};
 const original=supplier.whatsapp_group_url;
 const c=control();
 const result=productionAssignmentPrivateTarget(supplier,original,c,'green',
  p=>'972'+p.slice(1)+'@c.us');
 assert.equal(result.chatId,'972521234567@c.us');
 assert.equal(result.reason,'green_buttons_require_personal_chat');
 assert.equal(supplier.preferred_channel,'group','do not change existing supplier preference');
 assert.equal(supplier.whatsapp_group_url,original);
 for(const [change,provider] of [
  [{interactive_assignment_production_enabled:false},'green'],
  [{interactive_outbound_live_enabled:false},'green'],
  [{paused:true},'green'],
  [{},'wasender']
 ]){
  assert.equal(productionAssignmentPrivateTarget(supplier,original,
   {...c,...change},provider,p=>'972'+p.slice(1)+'@c.us').chatId,original);
 }
 assert.equal(productionAssignmentPrivateTarget(
  {...supplier,phone:'INVALID'},original,c,'green',()=>null).chatId,original);
});
test('every supplier-targeted text message gets the real authenticated calendar URL once',()=>{
 const sample='תזכורת לשיבוץ';
 const composed=withSupplierPortalLink(sample,'supplier-abc123');
 assert.match(composed,/SupplierCalendarDashboard/);
 assert.match(composed,/לוח האירועים/);
 assert.equal(withSupplierPortalLink(composed,'supplier-abc123'),composed);
 assert.equal(withSupplierPortalLink(sample,''),sample);
 assert.equal(withSupplierPortalLink(sample,'invalid/id'),sample);
});
test('actual LEGACY EventService + existing Outbox key is upgraded at dispatch to signed Green buttons with portal and office URL',async()=>{
 const c=control(),production=trustedGreenAssignmentProductionConfig(c,env(),'outbound');
 const service={
  id:'service-abc123',event_id:'event-abc123',is_external:false,
  updated_date:'2026-10-30T07:26:12.138000',
  supplier_ids:'["supplier-abc123"]',
  supplier_statuses:'{"supplier-abc123":"pending"}',
  declined_suppliers:'[]'
 };
 const job={
  id:'outbox-abc123',source_type:'assignment_new',message_type:'text',
  message_text:'שיבוץ ספק\n\n'+SUPPLIER_PORTAL_URL,
  chat_id:'972521234567@c.us',requested_provider:'green',
  idempotency_key:assignmentWhatsAppKey(service,'supplier-abc123'),
  event_service_id:service.id,supplier_id:'supplier-abc123',
  created_date:'2026-10-30T07:26:13.945Z',
  status:'queued',attempt_count:0,send_started_at:'',
  provider_message_id:'',completed_at:''
 };
 assert.ok(job.idempotency_key.includes('2026-10-30T07:26:12.138000'));
 let writes=0;
 const store={WhatsAppOutbox:{
  get:async id=>id===job.id?structuredClone(job):null,
  updateMany:async (query,{$set:patch})=>{
   if(query.id!==job.id||query.status!==job.status)return {updated:0};
   Object.assign(job,patch);writes++;return {updated:1};
  }},
  EventService:{get:async id=>id===service.id?structuredClone(service):null}};
 const ctx={asServiceRole:{entities:store}};
 const decision=await prepareGreenInteractiveWorkerCandidate(
  ctx,structuredClone(job),'green',c,
  {...production,subtle:webcrypto.subtle,now:Date.parse('2026-10-30T07:26:19Z')});
 assert.equal(decision.kind,'interactive',decision.reason);
 assert.equal(writes,1);
 assert.equal(decision.preview.method,'sendInteractiveButtons');
 assert.deepEqual(decision.preview.body.buttons.map(b=>b.type),['reply','reply','url']);
 assert.equal(decision.preview.body.buttons[2].buttonText,'פנייה למשרד');
 assert.equal(decision.preview.body.buttons[2].buttonId,'contact_office');
 const office=new URL(decision.preview.body.buttons[2].url);
 assert.equal(office.origin,'https://wa.me');
 assert.equal(office.pathname,'/972551111111');
 const draft=office.searchParams.get('text');
 assert.match(draft,/אסמכתא: outbox-abc123/);
 assert.match(draft,/שיבוץ ספק/);
 // The very long prefilled draft is HIDDEN behind a native Office button.
 // The supplier's existing authenticated portal stays in the message body.
 assert.equal(decision.preview.body.body.includes('wa.me'),false);
 assert.match(decision.preview.body.body,/SupplierCalendarDashboard/);
 assert.equal(decision.preview.body.buttons.filter(b=>b.type==='reply').length,2);
 assert.ok(job.interactive_button_bindings_json);
 assert.equal(job.assignment_revision,'r1793345172138');
});
test('Green sender-pinned feedback remains ordinary text, not frozen assignment requiring buttons',async()=>{
 const now=Date.now();
 const c={id:'control-global',control_key:'global',enabled:true,paused:false,
  interactive_outbound_live_enabled:false,interactive_assignment_production_enabled:false,
  min_interval_seconds:0,green_interval_ms:0,
  last_green_dispatched_at:'',last_dispatched_at:'',
  max_messages_per_run:4,lease_owner:'',lease_until:'',enqueue_owner:'',enqueue_until:''};
 const feedback={
  id:'outbox-feedback-123',source_type:'assignment_button_feedback',
  source_id:'receipt-123',message_type:'text',message_text:'אושר בהצלחה',
  chat_id:'972521234567@c.us',requested_provider:'green',
  sender_account_id:'9903183013',idempotency_key:'button-feedback:receipt-123',
  status:'queued',created_date:new Date(now-3000).toISOString(),
  available_at:new Date(now-3000).toISOString(),attempt_count:0,max_attempts:3
 };
 const matches=(obj,q)=>Object.entries(q||{}).every(([k,v])=>{
  const actual=obj[k]??null;
  if(v&&typeof v==='object'&&'$in' in v)return v.$in.includes(actual);
  if(v&&typeof v==='object'&&'$lte' in v)return String(actual||'')<=String(v.$lte);
  return actual===(v??null);
 });
 const entities={
  WhatsAppOutbox:{
   filter:async q=>matches(feedback,q)?[feedback]:[],
   get:async id=>id===feedback.id?feedback:null,
   update:async(id,patch)=>{assert.equal(id,feedback.id);Object.assign(feedback,patch);return feedback;},
   updateMany:async(q,{$set:patch})=>{
    if(!matches(feedback,q))return {updated:0};
    Object.assign(feedback,patch);return {updated:1};
   }
  },
  WhatsAppQueueControl:{
   filter:async()=>[c],get:async()=>c,
   update:async(_id,patch)=>{Object.assign(c,patch);return c;},
   updateMany:async(q,{$set:patch})=>{
    if(!matches(c,q))return {updated:0};
    Object.assign(c,patch);return {updated:1};
   }
  },
  AppSettings:{filter:async()=>[{setting_key:'whatsapp_default_provider',setting_value:'green'}]}
 };
 const client={asServiceRole:{entities}};
 const sent=[];
 const old=globalThis.Deno;
 globalThis.Deno={env:{get:k=>k==='GREEN_API_INSTANCE_ID'?'9903183013':
  k==='GREEN_API_TOKEN'?'offline-token':''}};
 try{
  const result=await drainWhatsAppOutbox(client,{maxRuntimeMs:12000,
   transport:async(job,provider)=>{sent.push({job,provider});return {messageId:'receipt-feedback-123'};}});
  assert.equal(result.accepted,1,JSON.stringify(result));
  assert.equal(sent.length,1);
  assert.equal(sent[0].provider,'green');
  assert.equal(sent[0].job.source_type,'assignment_button_feedback');
  assert.equal(feedback.status,'accepted');
 }finally{
  if(old===undefined)delete globalThis.Deno;else globalThis.Deno=old;
 }
});
