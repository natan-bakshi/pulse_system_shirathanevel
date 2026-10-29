import test from 'node:test';
import assert from 'node:assert/strict';
import {planAssignmentTransition} from '../base44/shared/assignmentIntent.ts';
import {planAssignmentEffectParity} from '../base44/shared/assignmentEffectParity.ts';

const before=()=>({
 id:'service-123456',supplier_ids:JSON.stringify(['supplier-111111']),
 supplier_statuses:JSON.stringify({'supplier-111111':'confirmed'}),
 supplier_notes:JSON.stringify({'supplier-111111':'Old note'}),
 min_suppliers:1,client_notes:'Original notes'
});
const plan=(s,request)=>planAssignmentTransition(s,{
 supplierIds:request.supplierIds,
 supplierStatuses:request.supplierStatuses,
 supplierNotes:request.supplierNotes,
 ...(request.minSuppliers!==undefined?{minSuppliers:request.minSuppliers}:{}),
 ...(request.clientNotes!==undefined?{clientNotes:request.clientNotes}:{})
},'2026-10-30T00:00:00Z');
const standard=()=>({
 supplierIds:['supplier-111111'],
 supplierStatuses:{'supplier-111111':'confirmed'},
 supplierNotes:{'supplier-111111':'Old note'}
});
test('new pending supplier has Push, pending reminder, entity notification, calendar and event-status parity',()=>{
 const s=before(),r=standard();
 r.supplierIds.push('supplier-222222');
 r.supplierStatuses['supplier-222222']='pending';
 r.supplierNotes['supplier-222222']='Arrival 07:00';
 const effects=planAssignmentEffectParity(s,plan(s,r).patch);
 assert.equal(effects.required,true);
 assert.deepEqual(effects.effects.map(x=>x.kind),['supplier_assigned']);
 assert.deepEqual(effects.effects.map(x=>x.supplierId),['supplier-222222']);
 for(const name of ['supplier_assignment_push','supplier_pending_reminder',
  'entity_update_notifications','google_calendar_sync','event_status_readiness'])
  assert.ok(effects.requiredConsumers.includes(name),name);
 assert.ok(effects.changedFields.includes('supplier_ids'));
});
test('reopened supplier has a new request; note-only save never invents another assignment',()=>{
 const s=before(),r=standard();r.supplierStatuses['supplier-111111']='pending';
 const p=plan(s,r),effects=planAssignmentEffectParity(s,p.patch);
 assert.equal(p.intents.length,1);
 assert.deepEqual(effects.effects.map(x=>x.kind),['supplier_reopened']);
 assert.ok(effects.requiredConsumers.includes('supplier_pending_reminder'));
 const note=standard();
 note.supplierNotes['supplier-111111']='New note';
 const notePlan=plan(s,note);
 assert.equal(notePlan.intents.length,0);
 const noteEffects=planAssignmentEffectParity(s,notePlan.patch);
 assert.deepEqual(noteEffects.effects.map(x=>x.kind),['supplier_note_changed']);
 assert.ok(noteEffects.requiredConsumers.includes('google_calendar_sync'));
 assert.equal(noteEffects.requiredConsumers.includes('supplier_pending_reminder'),false);
 assert.equal(noteEffects.requiredConsumers.includes('supplier_assignment_push'),false);
});
test('removal preserves calendar + deletion notification parity without new WhatsApp assignment',()=>{
 const s=before(),r={supplierIds:[],supplierStatuses:{},supplierNotes:{}};
 const p=plan(s,r),effects=planAssignmentEffectParity(s,p.patch);
 assert.equal(p.intents.length,0);
 assert.deepEqual(effects.effects.map(x=>x.kind),['supplier_removed']);
 assert.ok(effects.requiredConsumers.includes('assignment_removed_notifications'));
 assert.ok(effects.requiredConsumers.includes('google_calendar_sync'));
 assert.equal(effects.requiredConsumers.includes('supplier_assignment_push'),false);
});
test('manual status and minimum changes require side effects even without new supplier',()=>{
 const s=before(),r=standard();
 r.supplierStatuses['supplier-111111']='rejected';
 r.minSuppliers=2;
 const effects=planAssignmentEffectParity(s,plan(s,r).patch);
 assert.deepEqual(effects.effects.map(x=>x.kind),
  ['supplier_status_changed','minimum_changed']);
 assert.ok(effects.requiredConsumers.includes('assignment_status_notifications'));
 assert.ok(effects.requiredConsumers.includes('event_status_readiness'));
 assert.equal(effects.requiredConsumers.includes('supplier_pending_reminder'),false);
});
test('confirmed addition cannot trigger a pending-only reminder',()=>{
 const s=before(),r=standard();
 r.supplierIds.push('supplier-222222');
 r.supplierStatuses['supplier-222222']='confirmed';
 const effects=planAssignmentEffectParity(s,plan(s,r).patch);
 assert.ok(effects.requiredConsumers.includes('supplier_assignment_push'));
 assert.equal(effects.requiredConsumers.includes('supplier_pending_reminder'),false);
});
test('identical transition does not fabricate event/notification work',()=>{
 const s=before(),p=plan(s,standard()),effects=planAssignmentEffectParity(s,p.patch);
 assert.equal(p.intents.length,0);
 assert.equal(effects.required,false);
 assert.deepEqual(effects.effects,[]);
 assert.deepEqual(effects.requiredConsumers,[]);
});
test('client notes-only change is not mistaken for a new WhatsApp assignment',()=>{
 const s=before(),r=standard();r.clientNotes='Updated event notes';
 const p=plan(s,r),effects=planAssignmentEffectParity(s,p.patch);
 assert.equal(p.intents.length,0);
 assert.deepEqual(effects.effects.map(x=>x.kind),['client_notes_changed']);
 assert.equal(effects.requiredConsumers.includes('supplier_assignment_push'),false);
});
test('corrupt IDs, unknown statuses, invalid notes and unassigned new metadata fail closed',()=>{
 const s=before(),p=plan(s,standard());
 const bad=[
  [{...s,supplier_ids:'{invalid'},p.patch],
  [s,{...p.patch,supplier_ids:'["supplier-111111","supplier-111111"]'}],
  [s,{...p.patch,supplier_statuses:'{"supplier-111111":"weird"}'}],
  [s,{...p.patch,supplier_notes:'{"supplier-000000":"not assigned"}'}],
  [s,{...p.patch,client_notes:{object:'invalid'}}],
  [s,{...p.patch,min_suppliers:-10}]
 ];
 for(const [old,patch] of bad)
  assert.throws(()=>planAssignmentEffectParity(old,patch),
   /Invalid assignment effects snapshot/);
});
