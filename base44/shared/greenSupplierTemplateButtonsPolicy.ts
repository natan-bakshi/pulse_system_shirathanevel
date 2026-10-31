// Per-NotificationTemplate overrides for the existing owner-managed Green
// supplier URL buttons. No new business callbacks, provider credentials,
// customer/admin recipient paths, cron, or per-message database reads.
import {normalizeSupplierNavigationGreenPolicy,
 defaultSupplierNavigationGreenPolicy,
 supplierNavigationButtonsForSource,
 GREEN_SUPPLIER_NAVIGATION_SOURCES,
 type NavigationButtons} from './greenSupplierNavigationPolicy.ts';

export const SUPPLIER_TEMPLATE_NAVIGATION_FIELD='interactive_supplier_template_buttons_green_json';
const COMPANY='shirat_hanevel';
const ID=/^[A-Za-z0-9_-]{12,64}$/;
const LABEL=/^[^\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]{0,25}$/u;
const MAX_KEYS=80;
const MAX_JSON=12000;
export type TemplateButtonPolicy={
 schemaVersion:1;companyId:typeof COMPANY;provider:'green';version:number;
 templates:Record<string,NavigationButtons>
};
const error=(reason:string,status=400)=>Object.assign(
 new Error('Supplier template button settings: '+reason),{status});
export const isSafeTemplateId=(id:unknown):id is string=>
 typeof id==='string'&&ID.test(id);
export function isSupportedSupplierButtonTemplate(record:any):boolean{
 if(!record||!isSafeTemplateId(record.id)||
  typeof record.type!=='string'||
  !Array.isArray(record.allowed_channels)||!record.allowed_channels.includes('whatsapp')||
  !Array.isArray(record.target_audiences)||!record.target_audiences.includes('supplier'))
  return false;
 if(['SUPPLIER_EVENT_REMINDER','SUPPLIER_PENDING_REMINDER'].includes(record.type))return true;
 if(['SUPPLIER_NEW_ASSIGNMENT','SUPPLIER_ASSIGNMENT_UPDATE','CANCEL_SUPPLIER'].includes(record.type))return false;
 return ['scheduled_check','manual'].includes(record.trigger_type);
}
export function defaultSupplierTemplateButtonPolicy():TemplateButtonPolicy{
 return {schemaVersion:1,companyId:COMPANY,provider:'green',version:1,templates:{}};
}
function normalizeButtons(value:any):NavigationButtons{
 if(!value||typeof value!=='object'||Array.isArray(value)||
  Object.keys(value).sort().join(',')!=='office,officeLabel,portal,portalLabel'||
  typeof value.portal!=='boolean'||typeof value.office!=='boolean'||
  typeof value.portalLabel!=='string'||typeof value.officeLabel!=='string'||
  !LABEL.test(value.portalLabel)||!LABEL.test(value.officeLabel)||
  value.portalLabel.trim()!==value.portalLabel||
  value.officeLabel.trim()!==value.officeLabel)
  throw error('invalid_buttons');
 return {portal:value.portal,office:value.office,
  portalLabel:value.portalLabel,officeLabel:value.officeLabel};
}
export function normalizeSupplierTemplateButtonPolicy(raw:any):TemplateButtonPolicy{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  Object.keys(raw).sort().join(',')!=='companyId,provider,schemaVersion,templates,version'||
  raw.schemaVersion!==1||raw.companyId!==COMPANY||raw.provider!=='green'||
  !Number.isSafeInteger(raw.version)||raw.version<1||raw.version>2147483647||
  !raw.templates||typeof raw.templates!=='object'||Array.isArray(raw.templates)||
  Object.keys(raw.templates).length>MAX_KEYS)
  throw error('invalid_policy_scope');
 const templates:Record<string,NavigationButtons>={};
 for(const id of Object.keys(raw.templates).sort()){
  if(!isSafeTemplateId(id))throw error('invalid_template_id');
  templates[id]=normalizeButtons(raw.templates[id]);
 }
 const result:TemplateButtonPolicy={
  schemaVersion:1,companyId:COMPANY,provider:'green',version:raw.version,templates
 };
 if(JSON.stringify(result).length>MAX_JSON)throw error('oversized_policy');
 return result;
}
export function parseSupplierTemplateButtonPolicy(control:any):{
 setting:TemplateButtonPolicy;configured:boolean;corrupt:boolean
}{
 const raw=control?.[SUPPLIER_TEMPLATE_NAVIGATION_FIELD];
 if(raw==null||raw==='')return {
  setting:defaultSupplierTemplateButtonPolicy(),configured:false,corrupt:false
 };
 if(typeof raw!=='string'||raw.length>MAX_JSON)return {
  setting:defaultSupplierTemplateButtonPolicy(),configured:true,corrupt:true
 };
 try{return {
  setting:normalizeSupplierTemplateButtonPolicy(JSON.parse(raw)),
  configured:true,corrupt:false
 };}catch{return {
  setting:defaultSupplierTemplateButtonPolicy(),configured:true,corrupt:true
 };}
}
// Used by the worker with the QueueControl row it ALREADY HAS.
// Invalid owner policy fails closed to text; absent or unknown template ID
// falls back to exactly the source-level settings that shipped previously.
export function supplierButtonsForProvenance(control:any,source:unknown,templateId:unknown):
 NavigationButtons|null{
 if(!GREEN_SUPPLIER_NAVIGATION_SOURCES.includes(source as any))return null;
 const baseline=supplierNavigationButtonsForSource(control,source);
 if(!baseline)return null;
 const parsed=parseSupplierTemplateButtonPolicy(control);
 if(parsed.corrupt)return null;
 if(!isSafeTemplateId(templateId))return baseline;
 return parsed.setting.templates[templateId]||baseline;
}
export async function saveSupplierTemplateButtonPolicy(client:any,input:any){
 const db=client.asServiceRole.entities;
 const list=await db.WhatsAppQueueControl.filter({control_key:'global'},'-created_date',2);
 if(!Array.isArray(list)||list.length!==1||!list[0]?.id)
  throw error('global_control_missing',503);
 const control=list[0],prior=parseSupplierTemplateButtonPolicy(control);
 if(prior.corrupt)throw error('saved_policy_corrupt',409);
 if(!Number.isSafeInteger(input?.expectedVersion)||
  input.expectedVersion!==prior.setting.version)
  throw error('version_conflict',409);
 const next=normalizeSupplierTemplateButtonPolicy({
  schemaVersion:1,companyId:COMPANY,provider:'green',
  version:prior.setting.version+1,templates:input.templates
 });
 // Verify template identities against real current templates on owner SAVE
 // ONLY. Never trust an arbitrary URL, label action, tenant or numeric ID.
 // Avoid an extra DB query for every dispatched WhatsApp message.
 if(Object.keys(next.templates).length){
  const all=await db.NotificationTemplate.list();
  if(!Array.isArray(all))throw error('template_registry_unavailable',503);
  const eligible=new Set(all.filter(isSupportedSupplierButtonTemplate).map(x=>x.id));
  if(Object.keys(next.templates).some(id=>!eligible.has(id)))
   throw error('template_not_supplier_whatsapp_eligible',400);
 }
 const before=control[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]??null;
 const updated=await db.WhatsAppQueueControl.updateMany({
  id:control.id,control_key:'global',[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]:before
 },{$set:{[SUPPLIER_TEMPLATE_NAVIGATION_FIELD]:JSON.stringify(next)}});
 if(updated?.updated!==1)throw error('version_race',409);
 return {setting:next,configured:true,corrupt:false};
}
