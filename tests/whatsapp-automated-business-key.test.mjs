import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {automatedWhatsAppKey} from '../base44/shared/whatsappBusinessKeys.ts';

const base={eventId:'event-001',recipientId:'recipient-001',eventDate:'2026-11-20',
  serviceId:'event-service-001',templateType:'SUPPLIER_PENDING_REMINDER',version:0};
test('identical supplier pending reminder iteration produces a single stable business key',()=>{
 const once=automatedWhatsAppKey('supplier_pending',base);
 const second=automatedWhatsAppKey('supplier_pending',{...base});
 assert.equal(once,second);
 assert.ok(once.length<240);
 assert.notEqual(once,automatedWhatsAppKey('supplier_pending',{...base,version:1}));
 assert.notEqual(once,automatedWhatsAppKey('supplier_pending',{...base,recipientId:'other'}));
 assert.notEqual(once,automatedWhatsAppKey('supplier_pending',{...base,serviceId:'other-service'}));
 assert.notEqual(once,automatedWhatsAppKey('client_payment',base),
  'Different categories must never share one Outbox key');
});
test('scheduled template keys disambiguate each audience and each date',()=>{
 const params={eventId:'ev',eventDate:'2026-11-20',templateType:'AUTOMATED_TEMPLATE',recipientId:'user-a',target:'supplier'};
 const a=automatedWhatsAppKey('scheduled_template',params);
 assert.notEqual(a,automatedWhatsAppKey('scheduled_template',{...params,target:'admin'}));
 assert.notEqual(a,automatedWhatsAppKey('scheduled_template',{...params,eventDate:'2026-11-21'}));
 assert.notEqual(a,automatedWhatsAppKey('scheduled_template',{...params,templateType:'ANOTHER_TEMPLATE'}));
 assert.notEqual(a,automatedWhatsAppKey('scheduled_template',{...params,recipientId:'user-b'}));
});
test('invalid identities never silently merge unrelated WhatsApp recipients',()=>{
 assert.throws(()=>automatedWhatsAppKey('arbitrary',{eventId:'ev',recipientId:'recipient'}),/Unsupported/);
 assert.throws(()=>automatedWhatsAppKey('supplier_pending',{eventId:'ev',recipientId:''}),/Missing/);
 assert.throws(()=>automatedWhatsAppKey('client_payment',{eventId:'ev',recipientId:'a'.repeat(350)}),/too long/);
});
test('daily automatic categories have keys; manual trigger stays intentionally unique per request',()=>{
 const src=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
 for(const kind of ['supplier_pending','admin_missing','client_payment','scheduled_template'])
   assert.match(src,new RegExp("automatedWhatsAppKey\\('"+kind+"'"));
 const manual=fs.readFileSync('base44/functions/manualTriggerNotification/entry.ts','utf8');
 assert.doesNotMatch(manual,/automatedWhatsAppKey|idempotencyKey:/,
   'Do not deduplicate explicit repeated manual reminder sends');
 const text=fs.readFileSync('base44/functions/WhatsApp_SendText/entry.ts','utf8');
 assert.doesNotMatch(text,/idempotencyKey:/,'Manual WhatsApp sends must remain explicitly repeatable');
});
