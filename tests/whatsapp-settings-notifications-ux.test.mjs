import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import esbuild from 'esbuild';

const read=path=>fs.readFileSync(path,'utf8');
const settings=()=>read('src/pages/SettingsPage.jsx');
const manager=()=>read('src/components/admin/NotificationManagementTab.jsx');
const queue=()=>read('src/components/admin/notifications/WhatsAppQueueSettings.jsx');
const buttons=()=>read('src/components/admin/notifications/WhatsAppSupplierNoticeButtons.jsx');

test('one canonical WhatsApp location under Notifications, never duplicate technical controls in General',()=>{
 const page=settings(),management=manager();
 const before=page.split('<TabsContent value="general"')[1].split('<TabsContent value="notifications"')[0];
 const notifications=page.split('<TabsContent value="notifications"')[1].split('<TabsContent value="backup"')[0];
 assert.doesNotMatch(before,/WhatsAppQueueSettings|WhatsAppProviderStatus|הגדרות ספק WhatsApp/);
 assert.match(notifications,/<NotificationManagementTab \/>/);
 assert.match(management,/<TabsTrigger value="whatsapp"/);
 assert.match(management,/<WhatsAppProviderStatus\s*\/>/);
 assert.match(management,/<WhatsAppQueueSettings\s*\/>/);
 for(const tag of ['WhatsAppProviderStatus','WhatsAppQueueSettings',
  'WhatsAppSupplierNoticeButtons','WhatsAppReminderAckSettings','WhatsAppLiveButtonSettings']){
  assert.equal((management.match(new RegExp('<'+tag+'\\b','g'))||[]).length,1,
   'exactly one canonical mounted editor for '+tag);
 }
 assert.doesNotMatch(queue(),/<WhatsAppLiveButtonSettings|<WhatsAppSupplierNoticeButtons/);
 const form=read('src/components/admin/notifications/NotificationTemplateForm.jsx');
 assert.equal((form.match(/<WhatsAppTemplateButtonsTab\b/g)||[]).length,1);
 assert.doesNotMatch(management,/<WhatsAppTemplateButtonSettings/);
});
test('nontechnical controls are grouped by tasks with previews and no arbitrary URL/handler field',()=>{
 const manage=manager(),panel=buttons();
 for(const label of ['סוגי התראות','כפתורים בהודעות','חיבור ושליחת WhatsApp','סטטיסטיקות'])
  assert.ok(manage.includes(label),label);
 for(const label of ['שיבוץ חדש לספק','תזכורות והודעות לספקים',
  'לא צריך לכתוב קישור','תצוגה מקדימה','לוח האירועים של הספק',
  'אסמכתת ההודעה','שמור בחירת כפתורים','בטל שינויים'])
  assert.ok((manage+panel).includes(label),label);
 for(const value of ['both','portal','office','none'])
  assert.match(panel,new RegExp("value:'"+value+"'"));
 assert.match(panel,/OPTIONS\.map\(option=>/);
 assert.match(panel,/source\.title/);
 assert.match(panel,/aria-label=/);
 assert.doesNotMatch(panel,/type="url"|type="text"[^>]*url|eval\(|new Function\(/);
 // Every source configuration has exactly the two vetted destinations,
 // not a user-programmable JavaScript action or external forwarding endpoint.
 assert.match(panel,/action:'supplierNavigationSave'/);
 assert.match(panel,/expectedVersion:saved\.version/);
});
test('source-wide vs template-specific scope is stated explicitly; no misleading per-template save switch',()=>{
 const manage=manager(),panel=buttons();
 assert.match(panel,/ההגדרות של ההודעות המתוזמנות משותפות כרגע לסוג השליחה/);
 assert.match(panel,/לא נפרדות לכל תבנית/);
 assert.match(manage,/כפתורים חדשים שמשנים מידע במערכת יופיעו לבחירה רק לאחר/);
 const form=read('src/components/admin/notifications/NotificationTemplateForm.jsx');
 assert.doesNotMatch(form,/WhatsAppSupplierNoticeButtons|supplierNavigationSave/,
  'a global source setting must not masquerade as one NotificationTemplate setting');
});
test('one plainly explained production reminder ACK toggle stays off until owner confirmation and backend readiness',()=>{
 const managerText=manager();
 const panel=read('src/components/admin/notifications/WhatsAppReminderAckSettings.jsx');
 const owner=read('base44/functions/WhatsAppQueueAdmin/entry.ts');
 assert.match(managerText,/<WhatsAppReminderAckSettings\s*\/>/);
 assert.match(panel,/אישור קבלת תזכורת/);
 assert.match(panel,/הכפתור אינו מאשר או דוחה שיבוץ/);
 assert.match(panel,/תגובת.+?לחיצה|בלחיצה/);
 assert.match(panel,/action:'reminderV2Get'/);
 assert.match(panel,/reminderV2Enable/);
 assert.match(panel,/reminderV2Disable/);
 assert.match(panel,/ENABLE_GREEN_SUPPLIER_REMINDER_ACKNOWLEDGEMENT/);
 assert.match(panel,/disabled=\{busy\|\|!status\.ready\}/);
 assert.match(panel,/window\.confirm\(/);
 assert.match(panel,/if\(e\.currentTarget\.open&&!status&&!busy\)void load\(\)/);
 assert.doesNotMatch(panel,/setInterval\(|setTimeout\(|fetch\(|type="url"/);
 assert.match(owner,/action==='reminderV2Enable'/);
 assert.match(owner,/interactive_reminder_v2_inbound_ever_enabled:true/);
 assert.match(owner,/trustedGreenAssignmentProductionConfig/);
});
test('existing incident deep-link opens the moved Notifications and WhatsApp queue',()=>{
 const page=settings(),manage=manager(),que=queue();
 assert.match(page,/params\.get\('whatsappQueue'\) === 'review'/);
 assert.match(page,/setActiveTab\('notifications'\)/);
 assert.match(manage,/get\('whatsappQueue'\) === 'review'/);
 assert.match(manage,/\? 'whatsapp' : 'templates'/);
 assert.match(que,/get\('whatsappQueue'\)==='review'/);
 assert.match(que,/id="whatsapp-queue"/);
});
test('moving WhatsApp administration does not alter existing NotificationTemplate CRUD, recipients or queue',()=>{
 const manage=manager(),page=settings();
 assert.match(manage,/NotificationTemplate\.list\(\)/);
 assert.match(manage,/NotificationTemplate\.update\(/);
 assert.match(manage,/NotificationTemplate\.create\(/);
 assert.match(manage,/NotificationTemplate\.delete\(/);
 assert.match(manage,/<NotificationTemplatesOverview/);
 assert.match(manage,/<ManualTriggerDialog/);
 assert.match(manage,/<ManualSendersSection/);
 assert.match(manage,/<NotificationTemplateForm/);
 assert.match(page,/const SYSTEM_CREATOR_EMAIL/);
 assert.match(page,/if \(!isCreator\)/);
 assert.doesNotMatch(manage,/\.functions\.invoke\(/,
  'main notification tabs merely compose existing components, no additional integration calls');
 for(const path of [
  'src/pages/SettingsPage.jsx',
  'src/components/admin/NotificationManagementTab.jsx',
  'src/components/admin/notifications/WhatsAppSupplierNoticeButtons.jsx',
  'src/components/admin/notifications/WhatsAppQueueSettings.jsx',
  'src/components/admin/notifications/WhatsAppReminderAckSettings.jsx'
 ])esbuild.transformSync(read(path),{loader:'jsx',target:'es2022'});
});

test('read-only Green callback audit shows exact webhook endpoint and bearer matches, not just their presence',()=>{
 const panel=queue();
 assert.match(panel,/run\('greenWebhookSettingsAudit'\)/);
 assert.match(panel,/qaWebhookTargetMatches===true/);
 assert.match(panel,/qaWebhookBearerMatches===true/);
 assert.match(panel,/incomingNotificationsEnabled/);
 assert.match(panel,/uiTranslate\('קליטת הלחיצות אינה מאומתת/);
 assert.doesNotMatch(panel,/onClick=\{\(\)=>run\('greenButtonQaProvisionWebhook'/);
 const audit=read('base44/shared/greenWebhookSettingsAudit.ts');
 assert.match(audit,/payload\.webhookUrl===expected!\.url/);
 assert.match(audit,/payload\.webhookUrlToken===expected!\.bearer/);
 assert.match(audit,/noMessagesSent:true/);
});
