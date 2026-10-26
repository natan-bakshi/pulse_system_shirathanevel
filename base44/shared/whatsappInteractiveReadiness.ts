// Explicit, owner-only WhatsApp interactive readiness assessment.
// Pure analysis of trusted server metadata; no mutation or provider HTTP.
// Crucial: never claim that a configured token proves Green API beta support,
// a verified reply callback, owner rollout approval or live endpoint readiness.
import {parseSavedWhatsAppInteractivePolicy} from './whatsappInteractiveSettingsStore.ts';
import {readWhatsAppQueueControl} from './whatsappOutbox.ts';
import {resolveWhatsAppProvider} from './whatsappProviderConfig.ts';

type Check={code:string;label:string;passed:boolean;blocking:boolean};
const check=(code:string,label:string,passed:boolean,blocking=true):Check=>
 ({code,label,passed,blocking});
const present=(value:unknown)=>typeof value==='string'&&value.length>=24;
export function summarizeWhatsAppInteractiveReadiness(input:{
 control:any;selectedProvider:string;assignmentIntentEnabled:boolean;
 greenInstanceAvailable:boolean;greenTokenAvailable:boolean;
 webhookCredentialAvailable:boolean;actionSigningKeyAvailable:boolean;
 draftConfigured:boolean;draftCorrupt:boolean;sampleHasDurableAssignment?:boolean
}){
 const c=input.control;
 const workerHasNoLiveConfig=true; // See processWhatsAppOutbox/entry.ts.
 const publicInboundEndpointPublished=false; // No Deno.serve for Green replies.
 const betaAccountQaProven=false;
 const verifiedRealCallbackProven=false;
 const receiptPersistenceVerifiedInProduction=false;
 const approvedOwnerRolloutRecord=false;
 const checked:Check[]=[
  check('queue_enabled','תור WhatsApp פעיל',c?.enabled===true),
  check('queue_unpaused','תור WhatsApp אינו מושהה',c?.paused!==true),
  check('green_selected','Green API נבחר כספק לשליחה',input.selectedProvider==='green'),
  check('green_instance_present','מזהה מופע Green API קיים בשרת',input.greenInstanceAvailable),
  check('green_api_token_present','מפתח API של Green קיים בשרת',input.greenTokenAvailable),
  check('signed_action_secret_present','מפתח חתימת פעולות אינטראקטיביות קיים',input.actionSigningKeyAvailable),
  check('green_webhook_token_present','סוד Webhook מאומת מוגדר',input.webhookCredentialAvailable),
  check('assignment_intent_v1','יומן שיבוצים חדש מופעל באישור מנהל',input.assignmentIntentEnabled),
  check('green_draft_valid','טיוטת כפתורים שמורה ותקינה',
   input.draftConfigured&&!input.draftCorrupt),
  check('no_ambiguous_inbound_guard','אין חסימת קליטה הדורשת בירור ידני',
   !c?.inbound_guard_key),
  check('beta_capability_verified','יכולת כפתורי Green נבדקה בחשבון אמיתי',
   betaAccountQaProven),
  check('real_callback_verified','נבדקה תגובה אמיתית עם מספר ומזהי הודעה מאומתים',
   verifiedRealCallbackProven),
  check('public_endpoint_approved','הופעל Endpoint מאומת ומוגן בתדירות',
   publicInboundEndpointPublished),
  check('durable_receipt_live_verified','רישום תגובות חד-פעמי אומת בסביבה החיה',
   receiptPersistenceVerifiedInProduction),
  check('owner_approved_release','מנהל המערכת אישר בפירוש הפעלה חיה',
   approvedOwnerRolloutRecord)
 ];
 const protectedByDefault=c?.interactive_outbound_live_enabled!==true &&
  workerHasNoLiveConfig&&!publicInboundEndpointPublished;
 return {
  system:'shirat_hanevel',feature:'interactive_assignment_green',
  stage:'development_only',activationEligible:false,
  protectedByDefault,
  // Owner-approved policy on 26.10.2026. Applies ONLY to the FUTURE isolated
  // assignment callback path, not any pre-existing Green/office integrations.
  inboundRoutingPolicy:'buttons_only_ignore_known_non_buttons',
  knownNonButtonsIgnoredWithoutDatabase:true,
  unsupportedButtonFormatsRequireReview:true,
  officeContactOpensManualWhatsAppDraft:true,
  inboundRoutingPolicyDoesNotEnableLiveWebhook:true,
  unexpectedControlFlagEnabled:c?.interactive_outbound_live_enabled===true,
  liveSendConfigured:false,liveInboundEndpointAvailable:false,
  checks:checked,blockers:checked.filter(x=>x.blocking&&!x.passed).map(x=>x.code),
  readinessNeverImpliesProviderDelivery:true,noMessagesSent:true,
  noProviderRequests:true,noBusinessWrites:true,needsExplicitOwnerApproval:true,
  summary:'כפתורי השיבוץ אינם פעילים. כל אישור בדיקות אמיתי יידרש בנפרד.'
 };
}
export async function inspectGreenInteractiveReadinessReadOnly(client:any){
 const entities=client?.asServiceRole?.entities;
 if(!entities?.AppSettings?.filter)throw Error('AppSettings unavailable');
 // Only explicit owner action; do not run on status refresh or dashboard load.
 // Three small reads; no outbound Green API capability probe (may cost/notify).
 const [control,provider,flags]=await Promise.all([
  readWhatsAppQueueControl(client),
  resolveWhatsAppProvider(client),
  entities.AppSettings.filter({setting_key:'assignment_intent_v1_enabled'},'-created_date',2)
 ]);
 if(!Array.isArray(flags)||flags.length>1)throw Error('Assignment rollout flags ambiguous');
 const draft=parseSavedWhatsAppInteractivePolicy(control,'green');
 let env:(key:string)=>string|undefined;
 try{env=Deno.env.get.bind(Deno.env);}catch{env=()=>undefined;}
 const instance=env('GREEN_API_INSTANCE_ID');
 return summarizeWhatsAppInteractiveReadiness({
  control,selectedProvider:provider,
  assignmentIntentEnabled:flags.length===1&&flags[0].setting_value==='true',
  greenInstanceAvailable:typeof instance==='string'&&/^[0-9]{5,20}$/.test(instance),
  greenTokenAvailable:present(env('GREEN_API_TOKEN')),
  webhookCredentialAvailable:present(env('GREEN_API_WEBHOOK_TOKEN')),
  actionSigningKeyAvailable:present(env('WHATSAPP_INTERACTIVE_SIGNING_SECRET')),
  draftConfigured:draft.configured,draftCorrupt:draft.corrupt
 });
}
