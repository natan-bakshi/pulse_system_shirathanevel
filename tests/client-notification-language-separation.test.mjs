import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  clientNoticeLocale,reviewedClientPaymentReminderEnglish,
  selectClientPaymentReminderCopy
} from '../base44/shared/clientReminderLocale.ts';

const hebrew={
 type:'CLIENT_PAYMENT_REMINDER',is_active:false,
 allowed_channels:['whatsapp'],
 title_template:'תזכורת קטנה לגבי האירוע — {{event_name}}',
 body_template:'שלום, רק תזכורת קטנה לגבי {{event_name}} בתאריך {{event_date}}. לפי הרישום אצלנו נותרה יתרה בסך {{balance}} ש"ח.',
 whatsapp_body_template:'שלום, תזכורת קטנה ל{{event_name}} בתאריך {{event_date}}. יתרה {{balance}} ש"ח.'
};
const withEnglish={...hebrew,...reviewedClientPaymentReminderEnglish,english_copy_reviewed:true};

test('client message language is per-event, independent from UI and PDF document language',()=>{
 assert.equal(clientNoticeLocale({}), 'he');
 assert.equal(clientNoticeLocale({preferred_language:'en',document_language:'en'}),'he');
 assert.equal(clientNoticeLocale({client_notice_language:'en',preferred_language:'he',document_language:'he'}),'en');
 assert.equal(clientNoticeLocale({client_notice_language:'fr'}),'he');
 const event=JSON.parse(fs.readFileSync('base44/entities/Event.jsonc','utf8'));
 assert.deepEqual(event.properties.client_notice_language.enum,['he','en']);
 assert.equal(event.properties.client_notice_language.default,undefined);
 const form=fs.readFileSync('src/components/events/EventForm.jsx','utf8');
 assert.match(form,/client_notice_language:\s*"he"/);
 assert.match(form,/event\?\.client_notice_language === "en"/);
 assert.match(form,/client-notice-language/);
 assert.doesNotMatch(form,/client_notice_language:\s*(?:quoteLanguage|locale|documentLanguage)/);
});

test('old Hebrew-only records and inactive reminder template produce the same Hebrew wording',()=>{
 const old=selectClientPaymentReminderCopy(hebrew,{});
 assert.deepEqual(old,{ready:true,language:'he',
  title:hebrew.title_template,body:hebrew.body_template,
  whatsapp:hebrew.whatsapp_body_template});
 assert.equal(hebrew.is_active,false);
 const also=selectClientPaymentReminderCopy(withEnglish,{client_notice_language:'he'});
 assert.equal(also.ready,true);
 assert.equal(also.body,hebrew.body_template);
});

test('English template is gentle, matches protected variables and is not a Hebrew fallback',()=>{
 const result=selectClientPaymentReminderCopy(withEnglish,{client_notice_language:'en'});
 assert.equal(result.ready,true);
 assert.equal(result.language,'en');
 assert.equal(result.title,reviewedClientPaymentReminderEnglish.title_template_en);
 assert.ok(result.body.includes('{{balance}}'));
 assert.ok(result.body.includes('{{event_date}}'));
 assert.ok(result.whatsapp.includes('{{event_name}}'));
 for(const s of [result.title,result.body,result.whatsapp]){
  assert.doesNotMatch(s,/[\u0590-\u05ff]/);
  assert.doesNotMatch(s,/manual charge|collection notice|payment demand|overdue/i);
 }
});

test('English messages fail closed when missing, mixed-Hebrew or placeholders changed',()=>{
 const enEvent={client_notice_language:'en'};
 assert.deepEqual(selectClientPaymentReminderCopy(hebrew,enEvent),
  {ready:false,language:'en',reason:'english_copy_missing'});
 assert.deepEqual(selectClientPaymentReminderCopy({...withEnglish,english_copy_reviewed:false},enEvent),
  {ready:false,language:'en',reason:'english_copy_not_approved'});
 assert.equal(selectClientPaymentReminderCopy(
  {...withEnglish,body_template_en:''},enEvent).reason,'english_copy_missing');
 assert.equal(selectClientPaymentReminderCopy(
  {...withEnglish,whatsapp_body_template_en:'תזכורת {{balance}}'},enEvent).reason,'english_copy_unreviewed');
 assert.equal(selectClientPaymentReminderCopy(
  {...withEnglish,title_template_en:'Reminder {{family_name}}'},enEvent).reason,'placeholder_mismatch');
 assert.equal(selectClientPaymentReminderCopy(
  {...withEnglish,body_template_en:'Hi {{balance}}'},enEvent).reason,'placeholder_mismatch');
 assert.equal(selectClientPaymentReminderCopy(
  {...withEnglish,whatsapp_body_template_en:'Hi {{event_name}} {{balance}}'},enEvent).reason,'placeholder_mismatch');
 assert.deepEqual(selectClientPaymentReminderCopy(
  {...withEnglish,allowed_channels:['push'],whatsapp_body_template_en:''},enEvent),
  {ready:true,language:'en',
   title:reviewedClientPaymentReminderEnglish.title_template_en,
   body:reviewedClientPaymentReminderEnglish.body_template_en,
   whatsapp:reviewedClientPaymentReminderEnglish.body_template_en});
});

test('both existing inactive legacy notification producers select copy independently of operator locale',()=>{
 for(const file of [
  'base44/functions/dailyScheduledNotifications/entry.ts',
  'base44/functions/checkClientPayments/entry.ts'
 ]){
  const code=fs.readFileSync(file,'utf8');
  assert.match(code,/selectClientPaymentReminderCopy/);
  assert.match(code,/if\(!reminderCopy\.ready\)/);
  assert.match(code,/replacePlaceholders\(reminderCopy\.title, contextData\)/);
  assert.match(code,/replacePlaceholders\(reminderCopy\.body, contextData\)/);
  assert.match(code,/continue;/);
 }
 const daily=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
 assert.match(daily,/replacePlaceholders\(reminderCopy\.whatsapp, contextData\)/);
 const form=fs.readFileSync('src/components/admin/notifications/form/ContentTab.jsx','utf8');
 assert.match(form,/template\.type==='CLIENT_PAYMENT_REMINDER'/);
 assert.match(form,/title_template_en/);
 assert.match(form,/body_template_en/);
 assert.match(form,/whatsapp_body_template_en/);
 assert.match(form,/selectClientPaymentReminderCopy/);
 const template=JSON.parse(fs.readFileSync('base44/entities/NotificationTemplate.jsonc','utf8'));
 for(const field of ['title_template_en','body_template_en','whatsapp_body_template_en'])
  assert.equal(template.properties[field].type,'string');
 assert.equal(template.properties.english_copy_reviewed.default,false);
 assert.match(form,/english_copy_reviewed:false/);
 assert.match(form,/onCheckedChange=\{checked=>update\('english_copy_reviewed'/);
 assert.equal(template.properties.is_active.default,true,
  'an existing template controls activation; no new implicit activation');
});
