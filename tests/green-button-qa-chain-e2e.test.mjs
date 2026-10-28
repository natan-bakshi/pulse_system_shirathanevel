// Full single-assignment pilot path: REAL production modules, synthetic SDK and Green.
// No provider HTTP, no Base44 production entities and no user phone calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollOneGreenButtonQaAssignment} from '../base44/shared/greenButtonQaEnrollment.ts';
import {processSupplierAssignmentIntents} from '../base44/shared/assignmentIntentReconciler.ts';
import {assignmentWhatsAppContext} from '../base44/shared/assignmentWhatsApp.ts';
import {sendWhatsAppToChat} from '../base44/shared/whatsappSend.ts';
import {drainWhatsAppOutbox} from '../base44/shared/whatsappQueueWorker.ts';
import {trustedGreenButtonQaConfig} from '../base44/shared/greenButtonQaLaunch.ts';
import {stageFutureGreenInteractiveHttpCallback} from '../base44/shared/greenInteractiveHttpStaging.ts';

const EVENT='event-qa123',SERVICE='service-qa123',SUPPLIER='supplier-qa123';
const CHAT='972501234567@c.us',INSTANCE='9903183013';
const WEBHOOK='green-offline-qa-webhook-secret-01234567890123';
const SIGNING='green-offline-qa-buttons-signing-secret-01234567890123';
const envValues={
 GREEN_BUTTONS_QA_CREATE_ENABLED:'enabled',GREEN_BUTTONS_QA_SEND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'verified',
 GREEN_BUTTONS_QA_OWNER_APPROVED:'approved',GREEN_BUTTONS_QA_EVENT_ID:EVENT,
 GREEN_BUTTONS_QA_EVENT_SERVICE_ID:SERVICE,GREEN_BUTTONS_QA_SUPPLIER_ID:SUPPLIER,
 GREEN_BUTTONS_QA_ALLOWED_CHAT:CHAT,GREEN_API_INSTANCE_ID:INSTANCE,
 GREEN_API_TOKEN:'offline-account-token-01234567890123456789',
 GREEN_API_WEBHOOK_TOKEN:WEBHOOK,WHATSAPP_INTERACTIVE_SIGNING_SECRET:SIGNING
};
const env=key=>envValues[key]||'';
const oldDeno=globalThis.Deno;
globalThis.Deno={env:{get:env}};
test.after(()=>{if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;});
const policy=JSON.stringify({
 companyId:'shirat_hanevel',provider:'green',messageKind:'assignment',
 version:1,officeNumber:'972551111111',
 policy:{enabled:false,quoteAssignment:false,buttons:[
  {action:'assignment_approve',label:'מאשר'},
  {action:'assignment_reject',label:'דוחה'},
  {action:'contact_office',label:'פנייה למשרד'}]}
});
function fixture(){
 const now=Date.now();
 const control={
  id:'control-qa1',control_key:'global',enabled:true,paused:false,
  interactive_outbound_live_enabled:true,
  interactive_assignment_green_policy_json:policy,
  green_interval_ms:0,wasender_interval_ms:0,max_messages_per_run:16,
  min_interval_seconds:0,lease_owner:'',lease_until:'',enqueue_owner:'',
  enqueue_until:'',last_dispatched_at:'',last_green_dispatched_at:'',
  inbound_guard_key:'',inbound_create_owner:'',inbound_create_until:''
 };
 const service={
  id:SERVICE,event_id:EVENT,service_id:'catalog-qa123',updated_date:new Date(now-1000).toISOString(),
  supplier_ids:'[]',supplier_statuses:'{}',supplier_notes:'{}',
  assignment_intent_revision:0,assignment_notification_intents:'[]',is_external:false
 };
 const supplier={id:SUPPLIER,phone:'0501234567',is_active:true,whatsapp_enabled:true,
  preferred_channel:'phone',contact_person:'SYNTHETIC',
  quiet_hours_enabled:false,respect_shabbat:false};
 const event={id:EVENT,status:'confirmed',event_name:'SYNTHETIC',
  event_date:'2026-11-30',event_time:'10:00'};
 const outbox=[],receipts=[];
 const stats={assignmentCAS:0,statusCAS:0,wakes:0,creates:0,providerCalls:0,
  receiptCreates:0,callbackRecalcs:0};
 let sequence=0;
 const match=(row,query={})=>Object.entries(query).every(([key,value])=>{
  const actual=row[key]??null;
  if(value&&typeof value==='object'){
   if('$in' in value)return value.$in.includes(actual);
   if('$lte' in value)return String(actual||'')<=String(value.$lte);
   if('$gte' in value)return String(actual||'')>=String(value.$gte);
  }
  return actual===(value??null);
 });
 const api=(records,name)=>({
  get:async id=>structuredClone(records.find(x=>x.id===id)||null),
  filter:async(query={},sort='created_date',limit=50,offset=0,fields=null)=>{
   const field=String(sort||'created_date').replace(/^-/,''),direction=String(sort).startsWith('-')?-1:1;
   return records.filter(x=>match(x,query)).sort((a,b)=>
    direction*String(a[field]||'').localeCompare(String(b[field]||'')))
    .slice(offset,offset+limit).map(x=>structuredClone(x));
  },
  create:async fields=>{
   const row={...fields,id:name+'-'+(++sequence),
    created_date:new Date(now+sequence).toISOString()};
   records.push(row);
   if(name==='job')stats.creates++;
   if(name==='receipt')stats.receiptCreates++;
   return structuredClone(row);
  },
  updateMany:async(query,operation)=>{
   const matching=records.filter(x=>match(x,query));
   for(const item of matching)Object.assign(item,operation.$set||{});
   return {updated:matching.length};
  },
  update:async(id,patch)=>{
   const item=records.find(x=>x.id===id);
   if(!item)throw new Error('mock_not_found');
   Object.assign(item,patch);return structuredClone(item);
  }
 });
 const controlApi=api([control],'control');
 const outboxApi=api(outbox,'job');
 const inboxApi=api(receipts,'receipt');
 const eventServiceApi={
  get:async id=>id===SERVICE?structuredClone(service):null,
  filter:async(query,sort,limit)=>query.assignment_intents_pending===true&&
    service.assignment_intents_pending===true?[{id:service.id}]:[],
  updateMany:async(query,change)=>{
   if(!match(service,query))return {updated:0};
   Object.assign(service,change.$set||{});
   if('supplier_ids' in (change.$set||{}))stats.assignmentCAS++;
   if('supplier_statuses' in (change.$set||{})&&
     !('supplier_ids' in (change.$set||{})))stats.statusCAS++;
   service.updated_date=new Date(Date.parse(service.updated_date)+1).toISOString();
   return {updated:1};
  },
  update:async(id,patch)=>{
   if(id!==SERVICE)throw Error('wrong_service');
   Object.assign(service,patch);stats.wakes++;
   service.updated_date=new Date(Date.parse(service.updated_date)+1).toISOString();
   return structuredClone(service);
  }
 };
 const db={
  WhatsAppQueueControl:controlApi,WhatsAppOutbox:outboxApi,
  WhatsAppInboundReceipt:inboxApi,EventService:eventServiceApi,
  Supplier:{get:async id=>id===SUPPLIER?structuredClone(supplier):null},
  Event:{get:async id=>id===EVENT?structuredClone(event):null},
  Service:{get:async()=>({id:'catalog-qa123',service_name:'Music'})},
  AppSettings:{filter:async query=>{
   if(query.setting_key==='assignment_intent_v1_enabled')
    return [{setting_key:query.setting_key,setting_value:'true'}];
   if(query.setting_key==='whatsapp_default_provider')
    return [{setting_key:query.setting_key,setting_value:'green'}];
   throw Error('unexpected_settings_query');
  }},
  NotificationTemplate:{filter:async()=>[{
   type:'SUPPLIER_NEW_ASSIGNMENT',is_active:true,allowed_channels:['whatsapp'],
   whatsapp_body_template:'שיבוץ {{service_name}} {{event_date}}'
  }]}
 };
 const client={asServiceRole:{entities:db}};
 async function enroll(){
  return enrollOneGreenButtonQaAssignment(client,{
   env,confirmation:'I_APPROVE_ONE_QA_ASSIGNMENT'
  });
 }
 async function reconcile(){
  return processSupplierAssignmentIntents(client,SERVICE);
 }
 async function worker(interactive=true,onTransport=null){
  return drainWhatsAppOutbox(client,{
   maxRuntimeMs:10000,
   ...(interactive?{interactiveConfig:trustedGreenButtonQaConfig(control,env,true)}:{}),
   transport:async(job,provider,_client,preview)=>{
    stats.providerCalls++;
    if(onTransport)return onTransport(job,provider,preview);
    return {messageId:'3EB0QAORIGINAL123456789ABC'};
   }
  });
 }
 async function callback(action='assignment_approve',id='C0CD39BB261589D5C98412D255CD000B'){
  const job=outbox[0],buttons=JSON.parse(job.interactive_button_bindings_json).buttons;
  const button=buttons.find(x=>x.action===action);
  assert.ok(button,'synthetic signed original button exists');
  const raw={typeWebhook:'incomingMessageReceived',idMessage:id,
   timestamp:Math.floor(Date.now()/1000),
   instanceData:{idInstance:Number(INSTANCE),typeInstance:'whatsapp'},
   senderData:{chatId:CHAT,sender:CHAT},
   messageData:{typeMessage:'interactiveButtonsResponse',
    quotedMessage:{stanzaId:job.provider_message_id},
    interactiveButtonsResponse:{stanzaId:job.provider_message_id,
     selectedId:button.buttonId,selectedDisplayText:'UNTRUSTED'}}};
  const request=new Request('https://invalid.example.test/callback',{
   method:'POST',headers:{Authorization:'Bearer '+WEBHOOK,
    'content-type':'application/json'},body:JSON.stringify(raw)
  });
  return stageFutureGreenInteractiveHttpCallback(request,{
   client,rolloutAuthorized:true,accountCapabilityVerified:true,
   webhookSecret:WEBHOOK,actionSigningSecret:SIGNING,
   expectedInstanceId:INSTANCE,claimOwner:'qa-mock-test-owner',
   qaChatId:CHAT,qaEventServiceId:SERVICE,qaSupplierId:SUPPLIER,
   recalculateEventStatus:async(eventId)=>{
    assert.equal(eventId,EVENT);stats.callbackRecalcs++;
   }
  });
 }
 return {client,service,supplier,event,control,outbox,receipts,stats,
  enroll,reconcile,worker,callback};
}
test('FULL PILOT: enrollment -> durable V2 -> Outbox once -> signed Green preview once -> callback -> durable receipt -> duplicate no-op',async()=>{
 const f=fixture();
 assert.equal((await f.enroll()).saved,true);
 assert.equal(f.stats.assignmentCAS,1);
 assert.equal(f.stats.wakes,1);
 const journal=JSON.parse(f.service.assignment_notification_intents);
 assert.equal(journal.length,1);
 assert.equal(journal[0].qa_buttons_required,true);
 const expectedKey='assignment:'+SERVICE+':'+SUPPLIER+':r1:SUPPLIER_NEW_ASSIGNMENT';
 assert.equal(journal[0].key,expectedKey);
 const alsoProducer=assignmentWhatsAppContext(f.service,SUPPLIER);
 assert.equal(alsoProducer.qaButtonsRequired,true,
  'explicit ensure and event reconciler share the immutable QA marker');
 assert.equal(alsoProducer.idempotencyKey,expectedKey);
 const [first,second]=await Promise.all([f.reconcile(),f.reconcile()]);
 assert.equal(f.stats.creates,1,'concurrent wake may enqueue only one job');
 assert.equal(f.outbox[0].idempotency_key,expectedKey);
 assert.equal(f.outbox[0].interactive_qa_required,true);
 assert.equal(f.outbox[0].status,'queued');
 assert.ok(first.queued+second.queued>=1);
 assert.equal((await f.reconcile()).processed,0,'extra wake cannot create a second job');
 const sent=[];
 const worker=await f.worker(true,(job,provider,preview)=>{
  sent.push({job,provider,preview});return {messageId:'3EB0QAORIGINAL123456789ABC'};
 });
 assert.equal(worker.accepted,1,JSON.stringify({worker,jobs:f.outbox,control:f.control,stats:f.stats}));
 assert.equal(f.stats.providerCalls,1);
 assert.equal(f.outbox[0].status,'accepted');
 assert.equal(sent[0].provider,'green');
 assert.equal(sent[0].preview.method,'sendInteractiveButtons');
 assert.deepEqual(sent[0].preview.body.buttons.map(x=>x.type),
  ['reply','reply','url']);
 assert.equal(sent[0].preview.body.buttons[2].url.includes('wa.me'),true);
 assert.equal(f.outbox[0].assignment_revision,'r1');
 assert.equal(f.stats.assignmentCAS,1);
 const applied=await f.callback();
 assert.equal(applied.stage,'processed');
 assert.equal(applied.result,'applied');
 assert.equal(f.stats.statusCAS,1,'one supplier status CAS');
 assert.equal(f.receipts.length,1);
 assert.equal(f.receipts[0].state,'applied');
 assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER],'confirmed');
 const replay=await f.callback();
 assert.equal(replay.result,'duplicate');
 assert.equal(replay.terminalReceiptVerified,true);
 assert.equal(f.stats.statusCAS,1);
 assert.equal(f.stats.providerCalls,1);
 assert.equal((await f.worker(true)).reason,'empty','no resend after receipt');
 assert.equal(f.stats.providerCalls,1);
 assert.equal(f.outbox.length,1);
});
test('the existing explicit assignment safeguard can enqueue first without losing pilot-only marker or creating duplicates',async()=>{
 const f=fixture();
 await f.enroll();
 const context=assignmentWhatsAppContext(f.service,SUPPLIER);
 assert.equal(context.qaButtonsRequired,true);
 const first=await sendWhatsAppToChat(CHAT,'One synthetic assignment',f.client,context);
 assert.equal(first.queued,true);
 assert.equal(f.outbox[0].interactive_qa_required,true);
 const settled=await f.reconcile();
 assert.equal(settled.queued,1);
 assert.equal(f.outbox.length,1,'existing sender and reconciler share one Outbox row');
 assert.equal(JSON.parse(f.service.assignment_notification_intents)[0].outbox_id,
  f.outbox[0].id);
 const again=await f.reconcile();
 assert.equal(again.processed,0);
 assert.equal(f.stats.assignmentCAS,1);
});
test('pilot-marked target with a changed QA scope is held and is never converted into legacy text',async()=>{
 const f=fixture();await f.enroll();await f.reconcile();
 const authorized=trustedGreenButtonQaConfig(f.control,env,true);
 let sent=0;
 const result=await drainWhatsAppOutbox(f.client,{
  interactiveConfig:{...authorized,qaSupplierId:'supplier-other'},
  transport:async()=>{sent++;throw Error('no transport for mis-scoped target');}
 });
 assert.equal(result.failed,1);
 assert.equal(sent,0);
 assert.equal(f.outbox[0].status,'failed');
 assert.equal(f.outbox[0].attempt_count,0);
 assert.equal(f.outbox[0].interactive_button_bindings_json,undefined);
});
test('rollback BEFORE any button snapshot holds that assignment, while unrelated WhatsApp still flows',async()=>{
 const f=fixture();
 await f.enroll();
 await f.reconcile();
 assert.equal(f.outbox[0].interactive_qa_required,true);
 assert.equal(f.outbox[0].interactive_button_bindings_json,undefined);
 f.control.interactive_outbound_live_enabled=false;
 const second=await sendWhatsAppToChat('972509999999@c.us','Invoice test',f.client,{
  sourceType:'invoice',idempotencyKey:'invoice:synthetic-qa1'
 });
 assert.equal(second.queued,true);
 const sent=[];
 const res=await f.worker(false,(job,provider,preview)=>{
  sent.push(job.source_type);
  assert.equal(preview,null);
  return {messageId:'synthetic-invoice-success'};
 });
 assert.equal(res.failed,1,JSON.stringify({res,jobs:f.outbox,control:f.control,stats:f.stats}));
 assert.equal(res.accepted,1);
 assert.deepEqual(sent,['invoice']);
 assert.equal(f.outbox[0].status,'failed');
 assert.equal(f.outbox[0].attempt_count,0);
 assert.equal(f.outbox[0].interactive_button_bindings_json,undefined);
 assert.equal(f.outbox[1].status,'accepted');
 assert.equal((await f.reconcile()).processed,0);
 assert.equal(f.stats.assignmentCAS,1);
});
test('explicit safeguard cannot silently convert a marked V2 QA job to plain text on disabled queue',async()=>{
 const f=fixture();await f.enroll();
 f.control.enabled=false;
 const context=assignmentWhatsAppContext(f.service,SUPPLIER);
 assert.equal(context.qaButtonsRequired,true);
 await assert.rejects(sendWhatsAppToChat(CHAT,'QA text forbidden',f.client,context),
  /durable WhatsApp queue/);
 assert.equal(f.outbox.length,0);
 assert.equal(f.stats.providerCalls,0);
});
