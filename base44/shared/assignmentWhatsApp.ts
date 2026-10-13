// Shared, side-effect-free supplier assignment notification renderer.
// This ensures the explicit on-save safety path and the entity workflow use
// the same unique business key for one assignment change.
export function assignmentWhatsAppKey(service:any,supplierId:string,templateType='SUPPLIER_NEW_ASSIGNMENT'){
  return ['assignment',String(service?.id||''),String(supplierId||''),
    String(service?.updated_date||''),templateType].join(':');
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
  return String(template||'').replace(/\{\{?([\w_]+)\}?}/g,
    (match,key)=>Object.prototype.hasOwnProperty.call(vars,key)?vars[key]:match)
    .replace(/~\s*~/g,'').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
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
