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
 // No DB reads until a trusted server flag + Green bearer passed.
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
