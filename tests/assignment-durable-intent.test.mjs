import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {planAssignmentTransition,readAssignmentIntents,savedAssignmentIntentKey} from '../base44/shared/assignmentIntent.ts';
import {planAssignmentEffectParity} from '../base44/shared/assignmentEffectParity.ts';
import {planDurableAssignmentEffectJournal,readAssignmentEffectJournal}
 from '../base44/shared/assignmentEffectJournal.ts';
import {assignmentSideEffectsLaunchGate,SIDE_EFFECT_FLAG} from '../base44/shared/assignmentSideEffectsLaunchGate.ts';

const initial=()=>({
 id:'service-aaa123',updated_date:'2026-10-17T06:00:00.000Z',
 event_id:'event-aaa123',service_id:'catalog-aaa123',
 supplier_ids:'["supplier-aaa123"]',
 supplier_statuses:'{"supplier-aaa123":"confirmed"}',
 supplier_notes:'{"supplier-aaa123":"existing"}'
});
const input=(s=initial())=>({
 eventServiceId:s.id,expectedUpdatedAt:s.updated_date,
 supplierIds:['supplier-aaa123','supplier-bbb234'],
 supplierStatuses:{'supplier-aaa123':'confirmed','supplier-bbb234':'pending'},
 supplierNotes:{'supplier-aaa123':'existing','supplier-bbb234':'note'}
});
const when='2026-10-17T12:00:00.000Z';

test('an eligible new pending assignment creates ONE durable intent and a stable revisioned key',()=>{
 const s=initial(),plan=planAssignmentTransition(s,input(s),when);
 assert.equal(plan.hasNewIntent,true);
 assert.equal(plan.intents.length,1);
 assert.equal(plan.revision,1);
 assert.equal(plan.intents[0].supplier_id,'supplier-bbb234');
 assert.equal(plan.intents[0].state,'requested');
 assert.equal(plan.intents[0].transition,'added');
 assert.equal(plan.intents[0].key,'assignment:service-aaa123:supplier-bbb234:r1:SUPPLIER_NEW_ASSIGNMENT');
 const stored={...s,...plan.patch,updated_date:'2026-10-17T12:00:00.000Z'};
 assert.equal(savedAssignmentIntentKey(stored,'supplier-bbb234'),plan.intents[0].key);
 const noop=planAssignmentTransition(stored,{
   ...input(stored),supplierNotes:{'supplier-aaa123':'changed','supplier-bbb234':'note'}
 },'2026-10-17T12:02:00Z');
 assert.equal(noop.intents.length,0);
 assert.equal(noop.revision,1,'editing service/notes cannot turn into another notification');
 assert.equal(noop.patch.assignment_notification_intents,undefined,'note-only mutation does not rewrite intent log');
});
test('rejected/confirmed→pending creates a NEW generation while pending→pending does not',()=>{
 const s=initial();const change={
  ...input(s),supplierIds:['supplier-aaa123'],
  supplierStatuses:{'supplier-aaa123':'pending'},supplierNotes:{'supplier-aaa123':'existing'}
 };
 const first=planAssignmentTransition(s,change,when);
 assert.equal(first.intents.length,1);
 assert.equal(first.intents[0].transition,'reopened');
 const after={...s,...first.patch,updated_date:'2026-10-17T12:00:00.000Z'};
 const second=planAssignmentTransition(after,{...change,expectedUpdatedAt:after.updated_date},'2026-10-17T12:05:00Z');
 assert.equal(second.intents.length,0);
 const confirmed={...after,supplier_statuses:'{"supplier-aaa123":"confirmed"}'};
 const third=planAssignmentTransition(confirmed,change,'2026-10-17T12:10:00Z');
 assert.equal(third.intents.length,1);
 assert.equal(third.revision,2);
 assert.notEqual(third.intents[0].key,first.intents[0].key);
});
test('removed suppliers and non-pending additions do not generate approval requests',()=>{
 const s=initial();
 const p=planAssignmentTransition(s,{
  supplierIds:['supplier-bbb234'],supplierStatuses:{'supplier-bbb234':'confirmed'},
  supplierNotes:{'supplier-bbb234':'new'}
 },when);
 assert.equal(p.intents.length,0);
});
test('reject missing status/notes, invalid supplier IDs and corrupt intent history before a write',()=>{
 const s=initial();
 assert.throws(()=>planAssignmentTransition(s,{...input(s),supplierNotes:undefined},when),/notes must be provided/);
 assert.throws(()=>planAssignmentTransition(s,{...input(s),supplierIds:['not@valid']},when),/Invalid/);
 assert.throws(()=>planAssignmentTransition(s,{...input(s),supplierIds:['supplier-aaa123','supplier-aaa123']},when),/duplicate/);
 assert.throws(()=>planAssignmentTransition({...s,assignment_notification_intents:'corrupt'},input(s),when),/Malformed/);
 assert.deepEqual(readAssignmentIntents('[]'),[]);
});
function server({actor='admin',flag=false,service=initial(),eventStatus='confirmed',wakeThrows=false,simulateCompletedEffectBridge=true}={}){
 const bodySrc=fs.readFileSync('base44/functions/saveSupplierAssignmentsV2/entry.ts','utf8');
 const cjs=esbuild.transformSync(bodySrc,{loader:'ts',format:'cjs',target:'es2022'}).code;
 let handler;
 let writes=0,providerCalls=0,wakes=0;
 const settingsReads=[];
 const db={
  AppSettings:{filter:async(q)=>{
   settingsReads.push(q.setting_key);
   if(q.setting_key==='assignment_intent_v1_enabled')
    return flag?[{setting_key:q.setting_key,setting_value:'true'}]:[];
   if(q.setting_key===SIDE_EFFECT_FLAG)
    return simulateCompletedEffectBridge?[{setting_key:q.setting_key,setting_value:'verified_v1'}]:[];
   throw Error('Unexpected AppSettings access');
  }},
  EventService:{
   get:async()=>({...service}),
   updateMany:async(query,update)=>{
     if(query.id!==service.id||query.updated_date!==service.updated_date)return {updated:0};
     writes++;
     Object.assign(service,update.$set);
     service.updated_date=new Date(Date.parse(service.updated_date)+1000).toISOString();
     return {updated:1};
   },
   update:async(_,patch)=>{
     wakes++;
     if(wakeThrows)throw Error('Simulated missing entity-update wake');
     Object.assign(service,patch);return {...service};
   }
  },
  Event:{get:async()=>({id:'event-aaa123',status:eventStatus})},
  WhatsAppOutbox:{create:async()=>{providerCalls++;throw Error('Must not create Outbox in save operation')}}
 };
 const client={auth:{me:async()=>actor?{role:actor}:null},asServiceRole:{entities:db}};
 const m={exports:{}};
 vm.runInNewContext(cjs,{
   module:m,exports:m.exports,Deno:{serve:fn=>handler=fn},
   console:{error:()=>{}},
   Response:{json:(body,{status=200}={})=>({body,status})},
   require:name=>{
     if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(name.endsWith('assignmentIntent.ts'))return {planAssignmentTransition};
     if(name.endsWith('assignmentEffectParity.ts'))return {planAssignmentEffectParity};
     if(name.endsWith('assignmentEffectJournal.ts'))return {planDurableAssignmentEffectJournal};
     if(name.endsWith('assignmentSideEffectsLaunchGate.ts'))return {
      SIDE_EFFECT_FLAG,
      ASSIGNMENT_SIDE_EFFECT_BRIDGE_IMPLEMENTED:simulateCompletedEffectBridge,
      assignmentSideEffectsLaunchGate:(effects,flags)=>simulateCompletedEffectBridge
       ?{allowed:true,reason:'test_bridge_simulated',missingConsumers:[]}
       :assignmentSideEffectsLaunchGate(effects,flags)
     };
     throw Error('Unexpected import '+name);
   }
 });
 return {service,settingsReads,get writes(){return writes},get wakes(){return wakes},get providerCalls(){return providerCalls},
   call:body=>handler({method:'POST',json:async()=>body})};
}
test('new migration is OFF by default and does not touch assignments or WhatsApp',async()=>{
 const f=server();const r=await f.call(input());
 assert.equal(r.status,423);
 assert.equal(f.writes,0);assert.equal(f.providerCalls,0);
});
test('only administrators may use the guarded save endpoint',async()=>{
 for(const actor of ['supplier',null]){
  const f=server({actor,flag:true});
  const r=await f.call(input());
  assert.equal(r.status,403);
  assert.equal(f.writes,0);
 }
});
test('production code blocks V2 before CAS even if assignment migration flag is on without effect bridge',async()=>{
 const f=server({flag:true,simulateCompletedEffectBridge:false});
 const r=await f.call(input());
 assert.equal(r.status,423);
 assert.equal(r.body.saved,false);
 assert.equal(r.body.code,'durable_effect_bridge_not_implemented');
 assert.ok(r.body.missingConsumers.includes('supplier_assignment_push'));
 assert.ok(r.body.missingConsumers.includes('supplier_pending_reminder'));
 assert.ok(r.body.missingConsumers.includes('google_calendar_sync'));
 assert.equal(f.writes,0);
 assert.equal(f.wakes,0);
 assert.equal(f.providerCalls,0);
 assert.deepEqual(f.settingsReads,['assignment_intent_v1_enabled'],
  'a code-blocked effect bridge must not incur a second settings read');
});
test('valid save atomically records changed assignment + notification intent but never sends',async()=>{
 const f=server({flag:true}),r=await f.call(input());
 assert.equal(r.status,200);
 assert.equal(r.body.saved,true);
 assert.equal(r.body.notificationIntentsPersisted,1);
 assert.equal(r.body.notificationState,'requested');
 assert.equal(f.writes,1);
 assert.equal(f.wakes,1,'An explicit update() wakes the entity trigger after the CAS business save');
 assert.equal(r.body.wakeRequested,true);
 assert.equal(r.body.wakeFallbackRequired,false);
 assert.equal(f.providerCalls,0);
 assert.equal(f.service.assignment_intent_revision,1);
 assert.equal(f.service.assignment_intents_pending,true);
 assert.equal(f.service.assignment_effects_revision,1);
 assert.equal(f.service.assignment_effects_pending,true);
 const effectTasks=readAssignmentEffectJournal(f.service.assignment_effects_journal);
 assert.equal(effectTasks.length,r.body.effectsPlanned);
 assert.ok(effectTasks.some(t=>t.consumer==='supplier_assignment_push'));
 assert.ok(effectTasks.some(t=>t.consumer==='supplier_pending_reminder'));
 assert.ok(effectTasks.every(t=>t.state==='planned'));
 const stored=readAssignmentIntents(f.service.assignment_notification_intents);
 assert.equal(stored.length,1);
 assert.equal(stored[0].key,'assignment:service-aaa123:supplier-bbb234:r1:SUPPLIER_NEW_ASSIGNMENT');
});
test('failed explicit wake does not roll back a successfully persisted assignment intent',async()=>{
 const f=server({flag:true,wakeThrows:true});
 const r=await f.call(input());
 assert.equal(r.status,200);
 assert.equal(r.body.saved,true);
 assert.equal(r.body.notificationState,'requested');
 assert.equal(r.body.wakeFallbackRequired,true);
 assert.equal(f.writes,1);
 assert.equal(f.wakes,1);
 assert.equal(f.service.assignment_intents_pending,true);
 assert.equal(readAssignmentIntents(f.service.assignment_notification_intents).length,1);
});
test('stale requests cannot overwrite newer assignments',async()=>{
 const f=server({flag:true});
 const payload=input(),first=await f.call(payload);
 const second=await f.call(payload);
 assert.equal(first.status,200);
 assert.equal(second.status,409);
 assert.equal(f.writes,1);
});
test('simultaneous admins using the same original revision yield one successful save',async()=>{
 const f=server({flag:true});
 const payload=input();
 const [a,b]=await Promise.all([f.call(payload),f.call(payload)]);
 assert.equal([a.status,b.status].filter(v=>v===200).length,1);
 assert.equal([a.status,b.status].filter(v=>v===409).length,1);
 assert.equal(f.writes,1);
});
test('finished/cancelled events are protected from a new assignment request',async()=>{
 const f=server({flag:true,eventStatus:'cancelled'});
 const r=await f.call(input());
 assert.equal(r.status,409);
 assert.equal(f.writes,0);
});
