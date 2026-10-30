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
