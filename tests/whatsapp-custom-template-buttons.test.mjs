import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizePublicWhatsAppUrl,customLinkDestination,
 normalizeCustomLinks} from '../base44/shared/greenSupplierCustomLinks.ts';
import {defaultSupplierTemplateButtonPolicy,
 SUPPLIER_TEMPLATE_NAVIGATION_FIELD,normalizeSupplierTemplateButtonPolicy,
 parseSupplierTemplateButtonPolicy,saveSupplierTemplateButtonPolicy}
 from '../base44/shared/greenSupplierTemplateButtonsPolicy.ts';
import {captureSupplierButtonSnapshot,selectSupplierButtonSnapshot}
 from '../base44/shared/greenSupplierButtonSnapshot.ts';
import {previewGreenSupplierNavigation,
 verifySupplierNavigationTransport}
 from '../base44/shared/greenSupplierNavigation.ts';
import {withSupplierPortalLink} from '../base44/shared/supplierPortalLink.ts';
import {prepareGreenV2ReminderWorkerCandidate,verifyV2ReminderTransport}
 from '../base44/shared/whatsappV2ReminderOutbound.ts';

const TEMPLATE='69817697d82b634ef3d7d4df';
const TEMPLATE2='69817697d82b634ef3d7d4de';
const EVENT='event-safe-1234';
const SECRET='new-custom-whatsapp-v2-reminder-signing-123456789';
const INSTANCE='9903183013';
const now=Date.parse('2026-11-01T08:00:00Z');
const link=(kind,label,url='')=>({kind,label,url});
const custom=(links,replyLabel='')=>({kind:'custom',links,replyLabel});
const navigation=(links,replyLabel='')=>{
 const setting={...defaultSupplierTemplateButtonPolicy(),schemaVersion:2};
 setting.templates[TEMPLATE]=custom(links,replyLabel);
 return setting;
};
const control=(setting=navigation([
 link('supplier_calendar','לוח אירועים'),
 link('office','משרד')
]))=>({
 id:'global-control',control_key:'global',enabled:true,paused:false,
 interactive_assignment_production_enabled:true,
 interactive_outbound_live_enabled:true,
 interactive_reminder_v2_outbound_enabled:true,
 interactive_reminder_v2_inbound_ever_enabled:true,
 [SUPPLIER_TEMPLATE_NAVIGATION_FIELD]:JSON.stringify(setting)
});
const config={
 enabled:true,legacyProductionApproved:true,accountCapabilityVerified:true,
 capability:'mixed_url',officeNumber:'972541234567',
 officeLabel:'פנייה למשרד',supplierPortalLabel:'כניסה למערכת',
 senderAccountId:INSTANCE,signingSecret:SECRET
};
const job=(overrides={})=>({
 id:'custom-outbox-1234',source_type:'event_reminder',
 source_id:EVENT,message_type:'text',
 message_text:withSupplierPortalLink('נא להגיע בזמן לאירוע','supplier-123'),
 supplier_id:'supplier-123',notification_template_id:TEMPLATE,
 requested_provider:'green',chat_id:'972501234567@c.us',
 status:'queued',attempt_count:0,send_started_at:'',
 provider_message_id:'',sender_account_id:'',assignment_revision:'',
 interactive_button_bindings_json:'',interactive_v2_button_bindings_json:'',
 ...overrides
});
const freeze=(setting,overrides={})=>{
 const ctl=control(setting),record=job(overrides);
 record.supplier_buttons_snapshot_json=captureSupplierButtonSnapshot(ctl,{
  sourceType:record.source_type,
  notificationTemplateId:record.notification_template_id,
  supplierId:record.supplier_id
 });
 return {ctl,record};
};
const preview=(record,ctl)=>previewGreenSupplierNavigation({
 job:record,control:ctl,provider:'green',config
});
const verify=(record,p)=>verifySupplierNavigationTransport(
 {...record,status:'sending'},'green',p
);

test('strict HTTPS validation permits safe real URLs and rejects smuggled/unsafe destinations',()=>{
 assert.equal(normalizePublicWhatsAppUrl('https://www.example.com/docs?a=1'),
  'https://www.example.com/docs?a=1');
 const invalid=[
  'http://www.example.com','javascript:alert(1)','data:text/html,foo',
  '//www.example.com','https://127.0.0.1','https://localhost',
  'https://www.example.invalid','https://host.internal',
  'https://user:pass@www.example.com','https://www.example.com:8443/',
  'https://[::1]/','https://www.example.com\\evil.example/',
  'https://www.example.com/%0AInjected',' https://www.example.com',
  'https://www.example.com/a b','https://www.example.com/'+'x'.repeat(700)
 ];
 for(const url of invalid)assert.throws(()=>normalizePublicWhatsAppUrl(url),url);
 assert.throws(()=>normalizeCustomLinks([link('external','Website','https://ok.com'),
  link('office','Office'),link('office','Again')]));
 assert.throws(()=>normalizeCustomLinks([link('external','Bad','https://ok.com',
 )]));
});
test('custom three navigation buttons are frozen and exact URL/label tampering is rejected',()=>{
 const setting=navigation([
  link('supplier_calendar','לוח אירועים'),
  link('event_details','האירוע שלי'),
  link('external','טופס חיצוני','https://forms.example.com/rsvp?from=wa')
 ]);
 const {ctl,record}=freeze(setting);
 const frozen=JSON.parse(record.supplier_buttons_snapshot_json);
 assert.equal(frozen.version,2);
 assert.equal(frozen.sourceType,'event_reminder');
 const p=preview(record,ctl);
 assert.equal(p.body.buttons.length,3);
 assert.deepEqual(p.body.buttons.map(x=>x.buttonText),
  ['לוח אירועים','האירוע שלי','טופס חיצוני']);
 assert.equal(p.body.buttons[1].url,
  'https://pulse-system.base44.app/EventDetails?id='+EVENT);
 assert.equal(p.body.buttons[2].url,'https://forms.example.com/rsvp?from=wa');
 assert.equal(p.body.body,'נא להגיע בזמן לאירוע');
 assert.equal(verify(record,p),true);
 for(const change of [
  p=>p.body.buttons[1].url='https://untrusted.com/',
  p=>p.body.buttons[2].url='https://untrusted.com/',
  p=>p.body.buttons[0].buttonText='שינוי שיבוץ',
  p=>p.body.buttons.push(p.body.buttons[1]),
  p=>p.body.buttons[2].buttonId='assignment_approve',
  p=>p.body.body='Fake body'
 ]){
  const copy=structuredClone(p);change(copy);
  assert.equal(verify(record,copy),false);
 }
 const edited=navigation([link('external','חדש','https://changed.example.com')]);
 assert.deepEqual(selectSupplierButtonSnapshot(control(edited),record),setting.templates[TEMPLATE]);
 assert.deepEqual(preview(record,control(edited)).body.buttons,p.body.buttons);
});
test('event deep links use only a trusted event-source outbox identity, not text or client templates',()=>{
 const eventLink=link('event_details','לפרטי האירוע');
 assert.equal(customLinkDestination(eventLink,job()),
  'https://pulse-system.base44.app/EventDetails?id='+EVENT);
 for(const fields of [
  {source_type:'manual_trigger'},
  {source_type:'supplier_pending_reminder'},
  {source_id:'../../another-event'},
  {source_id:'https://another.com'},
  {source_id:''},
  {source_id:'a?tab=payments'},
  {source_type:'billing'}
 ])assert.equal(customLinkDestination(eventLink,job(fields)),null);
 const setting=navigation([eventLink]);
 const {ctl,record}=freeze(setting,{source_id:'../../another-event'});
 assert.equal(preview(record,ctl),null,
  'the original TEXT must be sent rather than a wrong smart link');
 assert.equal(verify(record,{kind:'interactive_navigation',
  method:'sendInteractiveButtons',
  body:{chatId:record.chat_id,body:record.message_text,buttons:[]}}),false);
 const unsnap=job({supplier_buttons_snapshot_json:''});
 assert.equal(preview(unsnap,ctl),null,
  'new custom URLs must not apply retroactively to a prior queued job');
});
test('owner CAS validates custom destination, recipient template kind and action count without queue mutation',async()=>{
 const row={id:'one',control_key:'global',enabled:true,paused:false,
  interactive_outbound_live_enabled:true};
 let lists=0,writes=0;
 const supported={id:TEMPLATE,type:'SUPPLIER_EVENT_REMINDER',
  trigger_type:'scheduled_check',allowed_channels:['whatsapp'],
  target_audiences:['supplier']};
 const pending={id:TEMPLATE2,type:'SUPPLIER_PENDING_REMINDER',
  trigger_type:'scheduled_check',allowed_channels:['whatsapp'],
  target_audiences:['supplier']};
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{
   filter:async()=>[{...row}],
   updateMany:async(q,{$set})=>{
    if(q.id!=='one'||q[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]!==(
     row[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]??null))return {updated:0};
    Object.assign(row,$set);writes++;return {updated:1};
   }},
  NotificationTemplate:{list:async()=>{lists++;return [supported,pending]}}
 }}};
 const choice=custom([
  link('supplier_dashboard','השיבוצים שלי'),
  link('external','הקישור שלי','https://www.example.com/info')
 ],'הבנתי');
 const saved=await saveSupplierTemplateButtonPolicy(client,{
  expectedVersion:1,templates:{[TEMPLATE]:choice}
 });
 assert.equal(saved.setting.schemaVersion,2);
 assert.equal(saved.setting.version,2);
 assert.equal(writes,1);
 assert.equal(lists,1);
 assert.equal(row.enabled,true);
 assert.equal(row.interactive_outbound_live_enabled,true);
 assert.deepEqual(parseSupplierTemplateButtonPolicy(row).setting.templates[TEMPLATE],choice);
 await assert.rejects(saveSupplierTemplateButtonPolicy(client,{
  expectedVersion:1,templates:{[TEMPLATE2]:choice}
 }),e=>e.status===409);
 await assert.rejects(saveSupplierTemplateButtonPolicy(client,{
  expectedVersion:2,templates:{[TEMPLATE2]:choice}
 }),/reply_requires_supplier_event_reminder/);
 await assert.rejects(saveSupplierTemplateButtonPolicy(client,{
  expectedVersion:2,templates:{[TEMPLATE]:custom([
   link('external','אחר','javascript:evil()')
  ])}
 }));
 assert.equal(writes,1);
 assert.equal(lists,2,'invalid URL is rejected before checking template registry');
});
test('V1 template policy remains compatible and custom JSON cannot activate arbitrary callbacks',()=>{
 const old=defaultSupplierTemplateButtonPolicy();
 old.templates[TEMPLATE]={portal:true,office:false,portalLabel:'יומן',officeLabel:''};
 assert.deepEqual(normalizeSupplierTemplateButtonPolicy(old),old);
 const v2=navigation([link('supplier_dashboard','שיבוצים')]);
 for(const evil of [
  {...v2,templates:{[TEMPLATE]:{...v2.templates[TEMPLATE],action:'assignment_approve'}}},
  {...v2,templates:{[TEMPLATE]:custom([link('external','X','https://ok.com',
   )], 'קיבלתי', 'assignment_reject')}},
  {...v2,templates:{[TEMPLATE]:{kind:'custom',replyLabel:'קיבלתי',links:[],
   handler:'change_assignment'}}},
  {...v2,schemaVersion:1}
 ])assert.throws(()=>normalizeSupplierTemplateButtonPolicy(evil));
 assert.throws(()=>normalizeSupplierTemplateButtonPolicy(navigation([])));
 assert.throws(()=>normalizeSupplierTemplateButtonPolicy(navigation([
  link('office','משרד'),link('office','משרד שני')
 ])));
 assert.throws(()=>normalizeSupplierTemplateButtonPolicy(navigation([
  link('supplier_calendar','א'),link('supplier_dashboard','ב'),
  link('external','ג','https://ok.com')
 ],'קיבלתי')));
});
function replyFixture(selection){
 const {ctl,record}=freeze(navigation(selection.links,selection.replyLabel));
 const store={...record};
 let updates=0;
 const equal=(q)=>Object.entries(q).every(([k,v])=>(
  store[k]??null)===(v??null));
 const client={asServiceRole:{entities:{WhatsAppOutbox:{
  get:async id=>id===store.id?{...store}:null,
  updateMany:async(q,{$set})=>{
   updates++;
   if(!equal(q))return {updated:0};
   Object.assign(store,$set);return {updated:1};
  }
 }}}};
 return {ctl,store,client,prepare:()=>prepareGreenV2ReminderWorkerCandidate({
  client,job:{...store},provider:'green',control:ctl,config,now
 }),getUpdates:()=>updates};
}
test('custom reminder reply-only button uses existing signed ACK pipeline with editable label',async()=>{
 const fixture=replyFixture({links:[],replyLabel:'ההודעה נקראה'});
 assert.equal(preview(fixture.store,fixture.ctl),null,'reply-only is not sent unsigned');
 const prepared=await fixture.prepare();
 assert.equal(prepared.kind,'reminder_v2');
 assert.equal(fixture.getUpdates(),1);
 assert.deepEqual(prepared.preview.body.buttons.map(x=>[x.type,x.buttonText]),[
  ['reply','ההודעה נקראה']]);
 const valid=await verifyV2ReminderTransport({
  job:{...fixture.store,status:'sending',provider:'green'},
  provider:'green',preview:prepared.preview,signingSecret:SECRET,
  expectedSenderAccountId:INSTANCE,now,
  verifyNavigation:verifySupplierNavigationTransport
 });
 assert.equal(valid,true);
 const bad=structuredClone(prepared.preview);
 bad.body.buttons[0].buttonText='השיבוץ אושר';
 assert.equal(await verifyV2ReminderTransport({
  job:{...fixture.store,status:'sending',provider:'green'},
  provider:'green',preview:bad,signingSecret:SECRET,
  expectedSenderAccountId:INSTANCE,now,
  verifyNavigation:verifySupplierNavigationTransport
 }),false);
 const second=await fixture.prepare();
 assert.equal(second.preview.body.buttons[0].buttonId,
  prepared.preview.body.buttons[0].buttonId);
 assert.equal(fixture.getUpdates(),1,'immutable ACK id and one CAS');
});
test('URL-only custom reminders never create an ACK receipt or extra Green provider call',async()=>{
 const f=replyFixture({links:[
  link('supplier_dashboard','השיבוצים שלי'),
  link('external','פרטים','https://example.com/guide')],replyLabel:''});
 assert.equal(await f.prepare(),null);
 assert.equal(f.getUpdates(),0);
 const p=preview(f.store,f.ctl);
 assert.deepEqual(p.body.buttons.map(x=>x.type),['url','url']);
 assert.equal(verify(f.store,p),true);
 assert.doesNotMatch(fs.readFileSync(
  'base44/shared/greenSupplierCustomLinks.ts','utf8'),
  /Deno\\.serve|fetch\\(|setInterval\\(|eval\\(|new Function\\(/);
});
test('custom editor appears only within the existing owner template-buttons panel',()=>{
 const parent=fs.readFileSync('src/components/admin/notifications/WhatsAppTemplateButtonSettings.jsx','utf8');
 const editor=fs.readFileSync('src/components/admin/notifications/WhatsAppCustomButtonEditor.jsx','utf8');
 assert.match(parent,/WhatsAppCustomButtonEditor/);
 assert.match(parent,/value:'custom'/);
 assert.match(parent,/mode==='custom'/);
 assert.match(editor,/what|מה יקרה בלחיצה/);
 assert.match(editor,/type="url"/);
 assert.match(editor,/replyLabel/);
 assert.match(editor,/קישור חכם לאירוע/);
 assert.match(editor,/תצוגה|כך יופיעו הכפתורים/);
 assert.doesNotMatch(editor,/eval\\(|new Function\\(|functions\\.invoke|setInterval\\(/);
});
