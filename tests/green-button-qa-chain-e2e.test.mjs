// Full single-assignment pilot path: REAL production modules, synthetic SDK and Green.
// No provider HTTP, no Base44 production entities and no user phone calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollOneGreenButtonQaAssignment} from '../base44/shared/greenButtonQaEnrollment.ts';
import {processSupplierAssignmentIntents} from '../base44/shared/assignmentIntentReconciler.ts';
import {assignmentWhatsAppContext,supplierAssignmentTargetChatId} from '../base44/shared/assignmentWhatsApp.ts';
import {sendWhatsAppToChat,toChatId} from '../base44/shared/whatsappSend.ts';
import {drainWhatsAppOutbox} from '../base44/shared/whatsappQueueWorker.ts';
import {trustedGreenButtonQaConfig} from '../base44/shared/greenButtonQaLaunch.ts';
import {stageFutureGreenInteractiveHttpCallback} from '../base44/shared/greenInteractiveHttpStaging.ts';
import {handleGreenButtonQaWebhook} from '../base44/shared/greenButtonQaWebhookHandler.ts';
import {persistAuthorizedSupplierStatus} from '../base44/shared/supplierStatusPersistence.ts';
import {GREEN_BUTTON_QA_EVENT_NAME,GREEN_BUTTON_QA_FAMILY_NAME,
 GREEN_BUTTON_QA_SERVICE_NAME} from '../base44/shared/greenButtonQaFixture.ts';

const EVENT='event-qa123',SERVICE='service-qa123',SUPPLIER='supplier-qa123';
const CHAT='972501234567@c.us',INSTANCE='9903183013';
const WEBHOOK='green-offline-qa-webhook-secret-01234567890123';
const SIGNING='green-offline-qa-buttons-signing-secret-01234567890123';
const envValues={
 GREEN_BUTTONS_QA_CREATE_ENABLED:'enabled',GREEN_BUTTONS_QA_SEND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:'enabled',
 GREEN_BUTTONS_QA_POST_REBOOT_SETTINGS_VERIFIED:'confirmed',
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
function fixture({groupPreferred=false,globalV2Enabled=true,betaProbe=false}={}){
 const qaEnv=betaProbe?key=>key==='GREEN_BUTTONS_QA_ACCOUNT_VERIFIED'?
  'probe_authorized':key==='GREEN_BUTTONS_QA_BETA_PROBE_ENABLED'? 'enabled':env(key):env;
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
  id:SERVICE,event_id:EVENT,service_id:'catalog-qa123',
  service_name:GREEN_BUTTON_QA_SERVICE_NAME,updated_date:new Date(now-1000).toISOString(),
  supplier_ids:'[]',supplier_statuses:'{}',supplier_notes:'{}',
  assignment_intent_revision:0,assignment_notification_intents:'[]',is_external:false
 };
 const supplier={id:SUPPLIER,phone:'0501234567',is_active:true,whatsapp_enabled:true,
  preferred_channel:groupPreferred?'group':'phone',
  whatsapp_group_url:groupPreferred?'12345678901234567890@g.us':'',
  contact_person:'SYNTHETIC',
  quiet_hours_enabled:false,respect_shabbat:false};
 const event={id:EVENT,status:'quote',event_name:GREEN_BUTTON_QA_EVENT_NAME,
  family_name:GREEN_BUTTON_QA_FAMILY_NAME,event_type:'other',
  whatsapp_buttons_qa_fixture:true,
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
    return globalV2Enabled?[{setting_key:query.setting_key,setting_value:'true'}]:[];
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
   env:qaEnv,confirmation:'I_APPROVE_ONE_QA_ASSIGNMENT'
  });
 }
 async function reconcile(){
  return processSupplierAssignmentIntents(client,SERVICE);
 }
 async function worker(interactive=true,onTransport=null){
  return drainWhatsAppOutbox(client,{
   maxRuntimeMs:10000,
   ...(interactive?{interactiveConfig:trustedGreenButtonQaConfig(control,qaEnv,true)}:{}),
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
 async function httpCallback(action='assignment_approve',options={}){
  const job=outbox[0],buttons=JSON.parse(job.interactive_button_bindings_json).buttons;
  const button=buttons.find(item=>item.action===action);
  assert.ok(button,'reply ID must come from the signed Outbox snapshot');
  const raw={
   typeWebhook:'incomingMessageReceived',
   idMessage:options.eventId||'C0CD39BB261589D5C98412D255CD000B',
   timestamp:Math.floor(Date.now()/1000),
   instanceData:{idInstance:Number(INSTANCE),typeInstance:'whatsapp'},
   senderData:{chatId:CHAT,sender:CHAT},
   messageData:{
    // Provider's documented mixed-button response (not a free-text message).
    typeMessage:options.singular?'templateButtonReplyMessage':'templateButtonsReplyMessage',
    templateButtonReplyMessage:{
     stanzaId:job.provider_message_id,selectedIndex:0,
     selectedId:button.buttonId,selectedDisplayText:'UNTRUSTED TEXT'
    }
   }
  };
  const request=new Request('https://synthetic.invalid/qa',{
   method:'POST',headers:{
    Authorization:'Bearer '+WEBHOOK,'content-type':'application/json'
   },body:JSON.stringify(raw)
  });
  return handleGreenButtonQaWebhook(request,{
   env:key=>options.sendDisabled&&key==='GREEN_BUTTONS_QA_SEND_ENABLED'
    ?'':qaEnv(key),
   makeClient:()=>client,
   recalculateEventStatus:async(_client,eventId)=>{
    assert.equal(eventId,EVENT);stats.callbackRecalcs++;
   }
  });
 }
 return {client,service,supplier,event,control,outbox,receipts,stats,qaEnv,
  enroll,reconcile,worker,callback,httpCallback};
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
test('ONE unverified GREEN Beta probe may send ONLY approved signed QA buttons and accept the matching signed receipt',async()=>{
 const f=fixture({groupPreferred:true,globalV2Enabled:false,betaProbe:true});
 const config=trustedGreenButtonQaConfig(f.control,f.qaEnv,true);
 assert.ok(config);
 assert.equal(config.accountCapabilityVerified,false,'provider beta is NOT proven before test');
 assert.equal(config.qaBetaProbeApproved,true);
 assert.equal((await f.enroll()).saved,true);
 const queued=await f.reconcile();
 assert.equal(queued.queued,1);
 assert.equal(f.outbox.length,1);
 assert.equal(f.outbox[0].chat_id,CHAT);
 const sent=await f.worker();
 assert.equal(sent.accepted,1);
 assert.equal(f.stats.providerCalls,1,'one provider attempt, not multiple test sends');
 const reply=await f.httpCallback('assignment_approve',{sendDisabled:true});
 assert.equal(reply.httpStatus,200);
 assert.equal(reply.body.received,true);
 assert.equal(f.stats.statusCAS,1);
 assert.equal(f.receipts.length,1);
 assert.equal(f.receipts[0].state,'applied');
 assert.equal(f.supplier.preferred_channel,'group');
 const reread=await f.httpCallback('assignment_approve',{sendDisabled:true});
 assert.equal(reread.httpStatus,200);
 assert.equal(f.stats.statusCAS,1,'duplicate click cannot update supplier');
 assert.equal(f.outbox.length,1);
});
test('SCOPED V2 QA runs with the GLOBAL assignment-intent feature OFF: one event, one private click, zero normal rollout',async()=>{
 const f=fixture({groupPreferred:true,globalV2Enabled:false});
 const enrolled=await f.enroll();
 assert.equal(enrolled.saved,true);
 assert.equal(f.stats.assignmentCAS,1);
 const queued=await f.reconcile();
 assert.equal(queued.queued,1);
 assert.equal(f.outbox.length,1);
 assert.equal(f.outbox[0].chat_id,CHAT);
 assert.equal(f.outbox[0].interactive_qa_required,true);
 const sent=await f.worker();
 assert.equal(sent.accepted,1);
 assert.equal(f.stats.providerCalls,1);
 const reply=await f.httpCallback('assignment_approve',{sendDisabled:true});
 assert.equal(reply.httpStatus,200);
 assert.equal(f.stats.statusCAS,1);
 assert.equal(f.receipts[0].state,'applied');
 assert.equal(f.supplier.preferred_channel,'group');
});
test('GROUP-PREFERRED SUPPLIER: either sender order creates ONE privately addressed signed button Outbox',async()=>{
 for(const order of ['reconciler_first','ensure_first']){
  const f=fixture({groupPreferred:true});
  assert.equal((await f.enroll()).saved,true,order);
  assert.equal(f.supplier.preferred_channel,'group');
  const privateChat=supplierAssignmentTargetChatId(
   f.supplier,f.service,SUPPLIER,toChatId,env,true);
  assert.equal(privateChat,CHAT);
  const context=assignmentWhatsAppContext(f.service,SUPPLIER);
  assert.equal(context.qaButtonsRequired,true);
  if(order==='ensure_first'){
   const a=await sendWhatsAppToChat(privateChat,'ONE synthetic QA assignment',f.client,context);
   assert.equal(a.queued,true);
  }
  const processed=await f.reconcile();
  assert.equal(processed.success,true);
  if(order==='reconciler_first'){
   const b=await sendWhatsAppToChat(privateChat,'ONE synthetic QA assignment',f.client,context);
   assert.equal(b.deduplicated,true);
  }
  assert.equal(f.outbox.length,1,order);
  assert.equal(f.outbox[0].chat_id,CHAT,'pilot must never target the group');
  assert.equal(f.outbox[0].interactive_qa_required,true);
  assert.equal(f.outbox[0].idempotency_key,context.idempotencyKey);
  const sent=await f.worker();
  assert.equal(sent.accepted,1,order);
  assert.equal(f.stats.providerCalls,1);
  const inbound=await f.httpCallback();
  assert.equal(inbound.httpStatus,200);
  assert.equal(f.stats.statusCAS,1);
  assert.equal(f.receipts.length,1);
  assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER],'confirmed');
  assert.equal(f.supplier.preferred_channel,'group','business preference unchanged');
  assert.equal(f.supplier.whatsapp_group_url,'12345678901234567890@g.us');
 }
});
test('PRODUCTION HTTP ADAPTER: original signed reply -> ACK 200 -> one supplier transition, duplicate ACK, outbound send-off remains inbound-on',async()=>{
 const f=fixture();
 assert.equal((await f.enroll()).saved,true);
 await f.reconcile();
 const send=await f.worker();
 assert.equal(send.accepted,1);
 assert.equal(f.stats.providerCalls,1);
 assert.equal(f.outbox[0].interactive_qa_required,true);
 const result=await f.httpCallback('assignment_approve',{sendDisabled:true});
 assert.equal(result.httpStatus,200);
 assert.equal(result.body.received,true);
 assert.equal(result.noProviderCalls,true);
 assert.equal(f.stats.statusCAS,1);
 assert.equal(f.receipts.length,1);
 assert.equal(f.receipts[0].state,'applied');
 assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER],'confirmed');
 const replay=await f.httpCallback('assignment_approve',{sendDisabled:true});
 assert.equal(replay.httpStatus,200,'confirmed duplicate receipt should ACK');
 assert.equal(f.stats.statusCAS,1,'duplicate event must not write supplier again');
 assert.equal(f.stats.providerCalls,1,'no additional provider send');
 assert.equal(f.receipts.length,1,'one durable receipt for one provider event');
 assert.equal(f.outbox.length,1,'no duplicate Outbox');
});
test('post-confirmation opposite button with a distinct Green event cannot reverse the supplier state',async()=>{
 for(const [first,second,expected] of [
  ['assignment_approve','assignment_reject','confirmed'],
  ['assignment_reject','assignment_approve','rejected']
 ]){
  const f=fixture({globalV2Enabled:false,betaProbe:true});
  await f.enroll();await f.reconcile();
  assert.equal((await f.worker()).accepted,1);
  const one=await f.httpCallback(first,{sendDisabled:true,
   eventId:'C0CD39BB261589D5C98412D255CD000E'});
  assert.equal(one.httpStatus,200);
  assert.equal(f.stats.statusCAS,1);
  const opposite=await f.httpCallback(second,{sendDisabled:true,
   eventId:'C0CD39BB261589D5C98412D255CD000F'});
  assert.equal(opposite.httpStatus,200,
   'verified late event is ACKed ONLY after a durable terminal rejection');
  assert.equal(opposite.body.received,true);
  assert.equal(f.stats.statusCAS,1,'no second supplier mutation');
  assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER],expected);
  assert.equal(f.stats.providerCalls,1);
  assert.equal(f.outbox.length,1);
  assert.equal(f.receipts.filter(x=>x.state==='applied').length,1);
  assert.equal(f.receipts.filter(x=>x.state==='rejected').length,1);
  assert.equal(f.receipts.find(x=>x.state==='rejected')?.result_code,
   'business_conflict');
  const replay=await f.httpCallback(second,{sendDisabled:true,
   eventId:'C0CD39BB261589D5C98412D255CD000F'});
  assert.equal(replay.httpStatus,200,'finalized rejection is also idempotent');
  assert.equal(f.stats.statusCAS,1);
  assert.equal(f.receipts.length,2);
 }
});
test('Pulse dashboard approval remains primary and a later signed Green rejection cannot change it',async()=>{
 const f=fixture();
 await f.enroll();await f.reconcile();
 assert.equal((await f.worker()).accepted,1);
 const saved=await persistAuthorizedSupplierStatus(f.client.asServiceRole,{
  eventServiceId:SERVICE,supplierId:SUPPLIER,newStatus:'confirmed',source:'dashboard'
 });
 assert.equal(saved.kind,'changed');
 assert.equal(f.stats.statusCAS,1);
 assert.equal(JSON.parse(f.service.assignment_notification_intents)[0].state,'resolved');
 const late=await f.httpCallback('assignment_reject',{sendDisabled:true,
  eventId:'C0CD39BB261589D5C98412D255CD00AA'});
 assert.equal(late.httpStatus,200,'authenticated stale button terminal rejection is durable');
 assert.equal(late.body.received,true);
 assert.equal(f.stats.statusCAS,1,'no second business write after Pulse approval');
 assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER],'confirmed');
 assert.equal(f.receipts.length,1);
 assert.equal(f.receipts[0].state,'rejected');
 assert.equal(f.receipts[0].result_code,'business_conflict');
 assert.equal(f.stats.providerCalls,1);
});
test('reopening inside Pulse cannot revive previously signed WhatsApp buttons',async()=>{
 const f=fixture();
 await f.enroll();await f.reconcile();
 assert.equal((await f.worker()).accepted,1);
 await persistAuthorizedSupplierStatus(f.client.asServiceRole,{
  eventServiceId:SERVICE,supplierId:SUPPLIER,newStatus:'rejected',source:'dashboard'
 });
 await persistAuthorizedSupplierStatus(f.client.asServiceRole,{
  eventServiceId:SERVICE,supplierId:SUPPLIER,newStatus:'pending',source:'dashboard'
 });
 assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER],'pending');
 const old=await f.httpCallback('assignment_approve',{sendDisabled:true,
  eventId:'C0CD39BB261589D5C98412D255CD00AB'});
 assert.equal(old.httpStatus,200);
 assert.equal(old.body.received,true);
 assert.equal(f.stats.statusCAS,2,'only the in-app reject and reopen changed status');
 assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER],'pending');
 assert.equal(f.receipts[0].state,'rejected');
 assert.equal(f.stats.providerCalls,1);
});
test('PRODUCTION HTTP ADAPTER also accepts documented singular templateButtonReplyMessage sample',async()=>{
 const f=fixture();
 await f.enroll();await f.reconcile();
 assert.equal((await f.worker()).accepted,1);
 const applied=await f.httpCallback('assignment_reject',{
  singular:true,eventId:'C0CD39BB261589D5C98412D255CD000C'
 });
 assert.equal(applied.httpStatus,200);
 assert.equal(applied.body.received,true);
 assert.equal(f.stats.statusCAS,1);
 assert.equal(f.receipts.length,1);
 assert.equal(f.receipts[0].state,'applied');
 assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER],'rejected');
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
