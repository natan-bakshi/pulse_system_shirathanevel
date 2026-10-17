import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {indexEventServicesByEvent,indexEventReminderReceipts} from '../base44/shared/notificationLookup.ts';

test('one-time event-service index exactly matches previous per-event filtering including order',()=>{
 const events=Array.from({length:215},(_,i)=>({id:'event-'+i}));
 const services=Array.from({length:4200},(_,i)=>({
   id:'service-'+i,event_id:'event-'+(i%215),notes:String(i)
 }));
 const grouped=indexEventServicesByEvent(services);
 for(const event of events){
   const original=services.filter(es=>es.event_id===event.id);
   assert.deepEqual(grouped.get(event.id),original);
 }
 assert.deepEqual(grouped.get('no-event')||[],[]);
});
test('active supplier and admin reminder lookups match previous linear existing-notification checks',()=>{
 const notes=[
  {template_type:'SUPPLIER_EVENT_REMINDER',related_event_id:'evt-1',related_supplier_id:'sup-1'},
  {template_type:'ADMIN_EVENT_REMINDER',related_event_id:'evt-1',user_id:'admin-1'},
  {template_type:'SUPPLIER_EVENT_REMINDER',related_event_id:'evt-2',related_supplier_id:'sup-2'},
  {template_type:'OTHER',related_event_id:'evt-1',related_supplier_id:'sup-3'},
  {template_type:'SUPPLIER_EVENT_REMINDER',related_event_id:'',related_supplier_id:'sup-1'}
 ];
 const index=indexEventReminderReceipts(notes);
 for(const evt of ['evt-1','evt-2','evt-3']){
   for(const sid of ['sup-1','sup-2','sup-3']){
     const before=notes.some(n=>n.template_type==='SUPPLIER_EVENT_REMINDER'&&
       n.related_event_id===evt&&n.related_supplier_id===sid);
     assert.equal(index.supplier.has(evt+':'+sid),before);
   }
   for(const admin of ['admin-1','admin-2']){
     const before=notes.some(n=>n.template_type==='ADMIN_EVENT_REMINDER'&&
       n.related_event_id===evt&&n.user_id===admin);
     assert.equal(index.admin.has(evt+':'+admin),before);
   }
 }
});
test('both schedulers use local indexes instead of full scans inside event loops',()=>{
 for(const filename of ['dailyScheduledNotifications','sendEventReminders']){
   const content=fs.readFileSync('base44/functions/'+filename+'/entry.ts','utf8');
   assert.match(content,/indexEventServicesByEvent\(allEventServices\)/);
   assert.match(content,/indexEventReminderReceipts\(existingNotifications\)/);
   assert.match(content,/const eventServices = servicesByEvent\.get\(event\.id\)\|\|\[\];/);
   assert.match(content,/existingEventReminders\.supplier\.has/);
   assert.match(content,/existingEventReminders\.admin\.has/);
 }
});
