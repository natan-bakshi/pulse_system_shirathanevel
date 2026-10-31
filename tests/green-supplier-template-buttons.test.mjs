import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 defaultSupplierTemplateButtonPolicy,parseSupplierTemplateButtonPolicy,
 normalizeSupplierTemplateButtonPolicy,saveSupplierTemplateButtonPolicy,
 isSupportedSupplierButtonTemplate,SUPPLIER_TEMPLATE_NAVIGATION_FIELD,
 supplierButtonsForProvenance
} from '../base44/shared/greenSupplierTemplateButtonsPolicy.ts';
import {captureSupplierButtonSnapshot,selectSupplierButtonSnapshot}
 from '../base44/shared/greenSupplierButtonSnapshot.ts';
import {previewGreenSupplierNavigation}
 from '../base44/shared/greenSupplierNavigation.ts';
import {withSupplierPortalLink} from '../base44/shared/supplierPortalLink.ts';
const ID_A='69817697d82b634ef3d7d4df';
const ID_B='69817697d82b634ef3d7d4de';
const ID_CLIENT='69817697d82b634ef3d7d4e4';
const SOURCE='event_reminder';
const both={portal:true,office:true,portalLabel:'',officeLabel:''};
const portal={portal:true,office:false,portalLabel:'יומן',officeLabel:''};
const office={portal:false,office:true,portalLabel:'',officeLabel:'למשרד'};
const eligible=[
 {id:ID_A,type:'SUPPLIER_EVENT_REMINDER',trigger_type:'scheduled_check',
  allowed_channels:['whatsapp'],target_audiences:['supplier']},
 {id:ID_B,type:'SUPPLIER_PENDING_REMINDER',trigger_type:'scheduled_check',
  allowed_channels:['whatsapp'],target_audiences:['supplier']}
];
const admin={id:ID_CLIENT,type:'ADMIN_EVENT_REMINDER',
 trigger_type:'scheduled_check',allowed_channels:['whatsapp'],
 target_audiences:['admin']};
const control=(raw=null)=>({enabled:true,paused:false,
 interactive_assignment_production_enabled:true,
 interactive_outbound_live_enabled:true,
 ...(raw?{[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]:JSON.stringify(raw)}:{})});
const ctx=(source=SOURCE,template=ID_A)=>({
 sourceType:source,notificationTemplateId:template,supplierId:'supplier-123'
});
const rawJob=(source=SOURCE,template=ID_A)=>({
 id:'outbox-123',status:'queued',chat_id:'972501234567@c.us',
 requested_provider:'green',message_type:'text',source_type:source,
 supplier_id:'supplier-123',notification_template_id:template,
 message_text:withSupplierPortalLink('תזכורת לאירוע מחר','supplier-123')
});
const config={enabled:true,legacyProductionApproved:true,accountCapabilityVerified:true,
 capability:'mixed_url',officeNumber:'972541234567',
 officeLabel:'פנייה למשרד',supplierPortalLabel:'כניסה למערכת'};
test('template overrides distinguish two notifications with same source without losing source defaults',()=>{
 const policy=defaultSupplierTemplateButtonPolicy();
 policy.templates[ID_A]=portal;
 policy.templates[ID_B]=office;
 const row=control(policy);
 assert.deepEqual(supplierButtonsForProvenance(row,SOURCE,ID_A),portal);
 assert.deepEqual(supplierButtonsForProvenance(row,SOURCE,ID_B),office);
 assert.deepEqual(supplierButtonsForProvenance(row,SOURCE,'not-saved'),both);
 const snapA=captureSupplierButtonSnapshot(row,ctx(SOURCE,ID_A));
 const snapB=captureSupplierButtonSnapshot(row,ctx(SOURCE,ID_B));
 assert.ok(snapA&&snapB&&snapA!==snapB);
 assert.deepEqual(selectSupplierButtonSnapshot(row,{
  ...rawJob(SOURCE,ID_A),supplier_buttons_snapshot_json:snapA
 }),portal);
 assert.deepEqual(selectSupplierButtonSnapshot(row,{
  ...rawJob(SOURCE,ID_B),supplier_buttons_snapshot_json:snapB
 }),office);
});

test('queued notification frozen buttons cannot change after an owner edits policy',()=>{
 const initial=defaultSupplierTemplateButtonPolicy();
 initial.templates[ID_A]=portal;
 const frozen=captureSupplierButtonSnapshot(control(initial),ctx());
 const changed=defaultSupplierTemplateButtonPolicy();
 changed.templates[ID_A]=office;
 const job={...rawJob(),supplier_buttons_snapshot_json:frozen};
 assert.deepEqual(selectSupplierButtonSnapshot(control(changed),job),portal);
 const preview=previewGreenSupplierNavigation({
  job,provider:'green',control:control(changed),config
 });
 assert.deepEqual(preview.body.buttons.map(x=>x.buttonId),['open_supplier_portal']);
 assert.equal(preview.body.buttons[0].buttonText,'יומן');
 assert.equal(preview.body.chatId,job.chat_id);
 assert.equal(preview.method,'sendInteractiveButtons');
 assert.equal(preview.providerRequestsMade,0);
});

test('invalid snapshots never send interactive buttons or substitute identity',()=>{
 const stored=captureSupplierButtonSnapshot(control(),ctx());
 const job=rawJob();
 const bad=[
  '{broken',
  JSON.stringify({...JSON.parse(stored),templateId:ID_B}),
  JSON.stringify({...JSON.parse(stored),sourceType:'manual_trigger'}),
  JSON.stringify({...JSON.parse(stored),buttons:{portal:true,office:true,
   portalLabel:'',officeLabel:'',url:'https://bad.example'}}),
  JSON.stringify({...JSON.parse(stored),buttons:{portal:true,office:true,
   portalLabel:'',officeLabel:'\n'}}),
  'a'.repeat(900)
 ];
 for(const body of bad){
  const variant={...job,supplier_buttons_snapshot_json:body};
  assert.equal(selectSupplierButtonSnapshot(control(),variant),null);
  assert.equal(previewGreenSupplierNavigation({
   job:variant,provider:'green',control:control(),config
  }),null);
 }
 assert.equal(captureSupplierButtonSnapshot(control(),ctx('scheduled_template','client')), '');
 assert.equal(captureSupplierButtonSnapshot(control(),{
  ...ctx(),supplierId:''}), '');
});

test('invalid overrides cannot enable customer/admin action or unsafe text and corrupt policies fail closed',()=>{
 const ok=defaultSupplierTemplateButtonPolicy();
 ok.templates[ID_A]=portal;
 for(const variant of [
  {...ok,companyId:'another'},
  {...ok,provider:'wasender'},
  {...ok,templates:{[ID_A]:{...portal,url:'https://bad.example'}}},
  {...ok,templates:{[ID_A]:{...portal,officeLabel:'\nheader'}}},
  {...ok,templates:{['..constructor']:portal}},
  {...ok,templates:{[ID_A]:{...portal,office:'true'}}},
  {...ok,version:-1}
 ])assert.throws(()=>normalizeSupplierTemplateButtonPolicy(variant));
 const corrupt={...control(),[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]:'{'};
 assert.equal(parseSupplierTemplateButtonPolicy(corrupt).corrupt,true);
 assert.equal(supplierButtonsForProvenance(corrupt,SOURCE,ID_A),null);
 assert.equal(isSupportedSupplierButtonTemplate(admin),false);
 assert.equal(isSupportedSupplierButtonTemplate(eligible[0]),true);
 assert.equal(isSupportedSupplierButtonTemplate({
  ...eligible[0],type:'SUPPLIER_NEW_ASSIGNMENT'}),false);
});

function dbFixture(all=eligible){
 const row={id:'queue-control-id',control_key:'global',enabled:true,paused:false};
 const count={controlReads:0,templateReads:0,writes:0};
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{
   filter:async()=>{count.controlReads++;return [{...row}]},
   updateMany:async(query,update)=>{
    count.writes++;
    if(query.id!==row.id||query.control_key!=='global'||
     (query[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]??null)!==
       (row[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]??null))return {updated:0};
    Object.assign(row,update.$set);return {updated:1};
   }},
  NotificationTemplate:{list:async()=>{count.templateReads++;return all}}
 }}};
 return {client,row,count};
}
test('owner CAS edits only button JSON; one template list on edit, no worker DB reads',async()=>{
 const {client,row,count}=dbFixture();
 const before={...row};
 const first=await saveSupplierTemplateButtonPolicy(client,{
  expectedVersion:1,templates:{[ID_A]:portal}
 });
 assert.equal(first.setting.version,2);
 assert.equal(first.setting.templates[ID_A].portalLabel,'יומן');
 assert.deepEqual(Object.keys(row).filter(k=>row[k]!==before[k]),
  [SUPPLIER_TEMPLATE_NAVIGATION_FIELD]);
 assert.equal(count.templateReads,1);
 assert.equal(count.writes,1);
 await assert.rejects(saveSupplierTemplateButtonPolicy(client,{
  expectedVersion:1,templates:{[ID_B]:office}
 }),e=>e.status===409);
 assert.equal(count.templateReads,1,'stale tabs never invoke template lookup');
 const sameSource=supplierButtonsForProvenance(row,'event_reminder',ID_B);
 assert.deepEqual(sameSource,both);
});
test('server rejects buttons for a real administrator/client template and keeps old config intact',async()=>{
 const {client,row,count}=dbFixture([...eligible,admin]);
 await assert.rejects(saveSupplierTemplateButtonPolicy(client,{
  expectedVersion:1,templates:{[ID_CLIENT]:portal}
 }),e=>e.status===400);
 assert.equal(count.templateReads,1);
 assert.equal(count.writes,0);
 assert.equal(row[SUPPLIER_TEMPLATE_NAVIGATION_FIELD],undefined);
});
test('producer attribution is additive, real source IDs and idempotency keys unchanged',()=>{
 const outbox=fs.readFileSync('base44/shared/whatsappOutbox.ts','utf8');
 const daily=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
 const manual=fs.readFileSync('base44/functions/manualTriggerNotification/entry.ts','utf8');
 const automated=fs.readFileSync('base44/functions/checkAutomatedTriggers/entry.ts','utf8');
 const pending=fs.readFileSync('base44/functions/processScheduledPushNotifications/entry.ts','utf8');
 assert.match(outbox,/notification_template_id:context.notificationTemplateId/);
 assert.match(outbox,/supplier_buttons_snapshot_json:captureSupplierButtonSnapshot/);
 assert.match(outbox,/isSafeTemplateId\(context.notificationTemplateId\)/);
 assert.match(daily,/notificationTemplateId:supplierReminderTemplate.id/);
 assert.match(daily,/notificationTemplateId:pendingTemplate.id/);
 assert.match(daily,/notificationTemplateId:template.id/);
 assert.match(manual,/notificationTemplateId:supplierObj\?\.id\?template.id/);
 assert.match(automated,/notificationTemplateId:supplier\?\.id\?template.id/);
 assert.match(pending,/notificationTemplateId:pendingData.notification_template_id\|\|''/);
});
test('owner editor is connected to real template inventory, with inherited default and no custom URLs',()=>{
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppTemplateButtonSettings.jsx','utf8');
 const parent=fs.readFileSync('src/components/admin/NotificationManagementTab.jsx','utf8');
 const api=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 assert.match(parent,/<WhatsAppTemplateButtonSettings templates=\{templates\}/);
 assert.match(ui,/action:'supplierTemplateButtonsGet'/);
 assert.match(ui,/action:'supplierTemplateButtonsSave'/);
 assert.match(ui,/expectedVersion:stored.version/);
 assert.match(ui,/value:'inherit'/);
 assert.match(ui,/תצוגה מקדימה/);
 assert.doesNotMatch(ui,/type="url"|eval\(|setInterval\(|new Function\(/);
 assert.match(api,/action==='supplierTemplateButtonsSave'/);
 assert.match(api,/action==='supplierTemplateButtonsGet'/);
});
