// Protection against migrating supplier assignment writes before their
// CURRENT Base44 entity-update side effects have durable replacements.
// In particular, EventService.updateMany() can commit without emitting the
// UPDATE workflow that creates supplier Push, reminders and calendar sync.
// Changing an AppSettings flag or enabling Green buttons MUST NOT bypass it.
import type {AssignmentEffectParity} from './assignmentEffectParity.ts';

// Code-owned safety certificate. To change this to true in a future release:
// implement + E2E-test durable fan-out, unique idempotency for EACH side effect,
// safe UNKNOWN reconciliation, workflow parity and recovery under concurrent
// edits. A configuration flag by itself is never evidence of these properties.
// Each proof is an independent CODE-REVIEWED prerequisite. Do not mark a
// consumer ready just because a pure planner or mock processor test passes.
// EventService journal fields currently permit admin writes; before rollout,
// the server must own and cryptographically validate task provenance, or
// enforce service-role-only journal writes with an independently proven RLS.
export const ASSIGNMENT_SIDE_EFFECT_BRIDGE_PROOFS=Object.freeze({
 journal_server_provenance:false,
 per_recipient_template_fanout:false,
 durable_push_receipts:false,
 pending_reminder_receipts:false,
 supplier_status_and_removal_notifications:false,
 google_calendar_idempotent_upsert:false,
 custom_notification_template_parity:false,
 event_status_recalculation_receipts:false,
 watchdog_and_unknown_outcome_review:false,
 end_to_end_legacy_workflow_parity:false
});
// No single AppSettings toggle, provider setting or unchecked Boolean can
// activate a partial migration. Verified consumer implementations must be
// independently tested before their own code-owned proof is changed.
export const ASSIGNMENT_SIDE_EFFECT_BRIDGE_IMPLEMENTED=
 Object.values(ASSIGNMENT_SIDE_EFFECT_BRIDGE_PROOFS).every(value=>value===true);
export const SIDE_EFFECT_FLAG='assignment_effects_bridge_live_v1';
export function assignmentSideEffectsLaunchGate(effects:AssignmentEffectParity,
 settings:any[]):{allowed:boolean;reason:string;missingConsumers:readonly string[]}{
 if(!effects||typeof effects.required!=='boolean'||
  !Array.isArray(effects.requiredConsumers))
  return {allowed:false,reason:'effects_plan_invalid',missingConsumers:[]};
 if(!effects.required)
  return {allowed:true,reason:'no_legacy_side_effects_required',missingConsumers:[]};
 if(!ASSIGNMENT_SIDE_EFFECT_BRIDGE_IMPLEMENTED)
  return {allowed:false,reason:'durable_effect_bridge_not_implemented',
   missingConsumers:effects.requiredConsumers};
 if(!Array.isArray(settings)||settings.length!==1||
  settings[0]?.setting_key!==SIDE_EFFECT_FLAG||
  settings[0]?.setting_value!=='verified_v1')
  return {allowed:false,reason:'durable_effect_bridge_not_verified',
   missingConsumers:effects.requiredConsumers};
 return {allowed:true,reason:'verified_effect_bridge',missingConsumers:[]};
}
