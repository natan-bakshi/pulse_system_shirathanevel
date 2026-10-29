// Owner-triggered, read-only check of assignment V2 migration dependencies.
// This is NOT a rollout control. It never queries suppliers or events, and
// cannot mutate EventService, send messages or start the worker.
import {assignmentSideEffectsLaunchGate,SIDE_EFFECT_FLAG}
 from './assignmentSideEffectsLaunchGate.ts';

const FLAG='assignment_intent_v1_enabled';
const DEPENDENCIES=Object.freeze([
 'event_status_readiness','entity_update_notifications',
 'supplier_assignment_push','supplier_pending_reminder',
 'assignment_removed_notifications','assignment_status_notifications',
 'google_calendar_sync'
]);
export function summarizeAssignmentV2ReleaseReadiness(input:{
 durableFlagRows:any[];effectFlagRows:any[]
}){
 const durable=Array.isArray(input?.durableFlagRows)&&
  input.durableFlagRows.length===1&&
  input.durableFlagRows[0]?.setting_key===FLAG&&
  input.durableFlagRows[0]?.setting_value==='true';
 const hypothetical={required:true,requiredConsumers:DEPENDENCIES,
  effects:[],changedFields:[],supplierCount:0};
 const effects=assignmentSideEffectsLaunchGate(hypothetical as any,
  input.effectFlagRows);
 // The outbound live Green production router, UI transition migration and
 // incoming callback generalization have NOT been rolled out. This report
 // only diagnoses the business-save prerequisite, not total launch readiness.
 return {
  success:true,readyForProduction:false,
  businessSaveReady:durable&&effects.allowed,
  currentMode:'legacy_business_update',
  noProviderCalls:true,noMessageSent:true,noWrites:true,
  requiredParityConsumers:DEPENDENCIES,
  checks:[
   {code:'assignment_intent_v1_feature_flag',ready:durable},
   {code:'side_effect_bridge_implemented_in_code',
    ready:effects.reason!=='durable_effect_bridge_not_implemented'},
   {code:'side_effect_bridge_independently_verified',
    ready:effects.allowed},
   {code:'legacy_workflow_parity_preserved_in_current_ui',ready:true},
   {code:'real_ui_paths_migrated',ready:false},
   {code:'live_green_buttons_generalized',ready:false},
   {code:'live_inbound_for_real_assignments',ready:false}
  ],
  businessBridgeReason:effects.reason,
  // Not a recommendation to toggle flags manually. Code must implement the
  // entire audited outbox fanout and revalidate this gate first.
  noSettingsChangeRequested:true
 };
}
export async function inspectAssignmentV2ReleaseReadiness(client:any){
 const settings=client?.asServiceRole?.entities?.AppSettings;
 if(!settings||typeof settings.filter!=='function')
  throw Error('Assignment migration settings unavailable');
 const [durableFlagRows,effectFlagRows]=await Promise.all([
  settings.filter({setting_key:FLAG},'-created_date',2,0,
   ['setting_key','setting_value']),
  settings.filter({setting_key:SIDE_EFFECT_FLAG},'-created_date',2,0,
   ['setting_key','setting_value'])
 ]);
 if(!Array.isArray(durableFlagRows)||!Array.isArray(effectFlagRows)||
  durableFlagRows.length>2||effectFlagRows.length>2)
  throw Error('Assignment migration settings ambiguous');
 return summarizeAssignmentV2ReleaseReadiness({durableFlagRows,effectFlagRows});
}
