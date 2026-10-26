// Draft durable rate budget for FUTURE AUTHENTICATED Green button callbacks.
// Currently NOT called by a public Base44 function. No new cron or provider
// requests. A single conditional update on existing queue control limits
// authenticated inbound bursts across function instances (in-memory limits
// do not work in serverless). Failed/ambiguous CAS always rejects admission.
// This limit is global to the single-company Shirat HaNevel deployment.
import {readWhatsAppQueueControl} from './whatsappOutbox.ts';

const DEFAULT_MAX=240;
const WINDOW_MS=60_000;
export type InboundRateDecision={
 allowed:boolean;reason:'reserved'|'rate_limited'|'unavailable'|'concurrent_update';
 retryAfterSeconds:number;databaseWrites:0|1
};
export async function reserveVerifiedGreenInboundBudget(client:any,input:{
 authenticated:boolean;trustedRolloutEnabled:boolean;now?:number;
 maxPerMinute?:number
}):Promise<InboundRateDecision>{
 const refused=(reason:InboundRateDecision['reason'],seconds=0):InboundRateDecision=>({
  allowed:false,reason,retryAfterSeconds:seconds,databaseWrites:0
 });
 if(input?.authenticated!==true||input?.trustedRolloutEnabled!==true)
  return refused('unavailable');
 const max=input.maxPerMinute??DEFAULT_MAX;
 const now=input.now??Date.now();
 if(!Number.isSafeInteger(now)||now<0||!Number.isInteger(max)||max<30||max>600)
  return refused('unavailable');
 const db=client?.asServiceRole?.entities?.WhatsAppQueueControl;
 if(!db||typeof db.updateMany!=='function')return refused('unavailable');
 let current:any;
 try{current=await readWhatsAppQueueControl(client);}
 catch{return refused('unavailable');}
 const oldStart=current.inbound_rate_window_started_at||'';
 const oldCount=current.inbound_rate_count;
 const start=Date.parse(oldStart);
 const active=Number.isFinite(start)&&start<=now&&now-start<WINDOW_MS;
 const used=active?Number(oldCount||0):0;
 if(!Number.isSafeInteger(used)||used<0)return refused('unavailable');
 if(used>=max)return refused('rate_limited',Math.max(1,Math.ceil(
  (WINDOW_MS-(now-start))/1000)));
 const nextStart=active?oldStart:new Date(now).toISOString();
 const query={
  id:current.id,control_key:'global',
  inbound_rate_window_started_at:current.inbound_rate_window_started_at??null,
  inbound_rate_count:current.inbound_rate_count??null
 };
 try{
  const updated=await db.updateMany(query,{$set:{
   inbound_rate_window_started_at:nextStart,inbound_rate_count:used+1
  }});
  if(updated?.updated===1)return {allowed:true,reason:'reserved',
   retryAfterSeconds:0,databaseWrites:1};
  return refused(updated?.updated===0?'concurrent_update':'unavailable',1);
 }catch{return refused('unavailable',1);}
}
