import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ASSIGNMENT_SIDE_EFFECT_BRIDGE_IMPLEMENTED}
 from '../base44/shared/assignmentSideEffectsLaunchGate.ts';

const sourceFiles=(folder)=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(item=>{
 const absolute=path.join(folder,item.name);
 if(item.isDirectory())return sourceFiles(absolute);
 return /\.(ts|tsx|js|jsx)$/.test(item.name)?[absolute]:[];
});

test('staged effect executor is not imported by any production endpoint, workflow or browser page',()=>{
 assert.equal(ASSIGNMENT_SIDE_EFFECT_BRIDGE_IMPLEMENTED,false);
 for(const root of ['base44/functions','src']){
  for(const file of sourceFiles(root)){
   const text=fs.readFileSync(file,'utf8');
   assert.doesNotMatch(text,/assignmentEffectProcessor(?:\.ts)?['"]/,
    'Staged side-effect processor must stay unconnected: '+file);
   assert.doesNotMatch(text,/processStagedAssignmentEffectBatch\(/,
    'Staged batch must not be called in production: '+file);
  }
 }
});

test('no workflow or cron begins processing effect journal work',()=>{
 const workflows=fs.readdirSync('base44/workflows',{withFileTypes:true});
 for(const f of workflows){
  if(!f.isFile())continue;
  const text=fs.readFileSync(path.join('base44/workflows',f.name),'utf8');
  assert.doesNotMatch(text,/assignment_effects_pending|assignmentEffectProcessor/,
   'No effect journal auto-trigger until idempotent downstream consumers exist');
 }
});

test('supplier dashboard and admin Pulse status buttons are not replaced by experimental worker',()=>{
 const supplier=fs.readFileSync('src/pages/SupplierDashboard.jsx','utf8');
 const admin=fs.readFileSync('src/pages/EventDetails.jsx','utf8');
 const board=fs.readFileSync('src/components/events/EventsBoard.jsx','utf8');
 assert.match(supplier,/functions\.invoke\('updateSupplierStatus'/);
 assert.match(supplier,/handleStatusChange\(event\.eventServiceId, 'confirmed'\)/);
 assert.match(supplier,/handleStatusChange\(event\.eventServiceId, 'rejected'\)/);
 assert.match(admin,/base44\.entities\.EventService\.update\(eventServiceId, updateData\)/);
 assert.match(board,/base44\.entities\.EventService\.update\(editingAssignment\.eventServiceId/);
});
