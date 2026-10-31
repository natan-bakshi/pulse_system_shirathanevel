// Immutable URL-only button layout captured at durable enqueue for a
// real supplier NotificationTemplate. Never accept the snapshot from the
// client or from an incoming WhatsApp event. Does NOT authorize replies.
// Per-source legacy jobs lacking a snapshot keep their existing behavior.
import {isSafeTemplateId,supplierButtonsForProvenance}
 from './greenSupplierTemplateButtonsPolicy.ts';
import {GREEN_SUPPLIER_NAVIGATION_SOURCES,
 type NavigationButtons} from './greenSupplierNavigationPolicy.ts';

export const SUPPLIER_BUTTON_SNAPSHOT_FIELD='supplier_buttons_snapshot_json';
const MAX=550;
const IDENT=/^[A-Za-z0-9_-]{3,160}$/;
const SCOPE=new Set<string>(GREEN_SUPPLIER_NAVIGATION_SOURCES);
const LABEL=/^[^\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]{0,25}$/u;
function parse(raw:any){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  Object.keys(raw).sort().join(',')!=='buttons,sourceType,templateId,version'||
  raw.version!==1||!SCOPE.has(raw.sourceType)||!isSafeTemplateId(raw.templateId))
  return null;
 const b=raw.buttons;
 if(!b||typeof b!=='object'||Array.isArray(b)||
  Object.keys(b).sort().join(',')!=='office,officeLabel,portal,portalLabel'||
  typeof b.portal!=='boolean'||typeof b.office!=='boolean'||
  typeof b.portalLabel!=='string'||typeof b.officeLabel!=='string'||
  !LABEL.test(b.portalLabel)||!LABEL.test(b.officeLabel)||
  b.portalLabel.trim()!==b.portalLabel||b.officeLabel.trim()!==b.officeLabel)
  return null;
 return {
  sourceType:raw.sourceType as string,templateId:raw.templateId as string,
  buttons:{portal:b.portal,office:b.office,
   portalLabel:b.portalLabel,officeLabel:b.officeLabel} as NavigationButtons
 };
}
export function captureSupplierButtonSnapshot(control:any,context:any):string{
 if(!context||!SCOPE.has(context.sourceType)||
  !isSafeTemplateId(context.notificationTemplateId)||
  !IDENT.test(context.supplierId||''))return '';
 const selection=supplierButtonsForProvenance(
  control,context.sourceType,context.notificationTemplateId);
 if(!selection)return '';
 const json=JSON.stringify({version:1,sourceType:context.sourceType,
  templateId:context.notificationTemplateId,buttons:selection});
 if(json.length>MAX)return '';
 return json;
}
export function selectSupplierButtonSnapshot(control:any,job:any):NavigationButtons|null{
 const stored=job?.[SUPPLIER_BUTTON_SNAPSHOT_FIELD];
 if(stored!=null&&stored!==''){
  if(typeof stored!=='string'||stored.length>MAX)return null;
  let candidate:any;
  try{candidate=JSON.parse(stored);}catch{return null;}
  const normalized=parse(candidate);
  if(!normalized||
   normalized.sourceType!==job.source_type||
   normalized.templateId!==job.notification_template_id)return null;
  return normalized.buttons;
 }
 // Jobs predating frozen snapshots retain the previous per-source settings.
 // The optional per-template override can only act on a stored provenance ID.
 return supplierButtonsForProvenance(control,job?.source_type,job?.notification_template_id);
}
