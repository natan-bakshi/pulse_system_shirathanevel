import test from 'node:test';
import assert from 'node:assert/strict';
import {
 summarizeAssignmentV2ReleaseReadiness,inspectAssignmentV2ReleaseReadiness
} from '../base44/shared/assignmentV2ReleaseReadiness.ts';
import {
 ASSIGNMENT_SIDE_EFFECT_BRIDGE_IMPLEMENTED,
 assignmentSideEffectsLaunchGate,SIDE_EFFECT_FLAG
} from '../base44/shared/assignmentSideEffectsLaunchGate.ts';

test('business side effects cannot be enabled by changing AppSettings until code-owned fanout exists',()=>{
 assert.equal(ASSIGNMENT_SIDE_EFFECT_BRIDGE_IMPLEMENTED,false);
 const required={required:true,effects:[],changedFields:[],
  requiredConsumers:['supplier_assignment_push','google_calendar_sync'],supplierCount:1};
 for(const settings of [[],[{setting_key:SIDE_EFFECT_FLAG,setting_value:'verified_v1'}]]){
  const r=assignmentSideEffectsLaunchGate(required,settings);
  assert.equal(r.allowed,false);
  assert.equal(r.reason,'durable_effect_bridge_not_implemented');
  assert.deepEqual(r.missingConsumers,['supplier_assignment_push','google_calendar_sync']);
 }
 const none=assignmentSideEffectsLaunchGate({
  ...required,required:false,requiredConsumers:[]
 },[]);
 assert.equal(none.allowed,true);
 assert.equal(none.reason,'no_legacy_side_effects_required');
});

test('release readiness exposes blockers but never claims general production readiness',()=>{
 const r=summarizeAssignmentV2ReleaseReadiness({
  durableFlagRows:[],effectFlagRows:[]
 });
 assert.equal(r.readyForProduction,false);
 assert.equal(r.businessSaveReady,false);
 assert.equal(r.currentMode,'legacy_business_update');
 assert.equal(r.noProviderCalls,true);
 assert.equal(r.noWrites,true);
 assert.equal(r.noSettingsChangeRequested,true);
 assert.ok(r.checks.some(x=>x.code==='legacy_workflow_parity_preserved_in_current_ui'&&x.ready));
 assert.ok(r.checks.some(x=>x.code==='live_inbound_for_real_assignments'&&!x.ready));
 assert.ok(r.requiredParityConsumers.includes('supplier_pending_reminder'));
 const forged=summarizeAssignmentV2ReleaseReadiness({
  durableFlagRows:[{setting_key:'assignment_intent_v1_enabled',setting_value:'true'}],
  effectFlagRows:[{setting_key:SIDE_EFFECT_FLAG,setting_value:'verified_v1'}]
 });
 assert.equal(forged.businessSaveReady,false);
 assert.equal(forged.readyForProduction,false);
});

test('owner opt-in readiness reads exactly two projected settings and no events or provider calls',async()=>{
 const reads=[];
 const client={asServiceRole:{entities:{
  AppSettings:{filter:async(q,sort,limit,offset,projection)=>{
   reads.push({q,sort,limit,offset,projection});
   return [];
  }},
  EventService:{get:()=>{throw Error('Unexpected business GET');}},
  WhatsAppOutbox:{filter:()=>{throw Error('Unexpected WhatsApp GET');}}
 }}};
 const r=await inspectAssignmentV2ReleaseReadiness(client);
 assert.equal(reads.length,2);
 assert.deepEqual(reads.map(x=>x.q.setting_key),[
  'assignment_intent_v1_enabled','assignment_effects_bridge_live_v1'
 ]);
 for(const x of reads){
  assert.equal(x.limit,2);
  assert.deepEqual(x.projection,['setting_key','setting_value']);
 }
 assert.equal(r.noMessageSent,true);
 assert.equal(r.readyForProduction,false);
});
