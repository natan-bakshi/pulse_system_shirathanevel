// QA-only Green button HTTP adapter. All side effects are delegated to the
// existing authenticated, durable callback coordinator. DO NOT replace the
// global Green webhookUrl with this endpoint: it only processes one QA chat,
// and an existing webhook may serve other consumers. A future router/fanout
// must preserve those consumers before redirecting the provider.
// No provider GET/POST, sends, polling or automatic retry originates here.
import {authenticateWhatsAppProviderCallback}
 from './whatsappProviderWebhookAuth.ts';
import {readWhatsAppQueueControl} from './whatsappOutbox.ts';
import {trustedGreenButtonQaInboundConfig,greenButtonQaPassiveInboundReady,
 greenProductionPassiveInboundReady,
 trustedGreenLegacyPilotConfig,trustedGreenAssignmentProductionConfig} from './greenButtonQaLaunch.ts';
import {greenButtonQaScopedV2Enabled} from './greenButtonQaScopedV2.ts';
import {stageFutureGreenInteractiveHttpCallback}
 from './greenInteractiveHttpStaging.ts';
import {planFutureGreenWebhookHttpContract}
 from './greenWebhookHttpContract.ts';
import {decodeFutureGreenInteractiveHttpRequest}
 from './greenInteractiveHttpBoundary.ts';
import {isVerifiedGreenNonButtonEvent}
 from './greenWebhookAckPlanning.ts';
import {parseGreenButtonSelection} from './greenInteractiveCallback.ts';
import {admitAuthenticatedV2GreenReminder,recordVerifiedV2ReminderAcknowledgement}
 from './whatsappV2ReminderInbound.ts';
import {enqueueVerifiedV2ReminderAckFeedback} from './whatsappV2ReminderFeedback.ts';
type Result={httpStatus:number;body:{received:boolean};noProviderCalls:true};
const result=(httpStatus:number,received=false):Result=>({
 httpStatus,body:{received},noProviderCalls:true
});
// Inbound remains available when sending NEW buttons is disabled.
// Passive verified non-button ACKs can run before Beta support is proven;
// matching signed button callbacks still require verified provider capability
// plus the original durable Outbox/Revision/receipt authorization.
const ready=(env:(key:string)=>string|undefined)=>
 greenButtonQaPassiveInboundReady(env)||greenProductionPassiveInboundReady(env);
export async function handleGreenButtonQaWebhook(request:any,opts:{
 env:(key:string)=>string|undefined;
 makeClient:(request:any)=>any;
 recalculateEventStatus:(client:any,eventId:string)=>Promise<any>;
 // Tests ONLY: invoke the actual stage with a mock, never provider network.
 stage?:(request:any,options:any)=>Promise<any>;
 now?:number
}):Promise<Result>{
 if(!ready(opts.env))return result(404);
 if(request?.method!=='POST')return result(405);
 const bearer=opts.env('GREEN_API_WEBHOOK_TOKEN')||'';
 if(!authenticateWhatsAppProviderCallback({
  provider:'green',headers:request.headers,webhookSecret:bearer
 }))return result(401);
 // GREEN incomingWebhook delivers ordinary office chat from ALL senders.
 // Authenticated, account-matched, KNOWN non-button messages must not trigger
 // a database read or a retry storm. Stream decoding remains size-bounded.
 // Keep the original Request intact for the signed QA coordinator below.
 // A verified non-QA private sender can be admitted ONLY if the owner-signed
 // single-assignment pilot specifically names that private chat.
 let extraPrivateSender='';
 let v2Callback:any=null,v2Bytes=0;
 if(typeof request?.clone==='function'){ 
  let boundary:any;
  try{boundary=await decodeFutureGreenInteractiveHttpRequest(request.clone(),{
    rolloutAuthorized:true,accountCapabilityVerified:true,webhookSecret:bearer
  });}
  catch{return result(400);}
  if(!boundary.ok)return result(boundary.status);
  const raw=boundary.rawCallback;
  const instance=opts.env('GREEN_API_INSTANCE_ID')||'';
  const instanceMatched=/^[0-9]{5,20}$/.test(instance)&&
    String(raw?.instanceData?.idInstance)===instance&&
    raw?.instanceData?.typeInstance==='whatsapp';
  if(instanceMatched&&isVerifiedGreenNonButtonEvent(raw,instance))
   return result(200,true);
  // Short V2 IDs are disjoint from live V1 wa1_ assignment buttons.
  // Keep the one and only Green webhook URL, but NEVER execute V2 without
  // a separately owner-enabled historical inbound flag (default false).
  const selected=instanceMatched?parseGreenButtonSelection(
   raw,instance,opts.now??Date.now()):null;
  if(selected&&/^wa2_[A-Za-z0-9_-]{22}$/.test(selected.buttonId)){
   v2Callback=raw;v2Bytes=boundary.callbackByteLength;
  }
  const qaChat=opts.env('GREEN_BUTTONS_QA_ALLOWED_CHAT')||'';
  const sender=raw?.senderData?.chatId;
  // This endpoint serves exactly ONE owner-approved QA chat. No other
  // message in the same Green account can mutate or await a QA receipt.
  // ACK only authenticated, account-matched, private out-of-scope messages.
  if(instanceMatched&&raw?.typeWebhook==='incomingMessageReceived'&&
    /^[1-9][0-9]{7,14}@c\.us$/.test(qaChat)&&
    typeof sender==='string'&&/^[1-9][0-9]{7,14}@c\.us$/.test(sender)&&
    raw?.senderData?.sender===sender&&sender!==qaChat)
   extraPrivateSender=sender;
  if(!instanceMatched)return result(422);
 }
 // The first live beta send has not been proven yet; never consume a
 // potentially valid button click merely because the passive endpoint ACKs
 // ordinary manual office messages. Fail closed without any DB access.
 const betaProof=opts.env('GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')==='verified';
 const betaPilot=opts.env('GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')==='probe_authorized'&&
  opts.env('GREEN_BUTTONS_QA_BETA_PROBE_ENABLED')==='enabled'&&
  greenButtonQaScopedV2Enabled(opts.env);
 if(!betaProof&&!betaPilot)return result(503);
 // No database access until verified scope and approved callback admission.
 try{
  const client=opts.makeClient(request);
  const control=await readWhatsAppQueueControl(client);
  if(v2Callback){
   // A rollback of NEW V2 sends must never invalidate buttons already
   // accepted by Green. Historical authorization is independent of sending.
   if(control.interactive_reminder_v2_inbound_ever_enabled!==true||
      !greenProductionPassiveInboundReady(opts.env))return result(503);
   const signing=opts.env('WHATSAPP_INTERACTIVE_SIGNING_SECRET')||'';
   const account=opts.env('GREEN_API_INSTANCE_ID')||'';
   const admission=await admitAuthenticatedV2GreenReminder({
    client,headers:request.headers,rawCallback:v2Callback,
    callbackByteLength:v2Bytes,expectedInstanceId:account,
    webhookSecret:bearer,signingSecret:signing,
    rolloutAuthorized:true,providerCapabilityVerified:true,now:opts.now
   });
   if(admission.status!=='admitted')return result(422);
   const committed=await recordVerifiedV2ReminderAcknowledgement({
    client,admission:admission.admission,signingSecret:signing,now:opts.now
   });
   if(!['recorded','already_recorded','already_acknowledged'].includes(committed.status))
    return result(503);
   // Feedback goes through the SAME existing queue and is deduplicated
   // per original Outbox job; there is no second provider HTTP request here.
   const feedback=await enqueueVerifiedV2ReminderAckFeedback({
    client,sourceOutboxId:admission.admission.outboxId,
    signingSecret:signing,activeGreenInstanceId:account
   });
   if(feedback.queued)return result(200,true);
   // If the WhatsApp sender number was replaced after the old message,
   // refuse to send from a different number. Retrying cannot repair it.
   if(feedback.reason==='origin_untrusted_or_sender_changed'){
    console.warn('[WhatsAppV2] Historical reminder ACK recorded; sender changed, feedback requires manual review');
    return result(200,true);
   }
   return result(503);
  }
  // Receipt processing does NOT depend on new-send switch or queue control.
  // This lets suppliers click old buttons safely during a send rollback.
  const production=trustedGreenAssignmentProductionConfig(control,opts.env,'inbound');
  const legacy=production||await trustedGreenLegacyPilotConfig(control,opts.env,
   'inbound',extraPrivateSender||opts.env('GREEN_BUTTONS_QA_ALLOWED_CHAT')||'',
   opts.now??Date.now());
  // An unrelated sender costs only one bounded QueueControl read, not a
  // second settings read or Outbox lookup; genuine signed pilot callbacks
  // must never be silently ACKed as irrelevant office messages.
  if(extraPrivateSender&&!legacy)return result(200,true);
  // Without a verified production history or the dedicated QA receiver,
  // no assignment kind is eligible. Save the old V2 flag read and never
  // reach a supplier record or callback claim for out-of-scope traffic.
  if(!legacy&&!greenButtonQaPassiveInboundReady(opts.env))return result(404);
  const flags=legacy?[]:await client.asServiceRole.entities.AppSettings.filter({
   setting_key:'assignment_intent_v1_enabled'
  },'-created_date',2);
  const durable=(flags.length===1&&flags[0].setting_value==='true')||
   greenButtonQaScopedV2Enabled(opts.env);
  const config=legacy||trustedGreenButtonQaInboundConfig(control,opts.env,durable);
  if(!config)return result(404);
  const processed=await (opts.stage??stageFutureGreenInteractiveHttpCallback)(
   request,{
    client,rolloutAuthorized:true,accountCapabilityVerified:true,
    webhookSecret:bearer,actionSigningSecret:config.signingSecret,
    expectedInstanceId:config.senderAccountId,
    qaChatId:config.qaChatId,
    qaEventServiceId:config.qaEventServiceId,
    ...(!legacy&&opts.env('GREEN_BUTTONS_QA_PREVIOUS_EVENT_SERVICE_ID')?{
      qaPreviousEventServiceId:opts.env('GREEN_BUTTONS_QA_PREVIOUS_EVENT_SERVICE_ID')
    }:{}),
    qaSupplierId:config.qaSupplierId,
    legacyCanaryApproved:config.legacyCanaryApproved,
    claimOwner:'qa-'+crypto.randomUUID(),
    now:opts.now,
    // This scope never stores encrypted callback bodies or interprets
    // manual chat. Unknown Beta callback stays metadata-only + review.
    recalculateEventStatus:(eventId:string)=>
     opts.recalculateEventStatus(client,eventId)
   });
  const plan=planFutureGreenWebhookHttpContract(processed);
  return result(plan.plannedHttpStatus,plan.acknowledgeCandidate);
 }catch{
  // Never leak phone, action, provider credentials, state or raw payload.
  // If DB is uncertain, let provider retry; coordinator prevents CAS replay.
  return result(503);
 }
}
