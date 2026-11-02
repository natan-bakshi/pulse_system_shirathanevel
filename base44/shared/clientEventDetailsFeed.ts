// P0 authenticated read-only client EventDetails projection.
// A client may request ONLY their own event ID. Server checks creator/contact
// entitlement before looking up services or catalog. Raw Event/EventService,
// supplier identities, workflow internals and private payment/card fields never
// cross this boundary. Entity RLS remains separately tracked for safe rollout.
import {canOpenClientEventCard} from './clientEventLinkAccess.ts';
import {getEventContacts} from './eventFields.js';

const ID=/^[A-Za-z0-9_-]{3,100}$/;
const MAX_SERVICES=400,MAX_PAGES=14,PAGE_SIZE=150,MAX_CATALOG=100;
const stop=(message:string,status=503)=>
 Object.assign(new Error(message),{status,code:message});
const string=(raw:any,max=300)=>typeof raw==='string'?raw.slice(0,max):'';
const finite=(raw:any)=>typeof raw==='number'&&Number.isFinite(raw)?raw:0;
const flag=(raw:any)=>raw===true;
const scalar=(raw:any,max=500)=>typeof raw==='string'?raw.slice(0,max):
 typeof raw==='number'&&Number.isFinite(raw)?raw:typeof raw==='boolean'?raw:'';
const mapText=(raw:any)=>{
 let value:any=raw;
 try{if(typeof value==='string')value=JSON.parse(value);}catch{return {};}
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const out:Record<string,any>={};
 for(const [key,entry] of Object.entries(value).slice(0,80)){
  if(typeof key!=='string'||key.length>90)continue;
  out[key]=scalar(entry,1000);
 }
 return out;
};
const ownContacts=(raw:any)=>
 getEventContacts(raw).slice(0,40).map((item:any)=>({
  id:string(item.id,100),name:string(item.name,140),
  phone:string(item.phone,70),email:string(item.email,150),
  role:string(item.role,80),client_access:item.client_access!==false,
  custom_fields:mapText(item.custom_fields)
 }));
export function clientEventCardProject(event:any){
 if(!event||!ID.test(event.id||''))throw stop('invalid_event');
 return {
  id:event.id,event_name:string(event.event_name,140),
  event_type:string(event.event_type,50),
  event_date:string(event.event_date,40),event_time:string(event.event_time,40),
  location:string(event.location,180),city:string(event.city,90),
  concept:string(event.concept,150),family_name:string(event.family_name,130),
  child_name:string(event.child_name,120),guest_count:finite(event.guest_count),
  status:string(event.status,40),primary_currency:string(event.primary_currency,5)||'ILS',
  all_inclusive:flag(event.all_inclusive),
  all_inclusive_price:finite(event.all_inclusive_price),
  all_inclusive_includes_vat:flag(event.all_inclusive_includes_vat),
  total_override:finite(event.total_override),
  total_override_includes_vat:flag(event.total_override_includes_vat),
  is_price_per_guest:flag(event.is_price_per_guest),
  price_per_guest:finite(event.price_per_guest),
  discount_amount:finite(event.discount_amount),
  discount_before_vat:flag(event.discount_before_vat),
  discount_reason:string(event.discount_reason,500),
  discount_type:string(event.discount_type,30)||'fixed',
  notes:string(event.notes,4000),
  schedule:Array.isArray(event.schedule)?event.schedule.slice(0,150).map((entry:any)=>({
   time:string(entry?.time,50),activity:string(entry?.activity,600),
   notes:string(entry?.notes,1200)
  })):[],
  parents:ownContacts(event),contacts_schema_version:2,
  organizer_type:string(event.organizer_type,100),
  custom_organizer_fields:mapText(event.custom_organizer_fields),
  services_section_title:string(event.services_section_title,150),
  standalone_services_title:string(event.standalone_services_title,150),
  external_services_title:string(event.external_services_title,150)
 };
}
const SERVICE_FIELDS=[
 'id','event_id','service_id','service_name','package_id','is_package_main_item',
 'is_external','parent_package_event_service_id','package_name','package_price',
 'package_includes_vat','package_description','order_index','custom_price',
 'currency','converted_price','quantity','total_price','includes_vat',
 'client_notes','price_display_mode','price_display_text','show_price_in_quote',
 'service_description','pickup_point','standing_time','on_site_contact_details'
];
function projectClientService(row:any,eventId:string){
 if(!row||!ID.test(row.id||'')||row.event_id!==eventId)
  throw stop('client_event_service_mismatch');
 const contact=row.on_site_contact_details;
 const publicContact=contact&&typeof contact==='object'&&!Array.isArray(contact)?{
  name:string(contact.name,120),phone:string(contact.phone,70)}:{};
 return {
  id:row.id,event_id:eventId,service_id:string(row.service_id,100),
  service_name:string(row.service_name,180),package_id:string(row.package_id,100),
  is_package_main_item:flag(row.is_package_main_item),is_external:flag(row.is_external),
  parent_package_event_service_id:string(row.parent_package_event_service_id,100),
  package_name:string(row.package_name,150),package_price:finite(row.package_price),
  package_includes_vat:flag(row.package_includes_vat),
  package_description:string(row.package_description,4000),
  order_index:finite(row.order_index),custom_price:finite(row.custom_price),
  currency:string(row.currency,10),converted_price:finite(row.converted_price),
  quantity:finite(row.quantity)||1,total_price:finite(row.total_price),
  includes_vat:flag(row.includes_vat),
  client_notes:string(row.client_notes,2000),
  price_display_mode:string(row.price_display_mode,35),
  price_display_text:string(row.price_display_text,200),
  show_price_in_quote:row.show_price_in_quote!==false,
  service_description:string(row.service_description,9000),
  pickup_point:string(row.pickup_point,9000),
  standing_time:string(row.standing_time,50),
  on_site_contact_details:publicContact
 };
}
async function readServices(db:any,eventId:string){
 if(typeof db.EventService?.filter!=='function')throw stop('service_reader_unavailable');
 const rows:any[]=[],seen=new Set<string>();
 let offset=0;
 for(let page=0;page<MAX_PAGES;page++){
  const entries=await db.EventService.filter({event_id:eventId},'-created_date',
   PAGE_SIZE,offset,SERVICE_FIELDS);
  if(!Array.isArray(entries)||entries.length>PAGE_SIZE)
   throw stop('invalid_service_page');
  if(!entries.length)return rows;
  for(const row of entries){
   if(!ID.test(row?.id||'')||seen.has(row.id)||row.event_id!==eventId)
    throw stop('client_service_identity_mismatch');
   seen.add(row.id);rows.push(projectClientService(row,eventId));
   if(rows.length>MAX_SERVICES)throw stop('too_many_services');
  }
  // Use actual page size: the SDK may silently lower the requested limit.
  offset+=entries.length;
 }
 throw stop('incomplete_event_services');
}
async function catalogFor(db:any,services:any[]){
 const keys=[...new Set(services.map(row=>row.service_id).filter(x=>ID.test(x)))];
 if(keys.length>MAX_CATALOG)throw stop('too_many_catalog_services');
 if(!db.Service?.get)return [];
 const result:Array<any>=new Array(keys.length);
 let index=0;
 await Promise.all(Array.from({length:Math.min(5,keys.length)},async()=>{
  for(;;){
   const i=index++;
   if(i>=keys.length)break;
   const s=await db.Service.get(keys[i]).catch(()=>null);
   result[i]=s?.id===keys[i]?{
    id:keys[i],service_name:string(s.service_name,180),
    service_description:string(s.service_description,9000),
    category:string(s.category,100)
   }:null;
  }
 }));
 return result.filter(Boolean);
}
export async function readClientEventDetailsFeed(client:any,user:any,eventId:unknown){
 if(typeof eventId!=='string'||!ID.test(eventId))throw stop('invalid_id',400);
 if(!user||user.role==='admin'||user.user_type!=='client'||
  typeof user.email!=='string'||!user.email.trim())throw stop('forbidden',403);
 const db=client?.asServiceRole?.entities;
 if(!db?.Event?.get||!db?.EventService?.filter)throw stop('reader_unavailable');
 const event=await db.Event.get(eventId).catch(()=>null);
 // Deliberately return the same status for missing and unauthorized events.
 if(!event||!canOpenClientEventCard(user,event))throw stop('not_found',404);
 const services=await readServices(db,eventId);
 const catalog=await catalogFor(db,services);
 return {event:clientEventCardProject(event),services,catalog};
}
