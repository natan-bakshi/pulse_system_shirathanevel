// Production-only, owner-configurable URL button layouts for EXISTING Green
// supplier text notifications. No new business callbacks, chat targets,
// consumers, providers, message kinds or background workers are created here.
// Absent policy preserves the current two-button live behavior exactly.
// Corrupt/unsupported saved policy fails closed to the ORIGINAL plain text.
export const GREEN_SUPPLIER_NAVIGATION_SOURCES=Object.freeze([
 'event_reminder','supplier_pending_reminder','scheduled_template','manual_trigger'
] as const);
type Source=(typeof GREEN_SUPPLIER_NAVIGATION_SOURCES)[number];
export type NavigationButtons={
 portal:boolean;office:boolean;portalLabel:string;officeLabel:string
};
export type SupplierNavigationGreenPolicy={
 schemaVersion:1;companyId:'shirat_hanevel';provider:'green';
 version:number;sources:Record<Source,NavigationButtons>
};
export const SUPPLIER_NAVIGATION_FIELD='interactive_supplier_navigation_green_policy_json';
const COMPANY='shirat_hanevel';
const MAX_JSON=3072;
const SOURCE=new Set<string>(GREEN_SUPPLIER_NAVIGATION_SOURCES);
const LABEL=/^[^\u0000-\u001f\u007f]{0,25}$/u;
function fail(message:string):never{throw Object.assign(
 new Error('Invalid supplier WhatsApp navigation: '+message),{status:400}
);}
function buttons(raw:any):NavigationButtons{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  Object.keys(raw).sort().join(',')!=='office,officeLabel,portal,portalLabel'||
  typeof raw.office!=='boolean'||typeof raw.portal!=='boolean'||
  typeof raw.officeLabel!=='string'||typeof raw.portalLabel!=='string'||
  !LABEL.test(raw.officeLabel)||!LABEL.test(raw.portalLabel)||
  raw.officeLabel.trim()!==raw.officeLabel||
  raw.portalLabel.trim()!==raw.portalLabel)
  fail('button_configuration');
 return {portal:raw.portal,office:raw.office,
  portalLabel:raw.portalLabel,officeLabel:raw.officeLabel};
}
export function defaultSupplierNavigationGreenPolicy():SupplierNavigationGreenPolicy{
 const sources={} as Record<Source,NavigationButtons>;
 for(const source of GREEN_SUPPLIER_NAVIGATION_SOURCES)
  sources[source]={portal:true,office:true,portalLabel:'',officeLabel:''};
 return {schemaVersion:1,companyId:COMPANY,provider:'green',version:1,sources};
}
export function normalizeSupplierNavigationGreenPolicy(raw:any):SupplierNavigationGreenPolicy{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  Object.keys(raw).sort().join(',')!=='companyId,provider,schemaVersion,sources,version'||
  raw.schemaVersion!==1||raw.companyId!==COMPANY||raw.provider!=='green'||
  !Number.isSafeInteger(raw.version)||raw.version<1||raw.version>2147483647||
  !raw.sources||typeof raw.sources!=='object'||Array.isArray(raw.sources)||
  Object.keys(raw.sources).length!==GREEN_SUPPLIER_NAVIGATION_SOURCES.length||
  Object.keys(raw.sources).some(x=>!SOURCE.has(x)))fail('scope');
 const sources={} as Record<Source,NavigationButtons>;
 for(const source of GREEN_SUPPLIER_NAVIGATION_SOURCES)
  sources[source]=buttons(raw.sources[source]);
 const normalized={schemaVersion:1 as const,companyId:COMPANY as const,
  provider:'green' as const,version:raw.version,sources};
 if(JSON.stringify(normalized).length>MAX_JSON)fail('oversized');
 return normalized;
}
export function parseSupplierNavigationGreenPolicy(control:any):{
 setting:SupplierNavigationGreenPolicy;configured:boolean;corrupt:boolean
}{
 const raw=control?.[SUPPLIER_NAVIGATION_FIELD];
 if(raw==null||raw==='')return {
  setting:defaultSupplierNavigationGreenPolicy(),configured:false,corrupt:false
 };
 if(typeof raw!=='string'||raw.length>MAX_JSON)return {
  setting:defaultSupplierNavigationGreenPolicy(),configured:true,corrupt:true
 };
 try{
  return {setting:normalizeSupplierNavigationGreenPolicy(JSON.parse(raw)),
   configured:true,corrupt:false};
 }catch{return {setting:defaultSupplierNavigationGreenPolicy(),
  configured:true,corrupt:true};}
}
// Called from the already-read WhatsAppQueueControl within the central worker.
// Empty array explicitly means no buttons -> the same original text is sent.
// Returning null means stored policy is corrupt and MUST fail closed.
export function supplierNavigationButtonsForSource(control:any,source:unknown):
 NavigationButtons|null{
 if(typeof source!=='string'||!SOURCE.has(source))return null;
 const stored=parseSupplierNavigationGreenPolicy(control);
 if(stored.corrupt)return null;
 return stored.setting.sources[source as Source];
}
export async function saveSupplierNavigationGreenPolicy(client:any,input:any){
 const current=await client.asServiceRole.entities.WhatsAppQueueControl.filter({
  control_key:'global'
 },'-created_date',2);
 if(!Array.isArray(current)||current.length!==1||!current[0]?.id)
  throw Object.assign(Error('Queue configuration unavailable'),{status:503});
 const row=current[0],prior=parseSupplierNavigationGreenPolicy(row);
 if(prior.corrupt)throw Object.assign(Error('Saved navigation policy needs owner review'),{status:409});
 if(!Number.isSafeInteger(input?.expectedVersion)||input.expectedVersion!==prior.setting.version)
  throw Object.assign(Error('Navigation policy changed: refresh'),{status:409});
 // The request cannot change company/provider/version or the owner production
 // switch; the server builds those fields independently.
 const validated=normalizeSupplierNavigationGreenPolicy({
  schemaVersion:1,companyId:COMPANY,provider:'green',
  version:prior.setting.version+1,sources:input.sources
 });
 const value=JSON.stringify(validated);
 const previous=row[SUPPLIER_NAVIGATION_FIELD]??null;
 const update=await client.asServiceRole.entities.WhatsAppQueueControl.updateMany({
  id:row.id,control_key:'global',[SUPPLIER_NAVIGATION_FIELD]:previous
 },{$set:{[SUPPLIER_NAVIGATION_FIELD]:value}});
 if(update?.updated!==1)
  throw Object.assign(Error('Navigation policy changed concurrently: refresh'),{status:409});
 return {setting:validated,configured:true,corrupt:false};
}
