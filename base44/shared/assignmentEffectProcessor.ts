// Staged, deliberately UNWIRED side-effect execution protocol.
// No production entrypoint, automation, UI or watchdog imports this module.
// Nothing is delivered by default: a future owner-reviewed, separately gated
// service must supply verified per-consumer adapters and authorize rollout.
// The existing assignment business path remains the only LIVE route.
import {readAssignmentEffectJournal,type AssignmentEffectTask}
 from './assignmentEffectJournal.ts';
import type {EffectPreflightDisposition} from './assignmentEffectEligibility.ts';

const ID=/^[A-Za-z0-9_-]{3,100}$/;
const TOKEN=/^[A-Za-z0-9_-]{12,100}$/;
const RECEIPT=/^[A-Za-z0-9:_-]{8,180}$/;
const STALE_MS=5*60*1000;
const MAX_BATCH=4;
type EffectDb={get:(id:string)=>Promise<any>;
 updateMany:(q:any,update:any)=>Promise<any>};
export type EffectReceipt={taskKey:string;receiptId:string;verified:true};
export type EffectAdapterResult=
 |{outcome:'completed';receipt:EffectReceipt}
 |{outcome:'cancelled';reason:'no_longer_applicable'|'superseded'}
 |{outcome:'manual_review';reason:'consumer_not_ready'|'invalid_business_state'}
 |{outcome:'unknown';reason:'remote_outcome_uncertain'};
export type EffectAdapter=(input:{
 task:Readonly<AssignmentEffectTask>;idempotencyKey:string;serviceId:string
})=>Promise<EffectAdapterResult>;
export type EffectBatchOptions={
 // Required for every test harness; never use untrusted request data.
 adapters:Readonly<Record<string,EffectAdapter>>;
 // Independent durable destination receipt lookup. The adapter's own
 // 'verified' boolean is NOT sufficient evidence of completion.
 verifyReceipt:(input:{task:Readonly<AssignmentEffectTask>;receiptId:string;
  serviceId:string})=>Promise<boolean>;
 // Required independent fresh-business-state check, after claim, before IO.
 preflight:(task:Readonly<AssignmentEffectTask>,serviceId:string)=>Promise<EffectPreflightDisposition>;
 makeToken:()=>string;now?:()=>number;maxTasks?:number
};
type ClaimResult={
 status:'claimed'|'empty'|'busy'|'concurrent_update'|'claim_uncertain'|
  'expired_claim_quarantined'|'quarantine_uncertain'|'unhandled_consumer';
 task?:AssignmentEffectTask;reviewTaskKey?:string;attempted?:boolean
};
const resolveDb=(client:any):EffectDb=>{
 const db=client?.asServiceRole?.entities?.EventService;
 if(!db||typeof db.get!=='function'||typeof db.updateMany!=='function')
  throw Error('Staged effect engine requires internal service-role EventService');
 return db as EffectDb;
};
const checkId=(value:any)=>typeof value==='string'&&ID.test(value);
const checkedNow=(now:number)=>{
 if(!Number.isSafeInteger(now)||now<Date.parse('2020-01-01T00:00:00Z'))
  throw Error('Invalid effect clock');
 return new Date(now).toISOString();
};
const decode=(service:any)=>{
 const raw=service?.assignment_effects_journal;
 if(typeof raw!=='string'||!raw.length)
  throw Error('Missing durable effect journal');
 const tasks=readAssignmentEffectJournal(raw);
 if(!tasks.length||tasks.some(t=>!t.key.startsWith(
  'assignment-effect:'+service.id+':')))
  throw Error('Invalid or foreign effect journal');
 return {raw,tasks};
};
const pending=(tasks:AssignmentEffectTask[])=>tasks.some(t=>
 t.state==='planned'||t.state==='claimed');
const persist=async(db:EffectDb,serviceId:string,raw:string,
 tasks:AssignmentEffectTask[])=>{
 const changed=await db.updateMany({
  id:serviceId,assignment_effects_journal:raw,assignment_effects_pending:true
 },{$set:{
  assignment_effects_journal:JSON.stringify(tasks),
  assignment_effects_pending:pending(tasks)
 }});
 return changed?.updated===1;
};
const taskFrozen=(t:AssignmentEffectTask)=>Object.freeze({...t,
 ...(t.changedFields?{changedFields:Object.freeze([...t.changedFields])}:{})});
export async function claimNextStagedAssignmentEffect(
 client:any,serviceId:string,adapters:Readonly<Record<string,EffectAdapter>>,
 claimToken:string,nowMs:number
):Promise<ClaimResult>{
 if(!checkId(serviceId)||!TOKEN.test(claimToken||''))
  throw Error('Invalid effect claim identity');
 const stamp=checkedNow(nowMs),db=resolveDb(client);
 const service=await db.get(serviceId);
 if(!service||service.id!==serviceId||
  service.assignment_effects_pending!==true)return {status:'empty'};
 const {raw,tasks}=decode(service);
 // A previously claimed effect may already have reached an external system.
 // Never renew its lease or try its provider again. Quarantine on expiry.
 const active=tasks.find(t=>t.state==='claimed');
 if(active){
  const claimed=Date.parse(active.claimedAt||'');
  if(!Number.isFinite(claimed)||nowMs-claimed<STALE_MS)
   return {status:'busy'};
  const copy=tasks.map(t=>t.key===active.key
   ?{...t,state:'unknown' as const,finishedAt:stamp,
     resultCode:'claim_expired_unknown'}:t);
  try{
   return await persist(db,serviceId,raw,copy)
    ?{status:'expired_claim_quarantined',reviewTaskKey:active.key}
    :{status:'concurrent_update'};
  }catch{
   return {status:'quarantine_uncertain',reviewTaskKey:active.key};
  }
 }
 const task=tasks.find(t=>t.state==='planned');
 if(!task){
  // Nothing executable remains. Preserve UNKNOWN and review rows in the
  // journal; clear only the work marker, using the same CAS.
  try{
   return await persist(db,serviceId,raw,tasks)
    ?{status:'empty'}:{status:'concurrent_update'};
  }catch{return {status:'claim_uncertain'};}
 }
 // Do not claim an unimplemented task: this future engine cannot manufacture
 // a Push, reminder, calendar operation or customer-facing notification.
 if(!adapters||typeof adapters[task.consumer]!=='function')
  return {status:'unhandled_consumer',reviewTaskKey:task.key};
 const copy=tasks.map(t=>t.key===task.key
  ?{...t,state:'claimed' as const,claimToken,claimedAt:stamp}:t);
 try{
  if(!await persist(db,serviceId,raw,copy))
   return {status:'concurrent_update'};
  return {status:'claimed',task:taskFrozen(copy.find(t=>t.key===task.key)!)};
 }catch{
  // Write may have committed with a lost ACK. NEVER invoke adapter when the
  // claim's durable success was not explicitly confirmed.
  return {status:'claim_uncertain'};
 }
}

function normalizeAdapterResult(
 task:AssignmentEffectTask,result:any
):Pick<AssignmentEffectTask,'state'|'resultCode'|'receiptId'>{
 if(result?.outcome==='completed'){
  if(result?.receipt?.verified===true&&
    result.receipt.taskKey===task.key&&
    typeof result.receipt.receiptId==='string'&&
    RECEIPT.test(result.receipt.receiptId))
   return {state:'completed',resultCode:'durable_receipt_verified',
    receiptId:result.receipt.receiptId};
  // A provider 2xx, unverified callback or missing durable local receipt
  // cannot be treated as a confirmed business delivery.
  return {state:'unknown',resultCode:'receipt_unverified_unknown'};
 }
 if(result?.outcome==='cancelled'&&
  ['no_longer_applicable','superseded'].includes(result.reason))
  return {state:'cancelled',resultCode:result.reason};
 if(result?.outcome==='manual_review'&&
  ['consumer_not_ready','invalid_business_state'].includes(result.reason))
  return {state:'manual_review',resultCode:result.reason};
 if(result?.outcome==='unknown'&&
  result.reason==='remote_outcome_uncertain')
  return {state:'unknown',resultCode:'remote_outcome_uncertain'};
 return {state:'unknown',resultCode:'invalid_adapter_result'};
}

export async function finalizeStagedAssignmentEffect(
 client:any,serviceId:string,claimedTask:AssignmentEffectTask,
 outcome:Pick<AssignmentEffectTask,'state'|'resultCode'|'receiptId'>,
 nowMs:number
):Promise<{status:'persisted'|'already_persisted'|'changed_claim'|'settle_uncertain';
 state?:string}>{
 if(!checkId(serviceId)||!claimedTask?.key||
  claimedTask.state!=='claimed'||!TOKEN.test(claimedTask.claimToken||''))
  throw Error('Invalid claimed task for settlement');
 const stamp=checkedNow(nowMs),db=resolveDb(client);
 if(!['completed','unknown','manual_review','cancelled'].includes(outcome.state)||
  typeof outcome.resultCode!=='string'||
  !/^[a-z_]{3,64}$/.test(outcome.resultCode))
  throw Error('Invalid effect settlement');
 // A caller cannot assert COMPLETED without a durable receipt validated by
 // its destination adapter and explicitly bound to this task's identity.
 if((outcome.state==='completed'&&
   (outcome.resultCode!=='durable_receipt_verified'||
    typeof outcome.receiptId!=='string'||!RECEIPT.test(outcome.receiptId)))||
    (outcome.state!=='completed'&&outcome.receiptId!==undefined))
  throw Error('Unverified effect completion');
 // CAS retries after a concurrent unrelated task append are SAFE: the
 // external adapter is NEVER called again in this function.
 for(let attempt=0;attempt<3;attempt++){
  let service:any,decoded:{raw:string;tasks:AssignmentEffectTask[]};
  try{
   service=await db.get(serviceId);
   if(!service||service.id!==serviceId)return {status:'settle_uncertain'};
   decoded=decode(service);
  }catch{return {status:'settle_uncertain'};}
  const current=decoded.tasks.find(t=>t.key===claimedTask.key);
  if(!current||current.claimToken!==claimedTask.claimToken)
   return {status:'changed_claim'};
  if(current.state!=='claimed'){
   if(current.state===outcome.state&&current.resultCode===outcome.resultCode&&
    current.receiptId===outcome.receiptId)
    return {status:'already_persisted',state:current.state};
   return {status:'changed_claim'};
  }
  const updated=decoded.tasks.map(t=>t.key===claimedTask.key
   ?{...t,state:outcome.state,finishedAt:stamp,resultCode:outcome.resultCode,
     ...(outcome.receiptId?{receiptId:outcome.receiptId}:{})}:t);
  try{
   if(await persist(db,serviceId,decoded.raw,updated))
    return {status:'persisted',state:outcome.state};
  }catch{
   // Possible ACK loss: next iteration reads the journal and checks receipt
   // ownership. No provider re-entry, even if all CAS acknowledgements fail.
  }
 }
 return {status:'settle_uncertain'};
}

// Test-harness protocol only; this is intentionally not imported by any
// published function, cron, route or UI. Future production integration must
// separately enforce the code-owned rollout gate and add ALL consumers.
// Every adapter MUST recheck its recipient/business eligibility, create a
// durable receipt with task.key idempotency and return verified evidence.
export async function processStagedAssignmentEffectBatch(
 client:any,serviceId:string,options:EffectBatchOptions
){
 if(!options||typeof options.makeToken!=='function'||
  typeof options.preflight!=='function'||
  typeof options.verifyReceipt!=='function'||!options.adapters||
  typeof options.adapters!=='object')throw Error('Missing trusted effect adapters or preflight');
 const now=options.now||Date.now;
 const limit=typeof options.maxTasks==='number'&&
  Number.isSafeInteger(options.maxTasks)&&options.maxTasks>0
  ?Math.min(MAX_BATCH,options.maxTasks):MAX_BATCH;
 const stats={success:true,processed:0,completed:0,unknown:0,cancelled:0,
  manualReview:0,quarantined:0,busy:false,reason:'no_pending_work'};
 for(let i=0;i<limit;i++){
  const claim=await claimNextStagedAssignmentEffect(
   client,serviceId,options.adapters,options.makeToken(),now());
  if(claim.status==='expired_claim_quarantined'){
   stats.quarantined++;stats.unknown++;stats.reason='expired_claim_requires_review';
   continue;
  }
  if(claim.status!=='claimed'||!claim.task){
   stats.reason=claim.status;
   if(['claim_uncertain','quarantine_uncertain','concurrent_update'].includes(claim.status))
    stats.success=false;
   if(claim.status==='busy')stats.busy=true;
   break;
  }
  // Explicit claim CAS confirmation precedes every preflight and adapter.
  // A fresh EventService + Event decision is mandatory; if the task has been
  // superseded, do not contact any external provider or notification system.
  let disposition:ReturnType<typeof normalizeAdapterResult>;
  try{
   const check=await options.preflight(claim.task,serviceId);
   if(check?.action==='cancel'&&
    ['superseded','no_longer_applicable'].includes(check.reason))
    disposition={state:'cancelled',resultCode:check.reason};
   else if(check?.action==='review'&&
    ['invalid_business_state','consumer_not_ready'].includes(check.reason))
    disposition={state:'manual_review',resultCode:check.reason};
   else if(check?.action==='run'){
    const result=await options.adapters[claim.task.consumer]({
     task:claim.task,idempotencyKey:claim.task.key,serviceId
    });
    disposition=normalizeAdapterResult(claim.task,result);
    if(disposition.state==='completed'){
     // A provider ACK alone is not proof of durable, task-bound delivery
     // receipt. A separate backend lookup must verify the stored source.
     const verified=await options.verifyReceipt({task:claim.task,
      receiptId:disposition.receiptId!,serviceId});
     if(verified!==true)
      disposition={state:'unknown',resultCode:'receipt_verification_unknown'};
    }
   }else disposition={state:'unknown',resultCode:'preflight_uncertain'};
  }catch{
   disposition={state:'unknown',resultCode:'execution_exception_unknown'};
  }
  const settled=await finalizeStagedAssignmentEffect(
   client,serviceId,claim.task,disposition,now());
  if(!['persisted','already_persisted'].includes(settled.status)){
   stats.success=false;stats.reason='settlement_requires_review';
   break;
  }
  stats.processed++;
  if(disposition.state==='completed')stats.completed++;
  if(disposition.state==='unknown')stats.unknown++;
  if(disposition.state==='cancelled')stats.cancelled++;
  if(disposition.state==='manual_review')stats.manualReview++;
  stats.reason='batch_processed';
 }
 return stats;
}
