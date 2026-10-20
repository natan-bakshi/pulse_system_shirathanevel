import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {paymentLinkDeliveryNotice} from '../src/components/billing/paymentLinkDeliveryNotice.js';

test('link display never implies WhatsApp sent after queued or uncertain enqueue',()=>{
 for(const [result,fragment] of [
  [{paymentLink:'https://test.local',queuedVia:['whatsapp'],sentVia:[]},'בתור'],
  [{paymentLink:'https://test.local',manual_review_required:true},'בבירור'],
  [{paymentLink:'https://test.local',sentVia:['whatsapp']},'הספק'],
  [{paymentLink:'https://test.local',sentVia:['email']},'באימייל'],
  [{paymentLink:'https://test.local',failures:['אימייל נכשל']},'נכשלו'],
  [{paymentLink:'https://test.local'},'נוצר']
 ]){
  const shown=paymentLinkDeliveryNotice(result,'he');
  assert.match(shown.title,new RegExp(fragment));
  assert.ok(shown.body.length>10);
  assert.equal(shown.title.includes('נשלח בהצלחה'),false);
 }
 const queued=paymentLinkDeliveryNotice({queuedVia:['whatsapp']},'he');
 assert.match(queued.body,/טרם אומתה מסירה/);
 const accepted=paymentLinkDeliveryNotice({sentVia:['whatsapp']},'he');
 assert.match(accepted.body,/מסירה.*לא אומתה/);
});
test('unknown WhatsApp dominates apparent success of another delivery channel',()=>{
 const message=paymentLinkDeliveryNotice({
  sentVia:['email'],manual_review_required:true,queuedVia:[],failures:[]
 },'he');
 assert.equal(message.tone,'warning');
 assert.match(message.title,/בבירור/);
 assert.doesNotMatch(message.body,/שליחה הושלמה בהצלחה/);
});
test('English link notice always distinguishes queue and provider acceptance',()=>{
 const waiting=paymentLinkDeliveryNotice({queuedVia:['whatsapp']},'en');
 const accepted=paymentLinkDeliveryNotice({sentVia:['whatsapp']},'en');
 const unknown=paymentLinkDeliveryNotice({manual_review_required:true},'en');
 assert.match(waiting.title,/queued/i);
 assert.match(accepted.title,/provider/i);
 assert.match(unknown.title,/uncertain/i);
 assert.doesNotMatch(accepted.body,/was delivered/i);
});
test('both payment dialogs and calling pages consume actual delivery state',()=>{
 for(const file of [
   'src/components/billing/PaymentLinkDialog.jsx',
   'src/components/billing/ClearingPaymentDialog.jsx'
 ]){
  const src=fs.readFileSync(file,'utf8');
  assert.match(src,/paymentLinkDeliveryNotice\(/);
  assert.doesNotMatch(src,/\{text\.linkSentTitle\}/);
 }
 for(const file of ['src/pages/BillingDashboard.jsx','src/pages/EventDetails.jsx']){
  const src=fs.readFileSync(file,'utf8');
  assert.match(src,/manual_review_required:/);
  assert.match(src,/queuedVia:/);
  assert.match(src,/sentVia:/);
 }
});
test('payment link endpoint cannot classify an UNKNOWN dedup as sent or queued',()=>{
 const src=fs.readFileSync('base44/functions/invoice4uCreateClearingRequest/entry.ts','utf8');
 assert.match(src,/whatsappEnqueueReceiptState\(receipt\)/);
 assert.match(src,/manualReviewVia\.push\('whatsapp'\)/);
 assert.match(src,/manual_review_required:manualReviewVia\.length>0/);
 assert.match(src,/if\(state==='accepted'\)sentVia\.push\('whatsapp'\)/);
 assert.doesNotMatch(src,/if\(receipt\.queued\)queuedVia\.push\('whatsapp'\)/);
 assert.match(src,/idempotencyKey:'payment-link:'\+payment\.id/);
});
