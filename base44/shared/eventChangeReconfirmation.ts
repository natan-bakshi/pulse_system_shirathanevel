// Server-owned proof that an administrator chose "notify and re-confirm" in
// an Event/arrival-time change dialog. The marker is written in the SAME
// EventService.update as the statuses reset to pending. Ordinary reassignments
// never write it and must retain the existing new-assignment notification.
const ID=/^[A-Za-z0-9_-]{3,128}$/;
const REV=/^r[1-9][0-9]{0,12}$/;
const SOURCES={date_reconfirm:'assignment_update',arrival_notify:'arrival_time_change'} as const;
type Kind=keyof typeof SOURCES;
type Marker={version:1;kind:Kind;eventServiceId:string;eventId:string;
 revision:string;fingerprint:string;supplierIds:string[]};
export function parseEventChangeReconfirmation(raw:any):Marker|null {
 let data:any=raw;
 try{if(typeof data==='string')data=JSON.parse(data);}catch{return null;}
 if(!data||data.version!==1||!(data.kind in SOURCES)||
  !ID.test(data.eventServiceId||'')||!ID.test(data.eventId||'')||
  !REV.test(data.revision||'')||
  typeof data.fingerprint!=='string'||data.fingerprint.length<3||
  data.fingerprint.length>1200||!Array.isArray(data.supplierIds)||
  data.supplierIds.length<1||data.supplierIds.length>50||
  data.supplierIds.some((id:any)=>typeof id!=='string'||!ID.test(id))||
  new Set(data.supplierIds).size!==data.supplierIds.length)return null;
 return data as Marker;
}
export function planEventChangeReconfirmation(service:any,input:{
 kind:Kind;fingerprint:string;supplierIds:string[];
},at=Date.now()) {
 if(!ID.test(service?.id||'')||!ID.test(service?.event_id||'')||
  !Object.prototype.hasOwnProperty.call(SOURCES,input?.kind)||
  typeof input?.fingerprint!=='string'||input.fingerprint.length<3||
  input.fingerprint.length>1200||!Array.isArray(input.supplierIds)||
  !input.supplierIds.length||input.supplierIds.length>50||
  input.supplierIds.some(id=>!ID.test(id)))throw Error('Invalid reconfirmation transition');
 const supplierIds=[...new Set(input.supplierIds)].sort();
 const old=parseEventChangeReconfirmation(service.supplier_reconfirmation_context);
 if(old&&old.kind===input.kind&&old.eventServiceId===service.id&&
  old.eventId===service.event_id&&old.fingerprint===input.fingerprint&&
  JSON.stringify([...old.supplierIds].sort())===JSON.stringify(supplierIds))
  return {value:JSON.stringify(old),revision:old.revision,reused:true};
 const prior=Number(old?.revision?.slice(1)||0);
 const clock=Math.max(Math.floor(at),prior+1);
 if(!Number.isSafeInteger(clock)||clock<1||clock>9999999999999)
  throw Error('Invalid reconfirmation revision');
 const value:Marker={version:1,kind:input.kind,eventServiceId:service.id,
  eventId:service.event_id,revision:'r'+clock,
  fingerprint:input.fingerprint,supplierIds};
 return {value:JSON.stringify(value),revision:value.revision,reused:false};
}
function parseIds(raw:any):string[]{
 try{const v=typeof raw==='string'?JSON.parse(raw):raw;
  return Array.isArray(v)?v.map(String):[];}catch{return [];}
}
export function isEventChangeStatusReset(oldRow:any,newRow:any,supplierId:string):boolean{
 const previous=parseEventChangeReconfirmation(oldRow?.supplier_reconfirmation_context);
 const current=parseEventChangeReconfirmation(newRow?.supplier_reconfirmation_context);
 if(!current||oldRow?.supplier_reconfirmation_context===newRow?.supplier_reconfirmation_context||
   previous?.revision===current.revision||!current.supplierIds.includes(supplierId)||
   current.eventServiceId!==newRow?.id||current.eventId!==newRow?.event_id)return false;
 const previousIds=parseIds(oldRow?.supplier_ids);
 const currentIds=parseIds(newRow?.supplier_ids);
 if(!previousIds.includes(supplierId)||!currentIds.includes(supplierId))return false;
 const parseStatus=(row:any)=>{
  try{return typeof row?.supplier_statuses==='string'?JSON.parse(row.supplier_statuses||'{}'):
    row?.supplier_statuses||{};}catch{return {};}
 };
 const before=parseStatus(oldRow)[supplierId];
 const after=parseStatus(newRow)[supplierId];
 return !!before&&before!=='pending'&&after==='pending';
}
export function eligibleEventChangeReconfirmation(service:any,sourceType:string,supplierId:string,revision:string):boolean {
 const marker=parseEventChangeReconfirmation(service?.supplier_reconfirmation_context);
 if(!marker||marker.eventServiceId!==service.id||marker.eventId!==service.event_id||
  SOURCES[marker.kind]!==sourceType||marker.revision!==revision||
  !marker.supplierIds.includes(supplierId)||service.is_external===true||
  !parseIds(service.supplier_ids).includes(supplierId))return false;
 try{
  const map=typeof service.supplier_statuses==='string'?
   JSON.parse(service.supplier_statuses):service.supplier_statuses;
  return !!map&&!Array.isArray(map)&&map[supplierId]==='pending';
 }catch{return false;}
}
export function eventChangeSourceType(kind:Kind):string{return SOURCES[kind];}
