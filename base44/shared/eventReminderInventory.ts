// Supplier/admin event-reminder inventory, scoped to only events near their
// template due dates. This avoids SDK's default first-page truncation and
// avoids fetching years of EventService records on each daily run.
// READ ONLY: loading this inventory never queues, sends or mutates anything.
import {readAll} from './eventReadiness.ts';

export function israelDay(value:Date):string{
 const tokens=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(value);
 const part=(name:string)=>tokens.find(x=>x.type===name)?.value||'';
 return [part('year'),part('month'),part('day')].join('-');
}
export function dayShift(date:string,offset:number):string{
 const base=new Date(date+'T12:00:00Z');
 if(!Number.isFinite(base.getTime()))throw Error('Invalid Israel reminder day');
 base.setUTCDate(base.getUTCDate()+offset);
 return base.toISOString().slice(0,10);
}
export function reminderLookaheadDays(templates:any[]):number{
 let max=1;
 for(const t of templates||[]){
  if(!t)continue;
  const value=Number(t.timing_value??1);
  if(!Number.isFinite(value)||value<0)throw Error('Invalid event reminder lead time');
  const unit=t.timing_unit||'days';
  const factor:{[key:string]:number}={minutes:1/1440,hours:1/24,days:1,weeks:7,months:31};
  if(!(unit in factor))throw Error('Unsupported event reminder lead unit');
  const lead=Math.ceil(value*factor[unit])+1;
  if(lead>366)throw Error('Event reminder lookahead too large; check template settings');
  max=Math.max(max,lead);
 }
 return max;
}
export function reminderInventoryDateRange(now:Date,templates:any[]){
 const today=israelDay(now);
 return {
  from:dayShift(today,-1),
  through:dayShift(today,reminderLookaheadDays(templates))
 };
}
function chunks<T>(values:T[],size:number):T[][]{
 const out:T[][]=[];
 for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));
 return out;
}
export async function loadEventReminderInventory(
 client:any,now:Date,templates:any[],suppliersAlreadyLoaded?:any[]
){
 const window=reminderInventoryDateRange(now,templates);
 const events=await readAll(client.entities.Event,{
  event_date:{$gte:window.from,$lte:window.through}
 });
 const eligibleEvents=events.filter((e:any)=>e?.id&&e?.event_date&&e.status!=='cancelled');
 const eventIds=eligibleEvents.map((e:any)=>e.id);
 const services:any[]=[],notifications:any[]=[];
 for(const batch of chunks(eventIds,40)){
  // The first 50 EventService rows may be wholly unrelated to tomorrow.
  // The per-event index must always be built from every matching service.
  const [s,n]=await Promise.all([
   readAll(client.entities.EventService,{event_id:{$in:batch}}),
   readAll(client.entities.InAppNotification,{
    related_event_id:{$in:batch},is_resolved:false,
    template_type:{$in:['SUPPLIER_EVENT_REMINDER','ADMIN_EVENT_REMINDER']}
   })
  ]);
  services.push(...s);notifications.push(...n);
 }
 const suppliers=suppliersAlreadyLoaded||await readAll(client.entities.Supplier);
 return {events:eligibleEvents,services,suppliers,notifications,window};
}
