import test from 'node:test';
import assert from 'node:assert/strict';
import {
 planDurableAssignmentEffectJournal,readAssignmentEffectJournal
} from '../base44/shared/assignmentEffectJournal.ts';
import {planAssignmentEffectParity} from '../base44/shared/assignmentEffectParity.ts';
const time='2026-10-30T00:30:00.000Z';
const base=()=>({
 id:'service-AAA123',supplier_ids:'["supplier-ONE111"]',
 supplier_statuses:'{"supplier-ONE111":"confirmed"}',
 supplier_notes:'{"supplier-ONE111":"unchanged"}',min_suppliers:1
});
const patch=()=>({
 supplier_ids:'["supplier-ONE111","supplier-TWO222"]',
 supplier_statuses:'{"supplier-ONE111":"confirmed","supplier-TWO222":"pending"}',
 supplier_notes:'{"supplier-ONE111":"unchanged","supplier-TWO222":"new"}'
});
test('durable side-effect tasks have versioned deterministic keys per consumer + recipient',()=>{
 const s=base(),p=patch();
 const result=planDurableAssignmentEffectJournal(s,p,time);
 assert.equal(result.hasNewTasks,true);
 assert.equal(result.revision,1);
 assert.equal(result.patch.assignment_effects_pending,true);
 const journal=readAssignmentEffectJournal(result.patch.assignment_effects_journal);
 assert.deepEqual(journal,result.tasks);
 assert.equal(journal.length,result.tasks.length);
 const recipients=journal.filter(t=>t.subjectId==='supplier-TWO222');
 assert.deepEqual(recipients.map(t=>t.consumer),[
  'supplier_assignment_push','supplier_pending_reminder'
 ]);
 assert.ok(journal.some(t=>t.consumer==='google_calendar_sync'&&t.subjectId===s.id));
 assert.ok(journal.some(t=>t.consumer==='entity_update_notifications'&&t.subjectId===s.id));
 assert.ok(journal.every(t=>t.key.startsWith('assignment-effect:'+s.id+':r1:')));
 assert.ok(journal.every(t=>t.state==='planned'));
 assert.equal(JSON.stringify(journal).includes('new"'),false,'supplier notes are not copied');
});
test('two suppliers added together receive different Push and reminder keys in one generation',()=>{
 const s=base(),p={
  supplier_ids:JSON.stringify(['supplier-ONE111','supplier-TWO222','supplier-THR333']),
  supplier_statuses:JSON.stringify({'supplier-ONE111':'confirmed','supplier-TWO222':'pending','supplier-THR333':'pending'}),
  supplier_notes:JSON.stringify({'supplier-ONE111':'unchanged'})
 };
 const result=planDurableAssignmentEffectJournal(s,p,time);
 const push=result.tasks.filter(t=>t.consumer==='supplier_assignment_push');
 const reminders=result.tasks.filter(t=>t.consumer==='supplier_pending_reminder');
 assert.equal(push.length,2);assert.equal(reminders.length,2);
 assert.equal(new Set(push.map(t=>t.key)).size,2);
 assert.equal(new Set(reminders.map(t=>t.key)).size,2);
 assert.equal(new Set(result.tasks.map(t=>t.key)).size,result.tasks.length);
});
test('replay planning on the same before snapshot produces the exact same immutable keys',()=>{
 const first=planDurableAssignmentEffectJournal(base(),patch(),time);
 const second=planDurableAssignmentEffectJournal(base(),patch(),time);
 assert.deepEqual(first,second);
 assert.ok(!JSON.stringify(first).includes('@c.us'));
});
test('subsequent business generation adds new keys and retains earlier tasks, without dispatching',()=>{
 const s=base(),p=patch();
 const prior=planDurableAssignmentEffectJournal(s,p,time);
 const updated={...s,...p,...prior.patch};
 const change={...p,
  supplier_statuses:'{"supplier-ONE111":"confirmed","supplier-TWO222":"rejected"}'};
 const later=planDurableAssignmentEffectJournal(updated,change,'2026-10-30T00:35:00.000Z');
 const total=readAssignmentEffectJournal(later.patch.assignment_effects_journal);
 assert.equal(later.revision,2);
 assert.ok(total.some(t=>t.revision===1));
 assert.ok(total.some(t=>t.revision===2&&t.consumer==='assignment_status_notifications'));
 assert.equal(new Set(total.map(t=>t.key)).size,total.length);
});
test('an identical save creates no effect jobs and does not bump revision',()=>{
 const s=base(),p={
  supplier_ids:s.supplier_ids,supplier_statuses:s.supplier_statuses,
  supplier_notes:s.supplier_notes
 };
 assert.equal(planAssignmentEffectParity(s,p).required,false);
 const result=planDurableAssignmentEffectJournal(s,p,time);
 assert.deepEqual(result.patch,{});
 assert.equal(result.hasNewTasks,false);
 assert.equal(result.tasks.length,0);
 assert.equal(result.revision,0);
});
test('note-only update creates calendar and generic notification tasks but no Push or reminder',()=>{
 const s=base(),p={
  supplier_ids:s.supplier_ids,supplier_statuses:s.supplier_statuses,
  supplier_notes:'{"supplier-ONE111":"changed"}'
 };
 const {tasks}=planDurableAssignmentEffectJournal(s,p,time);
 assert.ok(tasks.some(t=>t.consumer==='google_calendar_sync'));
 assert.equal(tasks.some(t=>t.consumer==='supplier_assignment_push'),false);
 assert.equal(tasks.some(t=>t.consumer==='supplier_pending_reminder'),false);
});
test('invalid journal, duplicate keys and identity mismatch fail closed before CAS',()=>{
 const s=base(),p=patch();
 for(const value of ['invalid-json','{}','['+'1,'.repeat(241)+'1]']){
  assert.throws(()=>planDurableAssignmentEffectJournal({
   ...s,assignment_effects_journal:value
  },p,time),/Invalid assignment effect journal/);
 }
 const good=planDurableAssignmentEffectJournal(s,p,time).tasks[0];
 for(const bad of [
  [good,good],
  [{...good,key:good.key.replace(':r1:',':r2:')}],
  [{...good,state:'weird'}],
  [{...good,subjectId:'bad@chat'}],
  [{...good,customScript:'delete_all'}]
 ])assert.throws(()=>readAssignmentEffectJournal(JSON.stringify(bad)));
 const foreign=JSON.stringify([{...good,key:good.key.replace(s.id,'service-OTHER')}]);
 assert.throws(()=>planDurableAssignmentEffectJournal({
  ...s,assignment_effects_journal:foreign
 },p,time),/foreign_origin/);
 const future=JSON.stringify([{...good,revision:2,key:good.key.replace(':r1:',':r2:')}]);
 assert.throws(()=>planDurableAssignmentEffectJournal({
  ...s,assignment_effects_revision:1,assignment_effects_journal:future
 },p,time),/future_revision/);
});
