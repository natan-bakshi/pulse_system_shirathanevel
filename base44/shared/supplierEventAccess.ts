// Authenticated supplier event-link view. Returns a minimal projection of
// only an event to which the signed-in supplier remains actively assigned.
// No pricing, family contacts, other suppliers, free-form private notes,
// payments, credentials or raw Event/EventService objects leave this module.
const ID=/^[A-Za-z0-9_-]{3,100}$/;
const denied=()=>Object.assign(new Error('Not found'),{status:404});
const text=(input:any,max=180)=>typeof input==='string'?input.slice(0,max):'';
function samePhone(a:any,b:any){
 const digits=(v:any)=>String(v||'').replace(/[^0-9]/g,'');
 const canonical=(v:any)=>{
  const d=digits(v);
  return /^05[0-9]{8}$/.test(d)?'972'+d.slice(1):
   /^9725[0-9]{8}$/.test(d)?d:
   /^[1-9][0-9]{7,14}$/.test(d)?d:'';
 };
 return Boolean(canonical(a)&&canonical(a)===canonical(b));
}
export function supplierMatchesUser(supplier:any,user:any):boolean{
 if(!supplier||!user)return false;
 const email=String(user.email||'').trim().toLowerCase();
 const matchedEmail=email.length>3&&Array.isArray(supplier.contact_emails)&&
  supplier.contact_emails.some((value:any)=>
   typeof value==='string'&&value.trim().toLowerCase()===email);
 // User.phone is editable profile data, not proof of a verified number.
 // Do not authorize access by phone until the auth provider supplies a
 // server-verified binding. Email identity is checked against Supplier.
 return Boolean(matchedEmail);
}
export function supplierIsActivelyAssigned(row:any,supplierId:string):boolean{
 if(!row||row.is_external===true||!ID.test(supplierId))return false;
 let ids:any,statuses:any;
 try{
  ids=typeof row.supplier_ids==='string'?JSON.parse(row.supplier_ids):row.supplier_ids;
  statuses=typeof row.supplier_statuses==='string'?JSON.parse(row.supplier_statuses):
   row.supplier_statuses;
 }catch{return false;}
 if(!Array.isArray(ids)||!ids.includes(supplierId)||
  !statuses||typeof statuses!=='object'||Array.isArray(statuses))return false;
 // Suppliers who rejected or whose assignment was cancelled lose link access.
 return ['pending','approved','confirmed'].includes(statuses[supplierId]);
}
export function allowedSupplierEventView(event:any,services:any[],supplierId:string){
 if(!event||!ID.test(event.id||'')||!Array.isArray(services)||
  !services.some(s=>supplierIsActivelyAssigned(s,supplierId)))throw denied();
 return {
  id:event.id,
  eventName:text(event.event_name,140),
  familyName:text(event.family_name,100),
  date:text(event.event_date,40),
  time:text(event.event_time,40),
  location:text(event.location,180),
  city:text(event.city,90),
  services:services.filter(s=>supplierIsActivelyAssigned(s,supplierId)).map(s=>({
   serviceName:text(s.service_name,130),
   arrivalTime:text(s.supplier_arrival_time,40),
   status:JSON.parse(s.supplier_statuses)[supplierId]
  })).slice(0,30)
 };
}
export async function readSupplierEventView(client:any,user:any,eventId:unknown){
 if(!ID.test(String(eventId||''))||!user||
  (user.role!=='admin'&&user.user_type!=='supplier'))throw denied();
 const db=client?.asServiceRole?.entities;
 if(!db)throw denied();
 const suppliers=await db.Supplier.list();
 if(!Array.isArray(suppliers))throw denied();
 const supplier=suppliers.find((row:any)=>supplierMatchesUser(row,user));
 if(!supplier?.id||!ID.test(supplier.id))throw denied();
 const assignments=await db.EventService.filter({event_id:eventId});
 if(!Array.isArray(assignments)||
  !assignments.some((s:any)=>supplierIsActivelyAssigned(s,supplier.id)))
  throw denied();
 const event=await db.Event.get(eventId).catch(()=>null);
 if(!event)throw denied();
 return allowedSupplierEventView(event,assignments,supplier.id);
}
