import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summarizeWhatsAppInteractiveReadiness,inspectGreenInteractiveReadinessReadOnly}
 from '../base44/shared/whatsappInteractiveReadiness.ts';

const flags=()=>({
 control:{id:'control-123',enabled:true,paused:false,
  interactive_outbound_live_enabled:false,inbound_guard_key:''},
 selectedProvider:'green',assignmentIntentEnabled:true,
 greenInstanceAvailable:true,greenTokenAvailable:true,
 webhookCredentialAvailable:true,actionSigningKeyAvailable:true,
 draftConfigured:true,draftCorrupt:false
});
test('all nominal settings STILL CANNOT claim provider QA, publish callback, or activate beta',()=>{
 const report=summarizeWhatsAppInteractiveReadiness(flags());
 assert.equal(report.system,'shirat_hanevel');
 assert.equal(report.stage,'development_only');
 assert.equal(report.activationEligible,false);
 assert.equal(report.protectedByDefault,true);
 assert.equal(report.liveSendConfigured,false);
 assert.equal(report.liveInboundEndpointAvailable,false);
 assert.equal(report.inboundRoutingPolicy,'buttons_only_ignore_known_non_buttons');
 assert.equal(report.knownNonButtonsIgnoredWithoutDatabase,true);
 assert.equal(report.unsupportedButtonFormatsRequireReview,true);
 assert.equal(report.unknownCallbackMetadataOnlyNoRawContent,true);
 assert.equal(report.unknownCallbackCannotBeAutoAcked,true);
 assert.equal(report.unknownBetaRecoveryNotYetProven,true);
 assert.equal(report.ownerOnlyUnknownQuarantineAuditAvailable,true);
 assert.equal(report.encryptedUnknownRecoveryLiveEnabled,false);
 assert.equal(report.encryptedUnknownRecoveryDefaultsOff,true);
 assert.equal(report.encryptedRecoveryRetentionLifecycleProven,false);
 assert.equal(report.recoveryCleanupManualOnly,true);
 assert.ok(report.blockers.includes('unknown_beta_recovery_proven'));
 assert.ok(report.blockers.includes('encrypted_unknown_recovery_retention_verified'));
 assert.equal(report.officeContactOpensManualWhatsAppDraft,true);
 assert.equal(report.inboundRoutingPolicyDoesNotEnableLiveWebhook,true);
 assert.equal(report.readinessNeverImpliesProviderDelivery,true);
 assert.equal(report.noProviderRequests,true);
 assert.equal(report.noBusinessWrites,true);
 assert.ok(report.blockers.includes('real_callback_verified'));
 assert.ok(report.blockers.includes('owner_approved_release'));
 assert.ok(report.blockers.includes('public_endpoint_approved'));
 assert.ok(report.checks.every(x=>typeof x.passed==='boolean'));
});
test('missing secrets and disabled business intent flag are explicit blockers with no secret leakage',()=>{
 const report=summarizeWhatsAppInteractiveReadiness({
  ...flags(),assignmentIntentEnabled:false,greenTokenAvailable:false,
  actionSigningKeyAvailable:false,webhookCredentialAvailable:false,
  draftConfigured:false,control:{...flags().control,inbound_guard_key:'PRIVATE_GUARD',
   unknown_guard_key:'PRIVATE_UNKNOWN_GUARD'}
 });
 for(const key of ['green_api_token_present','signed_action_secret_present',
   'green_webhook_token_present','assignment_intent_v1','green_draft_valid',
   'no_ambiguous_inbound_guard','no_ambiguous_unknown_quarantine_guard'])
  assert.ok(report.blockers.includes(key),key);
 assert.equal(JSON.stringify(report).includes('PRIVATE_GUARD'),false);
 assert.equal(JSON.stringify(report).includes('PRIVATE_UNKNOWN_GUARD'),false);
});
test('unexpected control flag is reported as an alarm but never proves button availability',()=>{
 const report=summarizeWhatsAppInteractiveReadiness({
  ...flags(),control:{...flags().control,interactive_outbound_live_enabled:true}
 });
 assert.equal(report.unexpectedControlFlagEnabled,true);
 assert.equal(report.protectedByDefault,false);
 assert.equal(report.activationEligible,false);
 assert.equal(report.liveSendConfigured,false);
});
test('read-only readiness uses three on-demand settings/control queries and never calls Green API',async()=>{
 const previous=globalThis.Deno;
 let reads=0,writes=0,external=0;
 globalThis.Deno={env:{get:key=>({
  GREEN_API_INSTANCE_ID:'9903183013',
  GREEN_API_TOKEN:'some-long-enough-synthetic-token-not-real',
  GREEN_API_WEBHOOK_TOKEN:'synthetic-callback-secret-that-is-not-real',
  WHATSAPP_INTERACTIVE_SIGNING_SECRET:'synthetic-HMAC-key-of-no-real-value-12345'
 })[key]}};
 const control={id:'control-123',control_key:'global',enabled:true,paused:false,
  interactive_outbound_live_enabled:false,inbound_guard_key:''};
 const rows={control:0,flags:0,provider:0};
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{
   filter:async query=>{rows.control++;reads++;return query.control_key==='global'?[control]:[];},
   updateMany:async()=>{writes++;throw Error('no writes')}
  },
  AppSettings:{
   filter:async query=>{
    reads++;rows[query.setting_key==='assignment_intent_v1_enabled'?'flags':'provider']++;
    if(query.setting_key==='assignment_intent_v1_enabled')
     return [{setting_key:query.setting_key,setting_value:'true'}];
    return [{setting_key:'whatsapp_default_provider',setting_value:'green'}];
   },
   update:async()=>{writes++;throw Error('no writes')}
  }
 }}};
 try{
  const r=await inspectGreenInteractiveReadinessReadOnly(client);
  assert.equal(r.activationEligible,false);
  assert.equal(r.noMessagesSent,true);
  assert.equal(reads,3);
  assert.equal(writes,0);
  assert.equal(external,0);
  assert.deepEqual(rows,{control:1,flags:1,provider:1});
  const output=JSON.stringify(r);
  for(const value of ['some-long-enough-synthetic-token-not-real',
   'synthetic-callback-secret-that-is-not-real','9903183013'])
   assert.equal(output.includes(value),false,'No secret or account ID in status response');
 }finally{
  if(previous===undefined)delete globalThis.Deno;else globalThis.Deno=previous;
 }
});
test('retired QA readiness is not shown in live operations, while backend remains safe for historic receipts',()=>{
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 const endpoint=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 assert.doesNotMatch(ui,/run\('interactiveReadiness'\)/);
 assert.doesNotMatch(ui,/מדיניות קליטה שאושרה|פורמט כפתור חדש ולא מזוהה/);
 assert.match(ui,/בדיקת מוכנות הכפתורים/);
 assert.match(endpoint,/action==='interactiveReadiness'/);
 assert.doesNotMatch(endpoint,/interactive_outbound_live_enabled\s*:\s*true/);
});
