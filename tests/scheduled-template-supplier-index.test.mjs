import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {indexEventServicesByEvent} from '../base44/shared/notificationLookup.ts';
import {automatedWhatsAppKey} from '../base44/shared/whatsappBusinessKeys.ts';

test('scheduled_check reaches supplier audience using an explicitly passed event-service index',async()=>{
  const source=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
  const start=source.indexOf('async function processScheduledTemplate(');
  assert.ok(start>0);
  const sandbox={
    console:{log:()=>{},warn:()=>{}},automatedWhatsAppKey,
    buildEventContext:(event,supplier)=>({event_name:event.event_name,supplier_name:supplier.supplier_name}),
    replacePlaceholders:(tpl,ctx)=>String(tpl||'').replace(/\{\{(\w+)\}\}/g,(_x,k)=>ctx[k]||''),
    getClientContacts:()=>[],formatDate:d=>d,formatEventContacts:()=>'',URLSearchParams
  };
  vm.runInNewContext(source.slice(start)+'\nglobalThis.invokeScheduled = processScheduledTemplate;',sandbox);
  const today=new Date().toISOString().slice(0,10);
  const event={id:'event-runtime-regression',event_date:today,event_name:'Sample',status:'confirmed'};
  const supplier={id:'supplier-qa',phone:'0501234567',supplier_name:'Synthetic supplier'};
  const service={id:'event-service-qa',event_id:event.id,supplier_ids:'["supplier-qa"]'};
  const serviceIndex=indexEventServicesByEvent([service]);
  const template={type:'SCHEDULED_OTHER',timing_value:1,timing_unit:'days',timing_direction:'during',
    target_audiences:['supplier'],allowed_channels:['whatsapp'],
    whatsapp_body_template:'Hello {{supplier_name}}',title_template:'t',body_template:'m'};
  const queue=[],push=[],results={scheduled_templates_processed:0};
  await sandbox.invokeScheduled({},template,[event],serviceIndex,[supplier],[],new Map([[supplier.id,supplier]]),
    [],queue,push,results);
  assert.equal(queue.length,1,'Scheduled template should NOT fail with servicesByEvent ReferenceError');
  assert.equal(queue[0].phone,'0501234567');
  assert.equal(queue[0].message,'Hello Synthetic supplier');
  assert.equal(push.length,0);
});
test('helper chain and scheduler pass the same indexed collection, not an out-of-scope binding',()=>{
 const text=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
 assert.match(text,/processScheduledTemplate\(base44, template, allEvents, servicesByEvent,/);
 assert.match(text,/async function processScheduledTemplate\(base44, template, allEvents, servicesByEvent,/);
 assert.match(text,/sendScheduledToAudiences\(base44, template, event, servicesByEvent,/);
 assert.match(text,/async function sendScheduledToAudiences\(base44, template, event, servicesByEvent,/);
});
