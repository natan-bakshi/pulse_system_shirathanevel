// P0: private, authenticated client dashboard projection. Never pass a
// client-selected event ID into the read boundary. Only the signed-in user's
// creator/contact entitlement can select events. Finance summaries are
// calculated here from the user's OWN events; no raw Event, EventService,
// Payment, AppSettings or client contact rows are emitted to the browser.
import {canOpenClientEventCard} from './clientEventLinkAccess.ts';
import {getClientContacts} from './eventFields.js';
import {getEventDisplayName} from './eventName.ts';

const BATCH=200,MAX_PAGES=30,MAX_EVENTS=120;
const ID=/^[A-Za-z0-9_-]{3,100}$/;
const scanFields=[
 'id','created_by','event_name','family_name','child_name','event_date',
 'event_time','location','guest_count','status','contacts_schema_version',
 'parents','organizer_contacts','custom_organizer_fields',
 'all_inclusive','all_inclusive_price','all_inclusive_includes_vat',
 'discount_amount'
];
const serviceFields=[
 'id','event_id','is_external','custom_price','quantity','includes_vat'
];
const paymentFields=['id','event_id','amount','payment_status'];
const error=(reason:string,status=503)=>
 Object.assign(new Error(reason),{status,code:reason});
const short=(value:any,max=150)=>typeof value==='string'?value.slice(0,max):'';
const money=(value:any)=>{
 const n=typeof value==='number'?value:Number(value);
 return Number.isFinite(n)?n:0;
};
function eligibleUser(user:any){
 return user&&typeof user.email==='string'&&user.email.trim().length>3&&
  (user.role==='admin'||user.user_type==='client');
}
export function clientDashboardEventAllowed(user:any,event:any){
 if(!eligibleUser(user)||!event||!ID.test(event.id||''))return false;
 if(user.role!=='admin')return canOpenClientEventCard(user,event);
 // Preserve the ClientDashboard rule for an administrator opening their own
 // client-view: only their own creator/contact events, NOT all admin events.
 const email=user.email.trim().toLowerCase();
 return String(event.created_by||'').trim().toLowerCase()===email||
  getClientContacts(event).some((contact:any)=>
   String(contact.email||'').trim().toLowerCase()===email);
}
export function clientDashboardFinancialSummary(event:any,services:any[],
 payments:any[],vatRate:number){
 const vat=Number.isFinite(vatRate)&&vatRate>0&&vatRate<1?vatRate:0.18;
 let beforeTax=0;
 if(event.all_inclusive&&money(event.all_inclusive_price)){
  beforeTax=money(event.all_inclusive_price);
  if(event.all_inclusive_includes_vat)beforeTax/=(1+vat);
 }else{
  for(const row of services){
   if(row.is_external)continue;
   const cost=money(row.custom_price)*(money(row.quantity)||1);
   beforeTax+=row.includes_vat?cost/(1+vat):cost;
  }
 }
 const discount=money(event.discount_amount);
 const finalTotal=beforeTax*(1+vat)-discount;
 const totalPaid=payments.filter(p=>p.payment_status==='completed')
  .reduce((sum,p)=>sum+money(p.amount),0);
 return {
  finalTotal,totalPaid,balance:finalTotal-totalPaid,
  progress:finalTotal>0?(totalPaid/finalTotal)*100:0,
  discount_amount:discount
 };
}
async function listEvents(db:any){
 if(typeof db?.Event?.filter!=='function')throw error('client_feed_event_reader_unavailable');
 const rows:any[]=[],seen=new Set<string>();
 let offset=0;
 for(let i=0;i<MAX_PAGES;i++){
  const page=await db.Event.filter({},'-created_date',BATCH,offset,scanFields);
  if(!Array.isArray(page)||page.length>BATCH)throw error('client_feed_invalid_page');
  for(const row of page){
   if(!ID.test(row?.id||'')||seen.has(row.id))throw error('client_feed_duplicate_event');
   rows.push(row);seen.add(row.id);
  }
  // Never assume the provider honors our requested page limit exactly.
  if(page.length===0)return rows;
  offset+=page.length;
 }
 throw error('client_feed_event_scan_limit');
}
async function mapLimited<T,U>(items:T[],fn:(item:T)=>Promise<U>,max=5):Promise<U[]>{
 const result:U[]=Array(items.length);
 let index=0;
 await Promise.all(Array.from({length:Math.min(items.length,max)},async()=>{
  for(;;){const i=index++;if(i>=items.length)break;result[i]=await fn(items[i]);}
 }));
 return result;
}
async function scopedFinancialRows(db:any,kind:'EventService'|'Payment',
 eventId:string,fields:string[]){
 const rows:any[]=[],ids=new Set<string>();
 let offset=0;
 for(let i=0;i<15;i++){
  const part=await db[kind].filter({event_id:eventId},'-created_date',
   500,offset,fields);
  if(!Array.isArray(part)||part.length>500)
   throw error('client_feed_incomplete_finance');
  if(part.length===0)return rows;
  for(const row of part){
   if(!ID.test(row?.id||'')||row.event_id!==eventId||
    ids.has(row.id))throw error('client_feed_finance_identity_mismatch');
   ids.add(row.id);rows.push(row);
  }
  if(rows.length>500)throw error('client_feed_incomplete_finance');
  offset+=part.length;
 }
 throw error('client_feed_finance_scan_limit');
}
export async function readClientDashboardFeed(client:any,user:any){
 if(!eligibleUser(user))throw error('client_feed_forbidden',403);
 const db=client?.asServiceRole?.entities;
 if(!db?.EventService?.filter||!db?.Payment?.filter||!db?.AppSettings?.filter)
  throw error('client_feed_storage_unavailable');
 const allEvents=await listEvents(db);
 const visible=allEvents.filter(event=>clientDashboardEventAllowed(user,event));
 if(visible.length>MAX_EVENTS)throw error('client_feed_too_many_events');
 const config=await db.AppSettings.filter({setting_key:'vat_rate'},
  '-created_date',2,0,['setting_key','setting_value']);
 if(!Array.isArray(config))throw error('client_feed_vat_unavailable');
 const candidate=Number(config[0]?.setting_value)/100;
 const vatRate=Number.isFinite(candidate)&&candidate>0&&candidate<1?candidate:0.18;
 const projected=await mapLimited(visible,async event=>{
  // These database queries are scoped by an event ID selected ONLY after
  // authenticated server-side membership is established, never by the client.
  const [services,payments]=await Promise.all([
   scopedFinancialRows(db,'EventService',event.id,serviceFields),
   scopedFinancialRows(db,'Payment',event.id,paymentFields)
  ]);
  const totals=clientDashboardFinancialSummary(event,services,payments,vatRate);
  return {
   id:event.id,
   event_name:short(event.event_name||getEventDisplayName(event),140),
   family_name:short(event.family_name,100),
   child_name:short(event.child_name,100),
   event_date:short(event.event_date,40),
   event_time:short(event.event_time,40),
   location:short(event.location,180),
   guest_count:money(event.guest_count),
   status:short(event.status,40),
   ...totals
  };
 });
 return {events:projected.sort((a,b)=>
  String(b.event_date).localeCompare(String(a.event_date)))};
}
