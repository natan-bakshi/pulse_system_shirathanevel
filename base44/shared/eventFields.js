// Shared by event editors and quote renderers. Labels never determine storage.
export const EVENT_TYPE_OPTIONS = [
  {value:'bar_mitzvah',label:'בר מצווה'}, {value:'bat_mitzvah',label:'בת מצווה'},
  {value:'wedding',label:'חתונה'}, {value:'other',label:'אחר'}
];
export const SYSTEM_EVENT_FIELDS = [
  {key:'event_name',name:'שם האירוע',type:'text',category:'event_details',required:true},
  {key:'event_type',name:'סוג האירוע',type:'select',category:'event_details',options:EVENT_TYPE_OPTIONS},
  {key:'event_date',name:'תאריך',type:'date',category:'event_details',required:true},
  {key:'event_time',name:'שעה',type:'time',category:'event_details'},
  {key:'location',name:'מיקום',type:'text',category:'event_details'},
  {key:'concept',name:'קונספט',type:'concept',category:'event_details'},
  {key:'notes',name:'הערות',type:'textarea',category:'event_details'},
  {key:'family_name',name:'שם משפחה',type:'text',category:'organizer_details'},
  {key:'child_name',name:'שם הילד/ה',type:'text',category:'organizer_details'},
  {key:'city',name:'עיר מגורים',type:'text',category:'organizer_details'},
  {key:'guest_count',name:'מספר אורחים',type:'number',category:'organizer_details'},
  {key:'parents',name:'אנשי קשר לאירוע',type:'contacts',category:'contacts'},
  {key:'schedule',name:'לוח זמנים',type:'schedule',category:'schedule'},
  {key:'primary_currency',name:'מטבע האירוע',type:'select',category:'financial',options:[{value:'ILS',label:'₪ שקל'},{value:'USD',label:'$ דולר'}]},
  {key:'services_section_title',name:'כותרת חבילת ההפקה',type:'text',category:'services'},
  {key:'standalone_services_title',name:'כותרת שירותים בודדים',type:'text',category:'services'},
  {key:'external_services_title',name:'כותרת שירותים נוספים',type:'text',category:'services'}
];
export const SYSTEM_FIELDS_BY_KEY = Object.fromEntries(SYSTEM_EVENT_FIELDS.map(f => [f.key,f]));
export function parseObject(value) {
  try { const v=typeof value==='string'?JSON.parse(value):value; return v && typeof v==='object' && !Array.isArray(v)?v:{}; } catch { return {}; }
}
export function parseArray(value) {
  try { const v=typeof value==='string'?JSON.parse(value):value; return Array.isArray(v)?v:[]; } catch { return []; }
}
export function makeSystemField(key,overrides={}) {
  const def=SYSTEM_FIELDS_BY_KEY[key];
  if (!def) throw new Error('Unknown system field: '+key);
  return {...def,id:key,source:'system',system_key:key,...overrides,source:'system',system_key:key,type:def.type,category:def.category,required:def.required || !!overrides.required,options:def.options};
}
export const DEFAULT_EVENT_FIELDS=SYSTEM_EVENT_FIELDS.map(f=>makeSystemField(f.key));
export function systemKey(field) {
  const key=field?.source==='system'?field.system_key:null;
  return SYSTEM_FIELDS_BY_KEY[key]?key:null;
}
export function getEventFields(type) {
  if (type?.event_fields==null || type.event_fields==='') return DEFAULT_EVENT_FIELDS.map(f=>({...f}));
  const fields=parseArray(type.event_fields).map(f=>systemKey(f)?makeSystemField(systemKey(f),f):{...f});
  for(const key of ['event_name','event_date']) if(!fields.some(f=>systemKey(f)===key)) fields.unshift(makeSystemField(key));
  return fields;
}
export function getField(fields,key) { return fields.find(f=>systemKey(f)===key); }
export function readEventField(field,event,custom=parseObject(event?.custom_organizer_fields)) {
  const key=systemKey(field); return key?(event?.[key]??''):(custom[field.id]??'');
}
export function displayEventField(field,event,custom) {
  const value=readEventField(field,event,custom);
  if(systemKey(field)==='event_type') return EVENT_TYPE_OPTIONS.find(o=>o.value===value)?.label || value;
  return value;
}
export function validateEventFields(fields,event,custom) {
  for(const field of fields) {
    const key=systemKey(field), value=readEventField(field,event,custom);
    if(field.required && (value==='' || value==null || (Array.isArray(value) && !value.length) || (typeof value==='string' && !value.trim()))) return `נא למלא ${field.name}`;
    if(value==='' || value==null) continue;
    if(field.type==='number' && (!Number.isFinite(Number(value)) || (key==='guest_count' && (Number(value)<0 || !Number.isInteger(Number(value)))))) return `ערך לא תקין: ${field.name}`;
    if(field.type==='time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return `שעה לא תקינה: ${field.name}`;
    if(field.type==='date' && (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)) return `תאריך לא תקין: ${field.name}`;
    if(key==='event_type' && !EVENT_TYPE_OPTIONS.some(o=>o.value===value)) return 'סוג אירוע לא תקין';
  }
  return '';
}
export function normalizeEventValues(values) {
  const result={...values};
  if(Object.hasOwn(result,'guest_count')) result.guest_count=result.guest_count==='' || result.guest_count==null?0:Number(result.guest_count);
  return result;
}
export function buildQuoteFieldValues(event,organizerType) {
  const vars={...parseObject(event?.custom_organizer_fields)};
  for(const def of SYSTEM_EVENT_FIELDS) if(!['contacts','schedule'].includes(def.type)) vars[def.key]=event?.[def.key]??'';
  for(const field of getEventFields(organizerType)) { const key=systemKey(field); if(key && field.id!==key) vars[field.id]=event?.[key]??''; }
  return vars;
}
export function getEventContacts(event) {
  const parents=parseArray(event?.parents).filter(c=>c && typeof c==='object');
  if(event?.contacts_schema_version===2) return parents;
  return [...parents,...parseArray(event?.organizer_contacts || event?.organizercontacts).filter(c=>c && typeof c==='object').map(c=>({...c,client_access:false}))];
}
export function getClientContacts(event) { return getEventContacts(event).filter(c=>c.client_access!==false); }
export function contactExtraValue(contact,field) { return contact?.custom_fields?.[field.id]??contact?.[field.id]??''; }
export function prepareContacts(contacts) {
  return contacts.filter(c=>c.name || c.phone || c.email || c.role || Object.values(c.custom_fields||{}).some(v=>v!=='' && v!=null)).map(c=>({...c,id:c.id || crypto.randomUUID()}));
}
