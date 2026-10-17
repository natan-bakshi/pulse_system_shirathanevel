// Durable assignment-notification intent builder (phase 1, feature-flagged).
// Stores the business transition on EventService in the SAME conditional write
// as supplier IDs/statuses. It never calls a WhatsApp provider.
export const ASSIGNMENT_INTENT_MODE='durable_v1';
const MAX_INTENTS=120;
const MAX_SUPPLIERS=40;
const ID=/^[A-Za-z0-9_-]{3,100}$/;
const ACTIVE_STATES=new Set(['requested','queued','accepted','failed_definite','unknown','cancelled','resolved']);

function stringList(raw:any):string[] {
  let value=raw;
  if(typeof value==='string') {
    try{value=JSON.parse(value||'[]');}catch{throw new Error('Malformed supplier IDs JSON');}
  }
  if(!Array.isArray(value)||value.length>MAX_SUPPLIERS||value.some(v=>typeof v!=='string'||!ID.test(v))||
     new Set(value).size!==value.length)throw new Error('Invalid or duplicate supplier IDs');
  return value;
}
function stringMap(raw:any,name:string,allowedKeys?:Set<string>):Record<string,string>{
  let value=raw;
  if(typeof value==='string') {
    try{value=JSON.parse(value||'{}');}catch{throw new Error('Malformed '+name+' JSON');}
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid '+name);
  const output:Record<string,string>={};
  const entries=Object.entries(value);
  if(entries.length>MAX_SUPPLIERS)throw new Error('Too many '+name);
  for(const [id,v] of entries){
    if(!ID.test(id)||(allowedKeys&&!allowedKeys.has(id))||typeof v!=='string'||v.length>1500)throw new Error('Invalid '+name+' entry');
    output[id]=v;
  }
  return output;
}
export function readAssignmentIntents(raw:any):any[]{
  if(!raw)return [];
  let parsed=raw;
  try{if(typeof parsed==='string')parsed=JSON.parse(parsed);}catch{throw new Error('Malformed assignment intent log');}
  if(!Array.isArray(parsed)||parsed.length>MAX_INTENTS)throw new Error('Corrupted assignment intent log');
  for(const intent of parsed){
    if(!intent||!ID.test(String(intent.supplier_id||''))||
      !/^[a-zA-Z0-9:_-]{8,240}$/.test(String(intent.key||''))||
      !ACTIVE_STATES.has(intent.state)||!Number.isSafeInteger(intent.revision)||intent.revision<1){
      throw new Error('Corrupted assignment intent');
    }
  }
  return parsed;
}
export function planAssignmentTransition(service:any,request:any,stamp:string){
  if(!service?.id||!ID.test(String(service.id)))throw new Error('Invalid EventService');
  if(service.is_external===true)throw new Error('External EventService has no supplier assignments');
  if(!Number.isFinite(Date.parse(stamp)))throw new Error('Invalid transition timestamp');
  const before=stringList(service.supplier_ids||'[]');
  const beforeMap=stringMap(service.supplier_statuses||'{}','old supplier statuses');
  const ids=stringList(request.supplierIds);
  const assigned=new Set(ids);
  // Never silently erase statuses or notes because a caller omitted a field.
  if(request.supplierStatuses===undefined||request.supplierNotes===undefined){
    throw new Error('Supplier statuses and notes must be provided explicitly');
  }
  const statusMap=stringMap(request.supplierStatuses,'supplier statuses',assigned);
  const notesMap=stringMap(request.supplierNotes,'supplier notes',assigned);
  // A missing status for an already assigned supplier means "unchanged";
  // for a first-time assignment, it means "pending" (legacy behavior).
  for(const id of ids){
    if(statusMap[id]===undefined && beforeMap[id]!==undefined)statusMap[id]=beforeMap[id];
  }
  const was=new Set(before);
  // Assignment requests exist only when approval is genuinely required.
  const candidates=ids.filter(id=>{
    const next=statusMap[id]||'pending';
    return next==='pending'&&(!was.has(id)||
      (beforeMap[id]&&beforeMap[id]!=='pending'));
  });
  const oldRevision=Number(service.assignment_intent_revision||0);
  if(!Number.isSafeInteger(oldRevision)||oldRevision<0||oldRevision>=Number.MAX_SAFE_INTEGER-1)
    throw new Error('Invalid assignment revision');
  const historical=readAssignmentIntents(service.assignment_notification_intents||'[]');
  if(historical.length+candidates.length>MAX_INTENTS){
    throw new Error('Assignment intent log is full; administrator reconciliation is required');
  }
  const revision=candidates.length?oldRevision+1:oldRevision;
  const intents=candidates.map(id=>({
    key:['assignment',String(service.id),id,'r'+revision,'SUPPLIER_NEW_ASSIGNMENT'].join(':'),
    supplier_id:id,revision,transition:was.has(id)?'reopened':'added',
    state:'requested',created_at:new Date(stamp).toISOString()
  }));
  // "requested" is a durable intent, NOT proof of queue insertion or delivery.
  // The Outbox/transport stages retain their own independent truth.
  const patch:any={
    supplier_ids:JSON.stringify(ids),supplier_statuses:JSON.stringify(statusMap),
    supplier_notes:JSON.stringify(notesMap)
  };
  if(request.clientNotes!==undefined){
    if(typeof request.clientNotes!=='string'||request.clientNotes.length>10000)
      throw new Error('Invalid client notes');
    patch.client_notes=request.clientNotes;
  }
  if(request.minSuppliers!==undefined){
    if(!Number.isInteger(request.minSuppliers)||request.minSuppliers<0||request.minSuppliers>MAX_SUPPLIERS)
      throw new Error('Invalid minimum suppliers');
    patch.min_suppliers=request.minSuppliers;
  }
  if(candidates.length){
    patch.assignment_intent_mode=ASSIGNMENT_INTENT_MODE;
    patch.assignment_intent_revision=revision;
    patch.assignment_notification_intents=JSON.stringify([...historical,...intents]);
    patch.assignment_intents_pending=true;
  }
  return {patch,intents,revision,hasNewIntent:intents.length>0};
}
export function savedAssignmentIntentKey(service:any,supplierId:string):string{
  if(service?.assignment_intent_mode!==ASSIGNMENT_INTENT_MODE)return '';
  const intents=readAssignmentIntents(service.assignment_notification_intents||'[]');
  for(let i=intents.length-1;i>=0;i--){
    if(intents[i].supplier_id===supplierId)return intents[i].key;
  }
  return '';
}
