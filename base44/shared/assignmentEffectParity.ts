// Pure parity inventory for migrating assignment saves from Base44 entity
// UPDATE workflows to durable CAS + business-effect outbox.
// This module does NOT send Push/WhatsApp, create reminders, or sync calendars.
// The old EventService.update workflows MUST remain active until each effect
// can be delivered with durable idempotency and a recovery policy.
const MAX_SUPPLIERS=40;
const MAX_TEXT=10000;
const ID=/^[A-Za-z0-9_-]{3,100}$/;
const ALLOWED_STATUS=new Set(['pending','confirmed','rejected','cancelled']);
export type AssignmentEffectKind=
 'supplier_assigned'|'supplier_reopened'|'supplier_removed'|
 'supplier_status_changed'|'supplier_note_changed'|
 'client_notes_changed'|'minimum_changed';
export type AssignmentTransitionEffect={
 kind:AssignmentEffectKind;supplierId?:string;
 beforeStatus?:string;afterStatus?:string
};
export type AssignmentEffectParity={
 required:boolean;effects:readonly AssignmentTransitionEffect[];
 requiredConsumers:readonly string[];
 changedFields:readonly string[];
 supplierCount:number
};
const fail=(key:string):never=>{throw Error('Invalid assignment effects snapshot: '+key);};
function list(raw:any,name:string):string[]{
 let v=raw??'[]';
 if(typeof v==='string'){try{v=JSON.parse(v);}catch{fail(name);}}
 if(!Array.isArray(v)||v.length>MAX_SUPPLIERS||
  v.some(x=>typeof x!=='string'||!ID.test(x))||
  new Set(v).size!==v.length)fail(name);
 return v;
}
function map(raw:any,name:string):Record<string,string>{
 let v=raw??'{}';
 if(typeof v==='string'){try{v=JSON.parse(v);}catch{fail(name);}}
 if(!v||typeof v!=='object'||Array.isArray(v)||
  Object.keys(v).length>MAX_SUPPLIERS)fail(name);
 const entries=Object.entries(v);
 if(entries.some(([key,value])=>!ID.test(key)||
  typeof value!=='string'||value.length>1500))fail(name);
 return Object.fromEntries(entries) as Record<string,string>;
}
const activeStatus=(value:string|undefined)=>value||'pending';
const different=(a:any,b:any)=>a!==b;
function changedNotes(before:Record<string,string>,after:Record<string,string>,id:string){
 return (before[id]||'')!==(after[id]||'');
}
export function planAssignmentEffectParity(before:any,patch:any):AssignmentEffectParity{
 if(!before||!ID.test(String(before.id||''))||
  !patch||typeof patch!=='object'||Array.isArray(patch))
  fail('service_or_patch');
 const previous=list(before.supplier_ids,'previous_suppliers');
 const next=list(patch.supplier_ids??before.supplier_ids,'next_suppliers');
 const prevStatus=map(before.supplier_statuses,'previous_statuses');
 const nextStatus=map(patch.supplier_statuses??before.supplier_statuses,'next_statuses');
 const prevNotes=map(before.supplier_notes,'previous_notes');
 const nextNotes=map(patch.supplier_notes??before.supplier_notes,'next_notes');
 if(Object.keys(nextStatus).some(id=>!next.includes(id))||
  Object.keys(nextNotes).some(id=>!next.includes(id)))fail('unassigned_new_supplier_metadata');
 if([...Object.values(prevStatus),...Object.values(nextStatus)]
  .some(v=>!ALLOWED_STATUS.has(v)))fail('unsupported_supplier_status');
 const effects:AssignmentTransitionEffect[]=[];
 const old=new Set(previous),current=new Set(next);
 for(const supplierId of [...new Set([...previous,...next])].sort()){
  const had=old.has(supplierId),has=current.has(supplierId);
  const beforeStatus=activeStatus(prevStatus[supplierId]);
  const afterStatus=activeStatus(nextStatus[supplierId]);
  if(!had&&has){
   effects.push({kind:'supplier_assigned',supplierId,afterStatus});
  }else if(had&&!has){
   effects.push({kind:'supplier_removed',supplierId,beforeStatus});
  }else if(had&&has){
   if(beforeStatus!==afterStatus){
    effects.push({kind:afterStatus==='pending'&&beforeStatus!=='pending'?
     'supplier_reopened':'supplier_status_changed',
     supplierId,beforeStatus,afterStatus});
   }
   if(changedNotes(prevNotes,nextNotes,supplierId))
    effects.push({kind:'supplier_note_changed',supplierId});
  }
 }
 const currentNotes=patch.client_notes??before.client_notes;
 const previousNotes=before.client_notes??'';
 if(typeof currentNotes!=='string'||currentNotes.length>MAX_TEXT)fail('client_notes');
 if(different(currentNotes,previousNotes))
  effects.push({kind:'client_notes_changed'});
 const minOld=before.min_suppliers??0,minNext=patch.min_suppliers??minOld;
 if(!Number.isSafeInteger(minOld)||!Number.isSafeInteger(minNext)||
  minOld<0||minNext<0||minOld>MAX_SUPPLIERS||minNext>MAX_SUPPLIERS)
  fail('minimum_suppliers');
 if(minOld!==minNext)effects.push({kind:'minimum_changed'});
 const hasAssignments=effects.some(e=>e.kind==='supplier_assigned'||
  e.kind==='supplier_reopened');
 const suppliersChanged=effects.some(e=>e.supplierId!==undefined);
 const consumers=new Set<string>();
 if(effects.length)consumers.add('event_status_readiness');
 if(effects.length)consumers.add('entity_update_notifications');
 if(suppliersChanged)consumers.add('google_calendar_sync');
 if(hasAssignments){
  consumers.add('supplier_assignment_push');
  consumers.add('supplier_pending_reminder');
 }
 if(effects.some(e=>e.kind==='supplier_removed'))
  consumers.add('assignment_removed_notifications');
 if(effects.some(e=>e.kind==='supplier_status_changed'))
  consumers.add('assignment_status_notifications');
 const changedFields=new Set<string>();
 if(previous.length!==next.length||previous.some((v,i)=>v!==next[i]))
  changedFields.add('supplier_ids');
 if(effects.some(e=>e.kind==='supplier_status_changed'||e.kind==='supplier_reopened'||
  e.kind==='supplier_assigned'||e.kind==='supplier_removed'))
  changedFields.add('supplier_statuses');
 if(effects.some(e=>e.kind==='supplier_note_changed'))
  changedFields.add('supplier_notes');
 if(effects.some(e=>e.kind==='client_notes_changed'))changedFields.add('client_notes');
 if(effects.some(e=>e.kind==='minimum_changed'))changedFields.add('min_suppliers');
 return {
  required:effects.length>0,
  effects:Object.freeze(effects.map(x=>Object.freeze(x))),
  requiredConsumers:Object.freeze([...consumers].sort()),
  changedFields:Object.freeze([...changedFields].sort()),
  supplierCount:next.length
 };
}
