// QA-only Green button HTTP adapter. All side effects are delegated to the
// existing authenticated, durable callback coordinator. DO NOT replace the
// global Green webhookUrl with this endpoint: it only processes one QA chat,
// and an existing webhook may serve other consumers. A future router/fanout
// must preserve those consumers before redirecting the provider.
// No provider GET/POST, sends, polling or automatic retry originates here.
import {authenticateWhatsAppProviderCallback}
 from './whatsappProviderWebhookAuth.ts';
import {readWhatsAppQueueControl} from './whatsappOutbox.ts';
import {trustedGreenButtonQaInboundConfig} from './greenButtonQaLaunch.ts';
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
// Inbound remains available when the owner disables NEW button sends.
// The single-chat receiver still requires its own explicit enable gate,
// the owner approval, provider proof, V2 intent and original message HMAC.
const ready=(get:(s:string)=>string|undefined)=>
 get('GREEN_BUTTONS_QA_INBOUND_ENABLED')==='enabled'&&
 get('GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')==='verified'&&
 get('GREEN_BUTTONS_QA_OWNER_APPROVED')==='approved';
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
   return result(200,true);
  if(!instanceMatched)return result(422);
 }
 // No database access until verified scope and approved callback admission.
 try{
  const client=opts.makeClient(request);
  const control=await readWhatsAppQueueControl(client);
  if(control.interactive_outbound_live_enabled!==true)return result(404);
  const flags=await client.asServiceRole.entities.AppSettings.filter({
   setting_key:'assignment_intent_v1_enabled'
  },'-created_date',2);
  const durable=flags.length===1&&flags[0].setting_value==='true';
  const config=trustedGreenButtonQaInboundConfig(control,opts.env,durable);
  if(!config)return result(404);
  const processed=await (opts.stage??stageFutureGreenInteractiveHttpCallback)(
   request,{
    client,rolloutAuthorized:true,accountCapabilityVerified:true,
    webhookSecret:bearer,actionSigningSecret:config.signingSecret,
    expectedInstanceId:config.senderAccountId,
    qaChatId:config.qaChatId,
    qaEventServiceId:config.qaEventServiceId,
    qaSupplierId:config.qaSupplierId,
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
