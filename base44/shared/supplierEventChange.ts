// Minimal server-owned context of an Event's critical field edits.
// Only entity-change triggers may create this snapshot; UI cannot select
// message recipients, clear approvals or enable signed buttons.
export const SUPPLIER_EVENT_FIELDS=Object.freeze([
 'event_date','event_time','location','concept'
] as const);
export type EventChangeField=(typeof SUPPLIER_EVENT_FIELDS)[number];
const KNOWN=new Set<string>(SUPPLIER_EVENT_FIELDS);
type Change={version:1;fields:EventChangeField[];
 before:Record<string,string>;after:Record<string,string>};
const value=(x:any)=>String(x??'');
export function detectSupplierEventChanges(oldRow:any,newRow:any){
 return SUPPLIER_EVENT_FIELDS.filter(key=>
  Object.prototype.hasOwnProperty.call(newRow||{},key)&&
  Object.prototype.hasOwnProperty.call(oldRow||{},key)&&
  value(oldRow[key])!==value(newRow[key]));
}
export function parseSupplierEventChange(raw:any):Change|null{
 let x=raw;
 try{if(typeof x==='string')x=JSON.parse(x);}catch{return null;}
 if(!x||x.version!==1||!Array.isArray(x.fields)||
  x.fields.length<1||x.fields.length>SUPPLIER_EVENT_FIELDS.length||
  x.fields.some((f:any)=>!KNOWN.has(f))||
  new Set(x.fields).size!==x.fields.length||
  !x.before||!x.after||
  typeof x.before!=='object'||typeof x.after!=='object'||
  x.fields.some((f:any)=>typeof x.before[f]!=='string'||typeof x.after[f]!=='string'||
    x.before[f].length>900||x.after[f].length>900))return null;
 return {version:1,fields:x.fields,before:x.before,after:x.after};
}
export function supplierEventChangeSnapshot(oldRow:any,newRow:any){
 const fields=detectSupplierEventChanges(oldRow,newRow);
 const prior=parseSupplierEventChange(oldRow?.supplier_event_change_context);
 const before:Record<string,string>={},after:Record<string,string>={};
 const union=new Set<EventChangeField>([...(prior?.fields||[]),...fields]);
 for(const field of union){
  before[field]=prior?.before[field]??value(oldRow?.[field]);
  after[field]=value(newRow?.[field]??oldRow?.[field]);
 }
 return {version:1 as const,fields:[...union],before,after};
}
export function supplierEventAffectedService(service:any,change:any):boolean{
 if(!service||service.is_external===true)return false;
 let ids:any;
 try{ids=typeof service.supplier_ids==='string'?
  JSON.parse(service.supplier_ids||'[]'):service.supplier_ids;}
 catch{return false;}
 if(!Array.isArray(ids)||ids.length===0)return false;
 const context=parseSupplierEventChange(change);
 if(!context)return false;
 // Fixed arrival-time suppliers are unaffected ONLY by a pure change
 // to the *event start time*. A date/location/concept change affects them.
 const onlyEventTiming=context.fields.every(f=>f==='event_date'||f==='event_time');
 return !onlyEventTiming||!String(service.supplier_arrival_time||'').trim();
}
export function eventChangeFingerprint(context:any):string{
 const c=parseSupplierEventChange(context);
 if(!c)throw Error('Invalid event-change context');
 return JSON.stringify([c.fields.map(field=>[
  field,c.before[field],c.after[field]
 ])]);
}
export function eventChangePending(event:any):boolean{
 return event?.date_change_pending_action===true;
}
