// Authenticated, read-only supplier event card. Share the logistics needed
// for work (schedule, own service details, family names and parent contact)
// ONLY after proving current supplier membership against server-side records.
// Pricing, internal notes, other supplier assignments and raw entity objects
// must never leave this module.
import {parseWhatsAppPhone} from './whatsappPhone.ts';
const ID=/^[A-Za-z0-9_-]{3,100}$/;
const denied=()=>Object.assign(new Error('Not found'),{status:404});
const text=(input:any,max=180)=>typeof input==='string'?input.slice(0,max):'';
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
  statuses=typeof row.supplier_statuses==='string'?JSON.parse(row.supplier_statuses||'{}'):
   (row.supplier_statuses??{});
 }catch{return false;}
 if(!Array.isArray(ids)||!ids.includes(supplierId)||
  !statuses||typeof statuses!=='object'||Array.isArray(statuses))return false;
 // Suppliers who rejected or whose assignment was cancelled lose link access.
 // Membership with no explicit status is a pending legacy assignment;
 // malformed records and non-members still fail closed above.
 return ['pending','approved','confirmed'].includes(statuses[supplierId]??'pending');
}
function assignedStatus(row:any,supplierId:string):string{
 try{
  const statuses=typeof row.supplier_statuses==='string'?JSON.parse(row.supplier_statuses||'{}'):
   (row.supplier_statuses??{});
  return String(statuses?.[supplierId]??'pending');
 }catch{return '';}
}
function arrayValue(value:any):any[]{
 if(Array.isArray(value))return value;
 if(typeof value==='string'&&value.length<=200000){
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}
  catch{}
 }
 return [];
}
// Service descriptions can contain Quill HTML. Convert to readable text on
// the server; the supplier page MUST NOT inject service HTML into the DOM.
function plainServiceDescription(value:any):string{
 const raw=text(value,8000);
 if(!raw)return '';
 return raw
  .replace(/<(script|style|iframe|object|template)[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
  .replace(/<!--[\s\S]*?-->/g,'')
  .replace(/<br\s*\/?\s*>/gi,'\n')
  .replace(/<\/(?:p|div|li|h[1-6]|ul|ol)\s*>/gi,'\n')
  .replace(/<[^>]+>/g,'')
  .replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|(amp|lt|gt|quot|apos|nbsp));/gi,(match,hex,decimal,name)=>{
   if(name)return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[name.toLowerCase()]||match;
   const n=Number.parseInt(hex||decimal,hex?16:10);
   return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';
  })
  .replace(/[^\S\n]+/g,' ')
  .replace(/\n[ \t]+/g,'\n')
  .replace(/\n{3,}/g,'\n\n').trim().slice(0,7000);
}
function supplierParentContacts(raw:any){
 return arrayValue(raw).slice(0,12).map((entry:any)=>{
  const name=text(entry?.name,120).trim();
  const phone=text(entry?.phone,45).trim();
  const parsed=parseWhatsAppPhone(phone);
  return {name,phone,
   // Only canonical, verified-syntax dial destinations, never raw URL input.
   dialNumber:parsed.status==='VALID'?parsed.canonicalE164:'',
   whatsappNumber:parsed.status==='VALID'?parsed.digits:''};
 }).filter(item=>item.name||item.phone);
}
function supplierSchedule(raw:any){
 return arrayValue(raw).slice(0,150).map((item:any)=>({
  time:text(item?.time,40),
  activity:text(item?.activity,600),
  notes:text(item?.notes,1000)
 })).filter(item=>item.time||item.activity||item.notes);
}
function supplierMeetingPoints(row:any){
 const value=text(row?.pickup_point,12000).trim();
 if(!value)return [];
 let units:any[];
 try{
  const parsed=JSON.parse(value);
  if(!Array.isArray(parsed))return [];
  units=parsed;
 }catch{
  // Old transport services stored a single plain-text meeting place.
  if(value.startsWith('[')||value.startsWith('{'))return [];
  return [{location:text(value,260),time:text(row?.standing_time,40),unit:1}];
 }
 const points:{location:string;time:string;unit:number}[]=[];
 for(const [i,unit] of units.slice(0,20).entries()){
  if(!Array.isArray(unit?.pickupPoints))continue;
  for(const point of unit.pickupPoints.slice(0,20)){
   const location=text(point?.location,260).trim();
   const time=text(point?.time,40).trim();
   if(location||time)points.push({location,time,unit:i+1});
  }
 }
 return points;
}
function supplierOwnNote(raw:any,supplierId:string){
 try{
  const data=typeof raw==='string'?JSON.parse(raw):raw;
  return data&&typeof data==='object'&&!Array.isArray(data)?
   text(data[supplierId],1200):'';
 }catch{return '';}
}
export function allowedSupplierEventView(event:any,services:any[],supplierId:string,
 catalogs:Map<string,any>=new Map()){
 if(!event||!ID.test(event.id||'')||!Array.isArray(services)||
  !services.some(s=>supplierIsActivelyAssigned(s,supplierId)))throw denied();
 return {
  id:event.id,
  eventName:text(event.event_name,140),
  familyName:text(event.family_name,100),
  childName:text(event.child_name,100),
  parents:supplierParentContacts(event.parents),
  schedule:supplierSchedule(event.schedule),
  date:text(event.event_date,40),
  time:text(event.event_time,40),
  location:text(event.location,180),
  city:text(event.city,90),
  services:services.filter(s=>supplierIsActivelyAssigned(s,supplierId)).slice(0,60).map(s=>{
   const catalog=catalogs.get(s.service_id);
   const points=supplierMeetingPoints(s);
   return {
    serviceName:text(s.service_name||catalog?.service_name,130),
    serviceDescription:plainServiceDescription(
     s.service_description||catalog?.service_description),
    arrivalTime:text(s.supplier_arrival_time,40),
    standingTime:text(s.standing_time,40),
    // Pickup locations are from this supplier's assigned services ONLY.
    meetingLocation:points[0]?.location||'',
    pickupPoints:points,
    supplierNote:supplierOwnNote(s.supplier_notes,supplierId),
    status:assignedStatus(s,supplierId)
   };
  })
 };
}
export async function readSupplierEventView(client:any,user:any,eventId:unknown){
 if(typeof eventId!=='string'||!ID.test(eventId)||!user||
  (user.role!=='admin'&&user.user_type!=='supplier'))throw denied();
 const db=client?.asServiceRole?.entities;
 if(!db)throw denied();
 const suppliers=await db.Supplier.list();
 if(!Array.isArray(suppliers))throw denied();
 const matches=suppliers.filter((row:any)=>
  supplierMatchesUser(row,user)&&ID.test(row.id||''));
 if(!matches.length)throw denied();
 const assignments=await db.EventService.filter({event_id:eventId});
 if(!Array.isArray(assignments))throw denied();
 const supplier=matches.find((row:any)=>assignments.some((assignment:any)=>
  supplierIsActivelyAssigned(assignment,row.id)));
 if(!supplier)throw denied();
 const event=await db.Event.get(eventId).catch(()=>null);
 if(!event)throw denied();
 const own=assignments.filter((row:any)=>supplierIsActivelyAssigned(row,supplier.id));
 const catalogs=new Map<string,any>();
 if(typeof db.Service?.get==='function'){
  // Optional global service fallback ONLY for own assigned services missing
  // a name/description; never load unrelated catalog records or prices.
  const ids=[...new Set(own.filter((s:any)=>
   !s.service_description||!s.service_name).map((s:any)=>s.service_id)
   .filter((id:any)=>typeof id==='string'&&ID.test(id)))].slice(0,60);
  const rows=await Promise.all(ids.map((id:string)=>
   db.Service.get(id).catch(()=>null)));
  ids.forEach((id:string,i:number)=>catalogs.set(id,rows[i]));
 }
 return allowedSupplierEventView(event,own,supplier.id,catalogs);
}
