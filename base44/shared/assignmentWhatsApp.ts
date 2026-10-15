// Shared, side-effect-free supplier assignment notification renderer.
// This ensures the explicit on-save safety path and the entity workflow use
// the same unique business key for one assignment change.
export function assignmentWhatsAppKey(service:any,supplierId:string,templateType='SUPPLIER_NEW_ASSIGNMENT'){
  return ['assignment',String(service?.id||''),String(supplierId||''),
    String(service?.updated_date||''),templateType].join(':');
}
// One canonical queue context for both the entity-workflow producer and
// explicit assignment safeguard. A quiet-hours deferral remains an Outbox
// available_at timestamp, NOT a separate PendingPushNotification with a
// different idempotency key (which could later duplicate the same request).
export function assignmentWhatsAppContext(service:any,supplierId:string,templateType='SUPPLIER_NEW_ASSIGNMENT',delay:any=null){
  return {
    sourceType:'assignment_new',sourceId:String(service?.id||''),
    eventServiceId:String(service?.id||''),supplierId:String(supplierId||''),
    idempotencyKey:assignmentWhatsAppKey(service,supplierId,templateType),
    ...(delay?.shouldDelay && delay?.scheduledFor && Number.isFinite(new Date(delay.scheduledFor).getTime())
      ? {availableAt:new Date(delay.scheduledFor).toISOString()} : {})
  };
}
export function addedSupplierIds(previous:any,next:any){
  const parse=(value:any):string[]=>{
    if(Array.isArray(value))return value.filter(x=>typeof x==='string');
    try{const items=JSON.parse(String(value||'[]'));return Array.isArray(items)?items.filter(x=>typeof x==='string'):[];}
    catch{return [];}
  };
  const was=new Set(parse(previous)),now=parse(next);
  return [...new Set(now.filter(id=>!was.has(id)))];
}
const field=(object:any,...names:string[])=>{
  for(const name of names)if(object?.[name]!==undefined&&object?.[name]!==null)return object[name];
  return '';
};
const formatDate=(value:any)=>{
  if(!value)return '';
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return String(value);
  return '\u200e'+String(d.getUTCDate()).padStart(2,'0')+'/'+
    String(d.getUTCMonth()+1).padStart(2,'0')+'/'+d.getUTCFullYear();
};
// Assignment templates sometimes include "בשעה {{event_time}}" even when no
// time is known. Strip only that dangling phrase; never fabricate an hour or
// alter a message whose time is populated.
export function cleanMissingAssignmentTime(message:string,hasTime:boolean):string{
  if(hasTime)return String(message||'');
  return String(message||'').replace(/\s+בשעה\s*:?\s*(?=[.!?,\n]|$)/g,'').trim();
}
export function renderAssignmentWhatsApp(template:string,event:any,service:any,supplier:any,serviceName=''){
  const notes=(()=>{
    try{
      const raw=service?.supplier_notes||'{}';
      return typeof raw==='string'?JSON.parse(raw):(raw||{});
    }catch{return {};}
  })();
  const note=String(notes?.[supplier?.id]||'').trim();
  const name=field(supplier,'contact_person','supplier_name','suppliername');
  const date=formatDate(field(event,'event_date','eventdate'));
  const time=field(service,'supplier_arrival_time','supplierarrivaltime')||field(event,'event_time','eventtime');
  const vars:Record<string,string>={
    supplier_name:String(name),suppliername:String(name),
    service_name:String(serviceName||field(service,'service_name','servicename')),
    servicename:String(serviceName||field(service,'service_name','servicename')),
    event_name:String(field(event,'event_name','eventname')),eventname:String(field(event,'event_name','eventname')),
    family_name:String(field(event,'family_name','familyname')||field(event,'event_name','eventname')),
    familyname:String(field(event,'family_name','familyname')||field(event,'event_name','eventname')),
    event_date:date,eventdate:date,event_time:String(time),eventtime:String(time),
    event_location:String(field(event,'location')),eventlocation:String(field(event,'location')),
    event_id:String(event?.id||''),supplier_note:note?'📝 הערה עבורך: '+note:'',
    supplier_phone:String(field(supplier,'phone'))
  };
  const rendered=String(template||'').replace(/\{\{?([\w_]+)\}?}/g,
    (match,key)=>Object.prototype.hasOwnProperty.call(vars,key)?vars[key]:match)
    .replace(/~\s*~/g,'').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
  return cleanMissingAssignmentTime(rendered,Boolean(time));
}
export function supplierTargetChatId(supplier:any,toChatId:(phone:string)=>string){
  const preferred=String(supplier?.preferred_channel||'phone');
  const groupRaw=String(supplier?.whatsapp_group_url||'').trim();
  if(preferred==='group'){
    const match=groupRaw.match(/[A-Za-z0-9_-]+@g\.us/);
    if(match)return match[0];
    if(/^[0-9-]{8,}$/.test(groupRaw))return groupRaw+'@g.us';
  }
  return toChatId(String(supplier?.phone||''));
}
