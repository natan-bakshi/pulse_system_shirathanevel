import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSupplierButtonSnapshot,selectSupplierButtonSnapshot}
 from '../base44/shared/greenSupplierButtonSnapshot.ts';
import {defaultSupplierTemplateButtonPolicy,
 SUPPLIER_TEMPLATE_NAVIGATION_FIELD,
 normalizeSupplierTemplateButtonPolicy,saveSupplierTemplateButtonPolicy}
 from '../base44/shared/greenSupplierTemplateButtonsPolicy.ts';
import {previewGreenSupplierNavigation}
 from '../base44/shared/greenSupplierNavigation.ts';
import {optedInPendingQuote,resolvePendingReminderGreenQuote}
 from '../base44/shared/greenPendingReminderQuote.ts';
import {sendWhatsAppTransport} from '../base44/shared/whatsappSend.ts';
import fs from 'node:fs';

const template='template-pending-123456';
const supplier='supplier-123456';
const serviceId='service-pending-123456';
const eventId='event-pending-123456';
const chatId='972501234567@c.us';
const account='9903183013';
const receipt='3EB0AABBCC9988776655';
const assignmentId='outbox-new-assignment-123456';
const now=Date.now();
const actionKey='assignment:'+serviceId+':'+supplier+':r3:SUPPLIER_NEW_ASSIGNMENT';
const intent={key:actionKey,supplier_id:supplier,revision:3,state:'accepted'};
const eventService={
 id:serviceId,event_id:eventId,assignment_intent_mode:'durable_v1',
 supplier_ids:JSON.stringify([supplier]),
 supplier_statuses:JSON.stringify({[supplier]:'pending'}),
 assignment_notification_intents:JSON.stringify([intent])
};
const accepted={
 id:assignmentId,source_type:'assignment_new',status:'accepted',
 provider:'green',requested_provider:'green',company_id:'shirat_hanevel',
 event_service_id:serviceId,supplier_id:supplier,
 chat_id:chatId,sender_account_id:account,
 provider_message_id:receipt,assignment_revision:'r3',
 idempotency_key:actionKey
};
const journal={
 type:'outgoing',idMessage:receipt,chatId,
 sendByApi:true,statusMessage:'delivered',
 timestamp:Math.floor(now/1000)-3600,isDeleted:false,deletedMessageId:''
};
const makeSetting=(quote=true)=>{
 const p={...defaultSupplierTemplateButtonPolicy(),schemaVersion:2};
 p.templates[template]=quote?{
  kind:'custom',links:[],replyLabel:'',quoteSource:'assignment_new'
 }:{kind:'custom',links:[
  {kind:'supplier_calendar',label:'כניסה למערכת',url:''}],replyLabel:''};
 return p;
};
const makeJob=(quote=true)=>({
 id:'outbox-pending-reminder-123456',
 source_type:'supplier_pending_reminder',source_id:serviceId,
 event_service_id:serviceId,supplier_id:supplier,
 notification_template_id:template,message_type:'text',
 message_text:'נא לאשר את השיבוץ',chat_id:chatId,
 status:'sending',requested_provider:'green',provider:'green',
 supplier_buttons_snapshot_json:captureSupplierButtonSnapshot({
  [SUPPLIER_TEMPLATE_NAVIGATION_FIELD]:JSON.stringify(makeSetting(quote))
 },{sourceType:'supplier_pending_reminder',
  notificationTemplateId:template,supplierId:supplier})
});
function fixture({job=makeJob(),service=eventService,
 origins=[accepted],providerJournal=journal}={}){
 const stats={services:0,origins:0,journal:0,reads:0};
 const db={
  EventService:{get:async id=>{stats.services++;
   assert.equal(id,serviceId);return service;}},
  WhatsAppOutbox:{filter:async(q,sort,limit)=>{
   stats.origins++;
   assert.deepEqual(q,{
    source_type:'assignment_new',event_service_id:serviceId,
    supplier_id:supplier
   });
   assert.equal(sort,'-created_date');assert.equal(limit,2);
   return structuredClone(origins);
  }}
 };
 const client={asServiceRole:{entities:db}};
 const choose=()=>resolvePendingReminderGreenQuote({
  client,job,provider:'green',senderAccountId:account,now,
  getGreenMessage:async(chat,id)=>{
   stats.journal++;
   assert.equal(chat,chatId);assert.equal(id,receipt);
   return structuredClone(providerJournal);
  }
 });
 return {client,job,stats,choose};
}
test('owner-selected pending reminder freezes a text-only quote snapshot v3',()=>{
 const job=makeJob();
 assert.equal(JSON.parse(job.supplier_buttons_snapshot_json).version,3);
 assert.equal(selectSupplierButtonSnapshot(null,job).quoteSource,'assignment_new');
 assert.equal(optedInPendingQuote(job,'green',account),true);
 assert.equal(previewGreenSupplierNavigation({job:{...job,status:'queued'},
  provider:'green',control:{},config:{capability:'mixed_url'}}),null);
 const old=makeJob(false);
 assert.equal(JSON.parse(old.supplier_buttons_snapshot_json).version,2);
 assert.equal(optedInPendingQuote(old,'green',account),false);
 const saved=normalizeSupplierTemplateButtonPolicy(makeSetting());
 assert.equal(saved.schemaVersion,2);
 assert.throws(()=>normalizeSupplierTemplateButtonPolicy({
  ...makeSetting(),templates:{
   [template]:{...makeSetting().templates[template],links:[
    {kind:'external',label:'אתר',url:'https://example.com'}]}
  }}),/quote_requires_text_only/);
 assert.throws(()=>normalizeSupplierTemplateButtonPolicy({
  ...makeSetting(),templates:{
   [template]:{...makeSetting().templates[template],quoteSource:'billing'}
  }}),/invalid_quote_source/);
});
test('same revision, same Green instance and delivered journal produce a true native quote',async()=>{
 const f=fixture(),q=await f.choose();
 assert.equal(q.quotedMessageId,receipt);
 assert.equal(q.providerReads,1);
 assert.equal(f.stats.services,1);
 assert.equal(f.stats.origins,1);
 assert.equal(f.stats.journal,1);
});
test('no preference, wrong account, wrong recipient, wrong source never makes a provider read',async()=>{
 for(const [job,provider,sender] of [
  [makeJob(false),'green',account],
  [makeJob(),'wasender',account],
  [{...makeJob(),source_type:'event_reminder'},'green',account],
  [{...makeJob(),event_service_id:'different-service'},'green',account],
  [{...makeJob(),chat_id:'120010101010@g.us'},'green',account],
  [{...makeJob(),sender_account_id:'9903183014'},'green',account],
  [{...makeJob(),interactive_button_bindings_json:'signed'},'green',account],
  [{...makeJob(),status:'failed'},'green',account],
  [makeJob(),'green','']
 ]){
  const f=fixture({job});
  const q=await resolvePendingReminderGreenQuote({
   client:f.client,job,provider,senderAccountId:sender,
   getGreenMessage:async()=>{f.stats.journal++;throw Error('Must not read');},now
  });
  assert.equal(q.quotedMessageId,null);
  assert.equal(q.providerReads,0);
  assert.equal(f.stats.journal,0);
 }
});
test('a stale assignment, foreign recipient, changed status or newer attempt blocks quote before Green read',async()=>{
 const states=[
  {...eventService,supplier_statuses:JSON.stringify({[supplier]:'rejected'})},
  {...eventService,supplier_ids:JSON.stringify(['someone-else'])},
  {...eventService,assignment_intent_mode:'legacy'},
  {...eventService,assignment_notification_intents:JSON.stringify([
   {...intent,key:'assignment:'+serviceId+':'+supplier+':r4:SUPPLIER_NEW_ASSIGNMENT',revision:4}])}
 ];
 for(const service of states){
  const f=fixture({service});
  const q=await f.choose();
  assert.equal(q.quotedMessageId,null);
  assert.equal(f.stats.journal,0);
 }
 for(const orig of [
  {...accepted,status:'unknown'},
  {...accepted,sender_account_id:'9903183014'},
  {...accepted,chat_id:'972509999999@c.us'},
  {...accepted,idempotency_key:'assignment:changed:supplier:r3:SUPPLIER_NEW_ASSIGNMENT'},
  {...accepted,assignment_revision:'r2'},
  {...accepted,provider_message_id:''}
 ]){
  const f=fixture({origins:[orig]});
  const q=await f.choose();
  assert.equal(q.quotedMessageId,null);
  assert.equal(f.stats.journal,0);
 }
 const collision=fixture({origins:[accepted,{...accepted,id:'outbox-duplicate-assignment'}]});
 assert.equal((await collision.choose()).quotedMessageId,null);
 assert.equal(collision.stats.journal,0);
});
test('Green receipt absent/failed/sent/incoming/foreign or stale journal falls back before dispatch',async()=>{
 for(const replacement of [
  null,{...journal,statusMessage:'sent'},
  {...journal,statusMessage:'failed'},
  {...journal,sendByApi:false},
  {...journal,type:'incoming'},
  {...journal,chatId:'972509999999@c.us'},
  {...journal,idMessage:'other-message-receipt'},
  {...journal,isDeleted:true},
  {...journal,timestamp:Math.floor(now/1000)-91*86400},
  {...journal,timestamp:Math.floor(now/1000)+1000}
 ]){
  const f=fixture({providerJournal:replacement});
  const q=await f.choose();
  assert.equal(q.quotedMessageId,null);
  assert.equal(q.providerReads,1);
  assert.equal(f.stats.journal,1);
 }
});
test('unsupported target template cannot be used for quote-only settings',async()=>{
 const setting=makeSetting();
 const read={id:'global',control_key:'global',
  [SUPPLIER_TEMPLATE_NAVIGATION_FIELD]:null};
 const templateRow={
  id:template,type:'SUPPLIER_EVENT_REMINDER',
  target_audiences:['supplier'],allowed_channels:['whatsapp']
 };
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{
   filter:async()=>[read],updateMany:async()=>{throw Error('Must not update');}
  },
  NotificationTemplate:{list:async()=>[templateRow]}
 }}};
 await assert.rejects(saveSupplierTemplateButtonPolicy(client,{
  expectedVersion:1,templates:setting.templates
 }),/quote_requires_pending_assignment_reminder/);
});
test('Green sendMessage integration makes exactly one GetMessage and ONE send when quote verified',async()=>{
 const oldDeno=globalThis.Deno,oldFetch=globalThis.fetch;
 const calls=[],f=fixture();
 try{
  globalThis.Deno={env:{get:(name)=>({
   GREEN_API_INSTANCE_ID:account,GREEN_API_TOKEN:'mock-green-token'
  })[name]??''}};
  globalThis.fetch=async (url,options)=>{
   calls.push({url:String(url),body:JSON.parse(options.body)});
   if(String(url).includes('/getMessage/'))return Response.json(journal);
   if(String(url).includes('/sendMessage/'))return Response.json({idMessage:'3EB0SENTNEW123456789'});
   throw Error('Unexpected provider API');
  };
  const receipt=await sendWhatsAppTransport(f.job,'green',f.client);
  assert.equal(receipt.messageId,'3EB0SENTNEW123456789');
  assert.equal(calls.length,2);
  assert.equal(calls[0].body.idMessage,accepted.provider_message_id);
  assert.equal(calls[0].body.chatId,chatId);
  assert.equal(calls[1].body.quotedMessageId,accepted.provider_message_id);
  assert.equal(calls[1].body.message,f.job.message_text);
 }finally{globalThis.Deno=oldDeno;globalThis.fetch=oldFetch;}
});
test('Green GetMessage outage sends original text ONCE without quotedMessageId',async()=>{
 const oldDeno=globalThis.Deno,oldFetch=globalThis.fetch;
 const calls=[],f=fixture();
 try{
  globalThis.Deno={env:{get:name=>({
   GREEN_API_INSTANCE_ID:account,GREEN_API_TOKEN:'mock-green-token'
  })[name]??''}};
  globalThis.fetch=async(url,options)=>{
   calls.push({url:String(url),body:JSON.parse(options.body)});
   if(String(url).includes('/getMessage/'))throw Error('provider timeout');
   if(String(url).includes('/sendMessage/'))return Response.json({idMessage:'3EB0SENTNEW123456789'});
   throw Error('Unexpected provider API');
  };
  await sendWhatsAppTransport(f.job,'green',f.client);
  assert.equal(calls.length,2,'one read plus only one send');
  assert.equal(Object.hasOwn(calls[1].body,'quotedMessageId'),false);
  assert.equal(calls[1].body.message,f.job.message_text);
 }finally{globalThis.Deno=oldDeno;globalThis.fetch=oldFetch;}
});
test('the template editor includes explicit opt-in, cost warning and automatic buttons exclusion',()=>{
 const editor=fs.readFileSync('src/components/admin/notifications/WhatsAppCustomButtonEditor.jsx','utf8');
 assert.match(editor,/quoteSource:'assignment_new'/);
 assert.match(editor,/ציטוט הודעת השיבוץ המקורית/);
 assert.match(editor,/GetMessage|קריאת בדיקה אחת/);
 assert.match(editor,/quoteEnabled&&total<3/);
 const transport=fs.readFileSync('base44/shared/whatsappSend.ts','utf8');
 assert.match(transport,/getGreenQuoteMessage/);
 assert.match(transport,/resolvePendingReminderGreenQuote/);
 assert.doesNotMatch(transport,/quotedMessageId.*sendInteractiveButtons/);
});
