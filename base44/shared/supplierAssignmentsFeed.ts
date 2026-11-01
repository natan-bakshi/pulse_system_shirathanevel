// P0: server-only, read-only supplier assignment feed for the two supplier portals.
// No raw Event/EventService/Supplier/Service records or other suppliers' identities
// may reach the browser. Auth is the signed-in account email, NEVER phone, role
// claims in JSON, event IDs, link text or a user-provided supplier ID.
// Keep Event/EventService RLS unchanged until ALL non-admin consumers migrate.
import {supplierMatchesUser,supplierIsActivelyAssigned}
 from './supplierEventAccess.ts';

const ID=/^[A-Za-z0-9_-]{3,100}$/;
const BATCH=200,MAX_PAGES=20,MAX_ROWS=200,MAX_EVENTS=120;
const projection=[
 'id','event_id','service_id','supplier_ids','supplier_statuses',
 'supplier_notes','supplier_arrival_time','service_name',
 'service_description','is_external'
];
const forbidden=(code='forbidden')=>Object.assign(new Error(code),{status:403,code});
const unavailable=(code='supplier_feed_unavailable')=>
 Object.assign(new Error(code),{status:503,code});
const safe=(value:any,max=200)=>typeof value==='string'?value.slice(0,max):'';
const number=(value:any)=>typeof value==='number'&&Number.isFinite(value)?value:0;
const record=(raw:any):Record<string,any>=>{
 let data=raw;
 try{if(typeof data==='string')data=JSON.parse(data);}catch{return {};}
 return data&&typeof data==='object'&&!Array.isArray(data)?data:{};
};
const normalizeStatus=(value:unknown)=>{
 if(value==='approved')return 'confirmed'; // historical saved status
 if(value==='pending'||value==='confirmed'||value==='rejected')return value;
 return null;
};

// Membership must be checked before event reads and AGAIN before projection.
// Rejected assignments remain visible as a *redacted history card* in Pulse,
// so suppliers can use existing in-app reapproval. They never expose event
// location, family, child, event link, notes or other private details.
export function supplierFeedAssignment(assignment:any,event:any,service:any,
 supplierId:string){
 if(!assignment||!ID.test(assignment.id||'')||
  !ID.test(assignment.event_id||'')||!ID.test(supplierId)||
  assignment.is_external===true)return null;
 let ids:any;
 try{ids=typeof assignment.supplier_ids==='string'?
  JSON.parse(assignment.supplier_ids):assignment.supplier_ids;}catch{return null;}
 if(!Array.isArray(ids)||!ids.includes(supplierId))return null;
 const status=normalizeStatus(record(assignment.supplier_statuses)[supplierId]);
 if(!status||!event||event.id!==assignment.event_id)return null;
 const isActive=status!=='rejected'&&
  supplierIsActivelyAssigned(assignment,supplierId);
 if(status!=='rejected'&&!isActive)return null;
 const arrival=isActive?safe(assignment.supplier_arrival_time,40).trim():'';
 return {
  id:safe(event.id,100),
  eventServiceId:assignment.id,
  assignmentStatus:status,
  // No fields beyond this allowlist are ever copied from Event.
  event_name:isActive?safe(event.event_name,140):'שיבוץ שנדחה',
  family_name:isActive?safe(event.family_name,100):'',
  child_name:isActive?safe(event.child_name,100):'',
  event_date:safe(event.event_date,40),
  event_time:isActive?(arrival||safe(event.event_time,40)):'',
  original_event_time:isActive?safe(event.event_time,40):'',
  supplier_arrival_time:arrival,
  location:isActive?safe(event.location,180):'',
  city:isActive?safe(event.city,90):'',
  guest_count:isActive?number(event.guest_count):0,
  serviceName:safe(assignment.service_name||service?.service_name,130)||'שירות שנדחה',
  serviceDescription:isActive?safe(
   assignment.service_description||service?.service_description,5000):'',
  supplierNote:isActive?safe(record(assignment.supplier_notes)[supplierId],1500):'',
  // Explicitly no created_by, raw notes, financials, family contacts or
  // any ID/name/status belonging to other supplier assignments.
  detailsAllowed:isActive
 };
}
async function pageServices(db:any){
 if(typeof db?.EventService?.filter!=='function')
  throw unavailable();
 const rows:any[]=[],ids=new Set<string>();
 for(let i=0;i<MAX_PAGES;i++){
  // Only minimal columns are transferred inside the trusted backend.
  const page=await db.EventService.filter({},'-created_date',BATCH,
    i*BATCH,projection);
  if(!Array.isArray(page)||page.length>BATCH)throw unavailable();
  for(const row of page){
   if(!ID.test(row?.id||'')||ids.has(row.id))throw unavailable();
   ids.add(row.id);rows.push(row);
  }
  if(page.length<BATCH)return rows;
 }
 // Never silently serve incomplete lists that could conceal assignments.
 throw unavailable('supplier_feed_scan_limit');
}
async function limitedMap<T,U>(values:T[],f:(value:T)=>Promise<U>,width=6):Promise<U[]>{
 const result:U[]=new Array(values.length);
 let current=0;
 await Promise.all(Array.from({length:Math.min(width,values.length)},
  async()=>{for(;;){const index=current++;if(index>=values.length)break;
   result[index]=await f(values[index]);}}));
 return result;
}
export async function readSupplierAssignmentsFeed(client:any,user:any){
 if(!user||(user.role!=='admin'&&user.user_type!=='supplier')||
  typeof user.email!=='string'||!user.email.trim())
  throw forbidden();
 const db=client?.asServiceRole?.entities;
 if(!db?.Supplier?.list||!db?.Event?.get||!db?.Service?.get)
  throw unavailable();
 const suppliers=await db.Supplier.list();
 if(!Array.isArray(suppliers))throw unavailable();
 // An account may have multiple supplier rows. Match EMAIL exactly and
 // select the first, consistent with the existing updateSupplierStatus
 // endpoint. Never allow client choice of a different supplier ID.
 const supplier=suppliers.find((row:any)=>ID.test(row?.id||'')&&
  supplierMatchesUser(row,user));
 if(!supplier)return {supplier:null,assignments:[]};
 const services=await pageServices(db);
 const mine=services.filter((row:any)=>{
  if(row?.is_external===true)return false;
  const status=normalizeStatus(record(row.supplier_statuses)[supplier.id]);
  if(!status)return false;
  try{
   const ids=typeof row.supplier_ids==='string'?JSON.parse(row.supplier_ids):
    row.supplier_ids;
   return Array.isArray(ids)&&ids.includes(supplier.id);
  }catch{return false;}
 });
 if(mine.length>MAX_ROWS)throw unavailable('supplier_feed_too_many_assignments');
 const eventIds=[...new Set(mine.map((row:any)=>row.event_id))];
 if(eventIds.length>MAX_EVENTS||eventIds.some(id=>!ID.test(id||'')))
  throw unavailable('supplier_feed_event_limit');
 const events=await limitedMap(eventIds,async id=>
  db.Event.get(id).catch(()=>null));
 const eventMap=new Map(eventIds.map((id,i)=>[id,events[i]]));
 const catalogIds=[...new Set(mine.filter((row:any)=>
  !row.service_name||!row.service_description).map((row:any)=>row.service_id)
   .filter((id:any)=>ID.test(id||'')))];
 const catalogs=await limitedMap(catalogIds,async id=>
  db.Service.get(id).catch(()=>null));
 const catalogMap=new Map(catalogIds.map((id,i)=>[id,catalogs[i]]));
 const assignments=mine.map((row:any)=>
  supplierFeedAssignment(row,eventMap.get(row.event_id),
   catalogMap.get(row.service_id),supplier.id)).filter(Boolean);
 return {
  supplier:{id:supplier.id,supplier_name:safe(supplier.supplier_name,140)},
  assignments
 };
}
