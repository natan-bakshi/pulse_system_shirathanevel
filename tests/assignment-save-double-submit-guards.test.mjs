import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Regression guard: UI state changes only after React has rendered; a ref
// closes the synchronous double-tap window before the first async save.
const surfaces=[
 ['src/components/assignments/SupplierAssignmentDialog.jsx',
  'savingAssignmentRef','handleSaveService','disabled={isSaving}'],
 ['src/components/events/EventsBoard.jsx',
  'savingServiceRef','handleSaveService','disabled={isSaving}'],
 ['src/components/event-details/ServicesCard.jsx',
  'localAssignmentSavingRef','handleAssignLocalSuppliers',
  'disabled={localAssignmentSaving}'],
 ['src/pages/EventDetails.jsx',
  'assignmentSaveRef','handleAssignSuppliers','isSaving={assignmentSaving}']
];
for(const [file,guard,handler,disabled] of surfaces){
 test(file+' suppresses duplicate assignment submissions before async work',()=>{
  const src=fs.readFileSync(file,'utf8');
  assert.ok(src.includes('const '+guard+' = React.useRef(false);'));
  const start=src.indexOf('const '+handler+' =');
  assert.ok(start>=0,'assignment handler exists');
  const section=src.slice(start,start+3000);
  assert.ok(section.includes(guard+'.current) return;'),
    'early return before a repeated submission');
  assert.ok(section.includes(guard+'.current = true;'),
    'claim lock synchronously before first await');
  assert.ok(src.includes(guard+'.current = false;'),
    'release lock after success and failure');
  assert.ok(src.includes(disabled),
    'present disabled save control while pending');
 });
}
test('EventDetails supplier modal forwards active-save state to its actual save button',()=>{
 const src=fs.readFileSync('src/components/event-details/EventDetailDialogs.jsx','utf8');
 assert.match(src,/SupplierAssignDialog\(\{[^\n]*isSaving=false/);
 assert.match(src,/<Button onClick=\{onAssign\} disabled=\{isSaving\}>שמור<\/Button>/);
});
