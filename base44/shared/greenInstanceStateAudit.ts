// OWNER-CLICK ONLY: inspect Green's existing instance after reconnecting a
// different WhatsApp number. Exactly ONE read-only provider GET; never poll,
// mutate Green settings, change sender credentials, read business entities,
// enqueue, or automatically trigger a test message.
// Returned JSON is a fixed status vocabulary: no WID, phone, URL or token.
import {greenApiOrigin} from './greenWebhookSettingsAudit.ts';

const INSTANCE=/^[0-9]{5,20}$/;
const TOKEN=/^[A-Za-z0-9_-]{10,256}$/;
const STATES=new Set([
 'authorized','notAuthorized','blocked','sleepMode','starting','suspended'
]);
export type SafeGreenState='authorized'|'notAuthorized'|'blocked'|
 'sleepMode'|'starting'|'suspended';
export async function inspectGreenInstanceStateReadOnly(input:{
 instanceId?:string;apiToken?:string;apiBaseUrl?:string;
 fetchFn?:(url:string,init:any)=>Promise<any>;timeoutMs?:number
}):Promise<{
 state:SafeGreenState;authorized:boolean;providerReadCalls:1;
 noMessagesSent:true;noSettingsWritten:true;noBusinessDatabaseReads:true
}>{
 const id=input?.instanceId,token=input?.apiToken;
 if(typeof id!=='string'||!INSTANCE.test(id)||
  typeof token!=='string'||!TOKEN.test(token))
  throw new Error('green_instance_configuration_unavailable');
 // Existing URL validation permits ONLY known official Green HTTPS domains.
 let origin:string;
 try{origin=greenApiOrigin(input.apiBaseUrl);}
 catch{throw new Error('green_instance_origin_unavailable');}
 const timeout=input.timeoutMs??6500;
 if(!Number.isSafeInteger(timeout)||timeout<500||timeout>15000)
  throw new Error('green_instance_configuration_unavailable');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await (input.fetchFn??fetch)(
   origin+'/waInstance'+id+'/getStateInstance/'+encodeURIComponent(token),{
    method:'GET',redirect:'manual',signal:controller.signal,
    headers:{Accept:'application/json','Cache-Control':'no-store'}
   });
  if(response?.ok!==true||response?.status!==200||
   response.type==='opaqueredirect')
   throw new Error('green_instance_read_unavailable');
  const length=Number(response.headers?.get?.('content-length')||0);
  if(!Number.isFinite(length)||length>2048)
   throw new Error('green_instance_invalid_response');
  const raw=await response.text();
  if(typeof raw!=='string'||raw.length>2048)
   throw new Error('green_instance_invalid_response');
  let parsed:any;
  try{parsed=JSON.parse(raw);}
  catch{throw new Error('green_instance_invalid_response');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
   typeof parsed.stateInstance!=='string'||
   !STATES.has(parsed.stateInstance))
   throw new Error('green_instance_invalid_response');
  return {state:parsed.stateInstance,authorized:parsed.stateInstance==='authorized',
   providerReadCalls:1,noMessagesSent:true,noSettingsWritten:true,
   noBusinessDatabaseReads:true};
 }catch{
  throw new Error('green_instance_state_unavailable');
 }finally{clearTimeout(timer);}
}
