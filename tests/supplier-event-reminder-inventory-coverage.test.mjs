import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadEventReminderInventory,reminderInventoryDateRange,
 israelDay,reminderLookaheadDays} from '../base44/shared/eventReminderInventory.ts';
import {eventReminderWhatsAppKey} from '../base44/shared/whatsappBusinessKeys.ts';

const TEMPLATE={type:'SUPPLIER_EVENT_REMINDER',timing_value:1,timing_unit:'days'};
const DAY=new Date('2026-11-10T07:00:00.000Z');
function mockEntity(records,{stats,key}={}){
 return {filter:async(query,sort,limit=500,skip=0)=>{
   if(stats)stats[key]=(stats[key]||0)+1;
   const match=(row,field,want)=>{
    const got=row[field];
    if(want&&typeof want==='object'){
     if('$in' in want)return want.$in.includes(got);
     if('$gte' in want&&got<want.$gte)return false;
     if('$lte' in want&&got>want.$lte)return false;
     return true;
    }
    return got===want;
   };
   const matching=records.filter(row=>Object.entries(query||{}).every(([k,v])=>match(row,k,v)));
   if(sort==='id')matching.sort((a,b)=>a.id.localeCompare(b.id));
   return structuredClone(matching.slice(skip,skip+limit));
 }};
}
test('Israel event-day window respects local date around winter and summer midnight',()=>{
 assert.equal(israelDay(new Date('2026-11-09T22:05:00Z')),'2026-11-10');
 assert.equal(israelDay(new Date('2026-07-09T21:05:00Z')),'2026-07-10');
 assert.deepEqual(reminderInventoryDateRange(DAY,[TEMPLATE]),
  {from:'2026-11-09',through:'2026-11-12'});
 assert.equal(reminderLookaheadDays([{timing_value:2,timing_unit:'weeks'}]),15);
 assert.throws(()=>reminderLookaheadDays([{timing_value:999,timing_unit:'years'}]),
  /Unsupported/);
});
test('a next-day approved supplier after hundreds of unrelated first-page rows remains in the bounded inventory',async()=>{
 const stats={};
 const events=Array.from({length:160},(_,i)=>({
  id:'old-'+String(i).padStart(3,'0'),event_date:'2027-06-17',status:'confirmed'
 }));
 events.push({id:'event-next',event_date:'2026-11-11',status:'in_progress'},
  {id:'event-quote',event_date:'2026-11-11',status:'quote'},
  {id:'event-cancel',event_date:'2026-11-11',status:'cancelled'});
 const services=Array.from({length:515},(_,i)=>({
  id:'service-'+String(i).padStart(4,'0'),event_id:'event-next',supplier_ids:'[]'
 }));
 services.push({id:'zz-service-must-not-be-dropped',event_id:'event-next',
  supplier_ids:'["supplier-096"]',
  supplier_statuses:'{"supplier-096":"confirmed"}'});
 const suppliers=Array.from({length:97},(_,i)=>({
  id:'supplier-'+String(i).padStart(3,'0'),supplier_name:'Supplier '+i,
  phone:'0501234567',whatsapp_enabled:true
 }));
 const notifications=[{id:'n-1',related_event_id:'event-next',
  related_supplier_id:'supplier-096',template_type:'SUPPLIER_EVENT_REMINDER',is_resolved:false}];
 let changes=0;
 const noWrites={create:()=>{changes++},update:()=>{changes++}};
 const client={entities:{
  Event:mockEntity(events,{stats,key:'events'}),
  EventService:mockEntity(services,{stats,key:'services'}),
  Supplier:mockEntity(suppliers,{stats,key:'suppliers'}),
  InAppNotification:{...mockEntity(notifications,{stats,key:'notes'}),...noWrites}
 }};
 const result=await loadEventReminderInventory(client,DAY,[TEMPLATE]);
 assert.deepEqual(result.events.map(e=>e.id).sort(),['event-next','event-quote']);
 assert.equal(result.services.length,516,'second page of event services must be included');
 assert.ok(result.services.some(x=>x.id==='zz-service-must-not-be-dropped'));
 assert.ok(result.suppliers.some(s=>s.id==='supplier-096'));
 assert.equal(result.notifications.length,1);
 assert.ok(stats.services>=2,'paginates when an exact 500-row page is returned');
 assert.equal(stats.events,1,'only the local due date window is scanned');
 assert.equal(changes,0,'inventory is read-only and cannot send, queue or change any row');
});
test('all automatic event-reminder producers use one recipient/event key, never in-app existence as delivery proof',()=>{
 const daily=fs.readFileSync('base44/functions/dailyScheduledNotifications/entry.ts','utf8');
 const legacy=fs.readFileSync('base44/functions/sendEventReminders/entry.ts','utf8');
 const fanout=fs.readFileSync('base44/functions/processScheduledPushNotifications/entry.ts','utf8');
 assert.match(daily,/loadEventReminderInventory\(base44\.asServiceRole,now/);
 assert.match(legacy,/loadEventReminderInventory\(base44\.asServiceRole,now/);
 assert.match(daily,/const seenSupplierIds=new Set\(\)/);
 assert.match(legacy,/const seenSupplierIds=new Set\(\)/);
 assert.match(daily,/supplierUser && !hasExisting/);
 assert.match(legacy,/if\(!hasExisting\)try/);
 assert.match(fanout,/const dedupeKey = String\(supplierId\)/);
 assert.match(fanout,/idempotencyKey:wa\.idempotencyKey/);
 assert.doesNotMatch(fanout,/idempotencyKey:'fanout:'\+pending\.id/);
 const event={id:'event-next',event_date:'2026-11-11',event_time:'10:00'};
 const first=eventReminderWhatsAppKey(event,TEMPLATE,'supplier','supplier-096');
 const second=eventReminderWhatsAppKey({...event,notes:'changed'},TEMPLATE,
  'supplier','supplier-096');
 assert.equal(first,second);
});
