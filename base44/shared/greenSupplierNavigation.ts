// Additive URL-only buttons for EXISTING supplier text notifications.
// No callback, no new Outbox row, no DB read, no scheduled worker and no
// additional Base44 integration. The regular Green send is replaced with
// ONE mixed-URL send in the already claimed central queue worker.
// Generic 'notification' is deliberately excluded: related_supplier_id is
// not sufficient proof of who receives all multi-audience InApp notifications.
// All other message types, groups and Wasender retain ordinary text routing.
import {buildOfficeWhatsAppInquiryLink} from './whatsappOfficeInquiryLink.ts';
import {SUPPLIER_PORTAL_URL} from './supplierPortalLink.ts';

const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const IDENT=/^[A-Za-z0-9_-]{3,160}$/;
const OFFICE=/^[1-9][0-9]{7,14}$/;
const SOURCES=new Set([
 'event_reminder','supplier_pending_reminder','scheduled_template',
 'manual_trigger'
]);
const PORTAL_TRAILER='\n\n📅 לצפייה בלוח האירועים שלך ב־Pulse:\n'+SUPPLIER_PORTAL_URL;
export const isSupplierNavigationSource=(source:unknown):boolean=>
 typeof source==='string'&&SOURCES.has(source);
export function navigationTextBody(messageText:string){
 if(typeof messageText!=='string'||!messageText.trim()||messageText.length>4096)
  return null;
 // SupplierPortalLink already appends the exact canonical URL to ordinary
 // messages. URL-button conversion removes only its OWN known trailer,
 // without modifying the durable Outbox source or arbitrary template links.
 const text=messageText.endsWith(PORTAL_TRAILER)?
  messageText.slice(0,-PORTAL_TRAILER.length):messageText;
 return text.trim()?text:null;
}
export type SupplierNavigationPreview={
 method:'sendInteractiveButtons';kind:'interactive_navigation';
 body:{
  chatId:string;body:string;buttons:Array<{
   type:'url';buttonId:string;buttonText:string;url:string
  }>
 };fallbackReason:'';providerRequestsMade:0
};
export function previewGreenSupplierNavigation(input:{
 job:any;provider:string;control:any;config:any
}):SupplierNavigationPreview|null{
 const {job,provider,control,config}=input||{} as any;
 if(!job||!isSupplierNavigationSource(job.source_type)||
  !IDENT.test(job.id||'')||!IDENT.test(job.supplier_id||'')||
  !['queued','retry_wait'].includes(job.status)||
  job.message_type!=='text'||job.requested_provider!=='green'||
  provider!=='green'||!PRIVATE.test(job.chat_id||'')||
  !!job.sender_account_id||!!job.interactive_button_bindings_json||
  !!job.assignment_revision||
  control?.interactive_assignment_production_enabled!==true||
  control?.interactive_outbound_live_enabled!==true||
  control?.enabled!==true||control?.paused===true||
  config?.enabled!==true||config?.legacyProductionApproved!==true||
  config?.accountCapabilityVerified!==true||
  config?.capability!=='mixed_url'||
  !OFFICE.test(config.officeNumber||''))
  return null;
 const body=navigationTextBody(job.message_text);
 if(!body)return null;
 const officeLabel=String(config.officeLabel||'פנייה למשרד');
 const portalLabel=String(config.supplierPortalLabel||'כניסה למערכת');
 if([officeLabel,portalLabel].some(x=>
  !x||x.length>25||x.trim()!==x||/[\x00-\x1f\x7f]/.test(x)))return null;
 let url:string;
 try{
  url=buildOfficeWhatsAppInquiryLink({
   officeNumber:config.officeNumber,outboxJobId:job.id,
   messageText:job.message_text,contextMode:'excerpt',
   messageKind:'supplier_notice'
  });
 }catch{return null;}
 return {method:'sendInteractiveButtons',kind:'interactive_navigation',
  body:{chatId:job.chat_id,body,buttons:[
   {type:'url',buttonId:'open_supplier_portal',buttonText:portalLabel,
    url:SUPPLIER_PORTAL_URL},
   {type:'url',buttonId:'contact_office',buttonText:officeLabel,url}
  ]},
  fallbackReason:'',providerRequestsMade:0};
}
// Transport independently validates payload/recipient even if a future worker
// incorrectly passes an arbitrary preview to it. No recipient or forwarding
// host can be injected via a supplier note, template or admin setting.
export function verifiedSupplierNavigationTransport(job:any,provider:string,preview:any){
 if(provider!=='green'||!job||!preview||
  !isSupplierNavigationSource(job.source_type)||
  job.message_type!=='text'||job.requested_provider!=='green'||
  job.status!=='sending'||!IDENT.test(job.id||'')||
  !IDENT.test(job.supplier_id||'')||
  !PRIVATE.test(job.chat_id||'')||
  preview.kind!=='interactive_navigation'||
  preview.method!=='sendInteractiveButtons'||
  preview.body?.chatId!==job.chat_id||
  preview.body?.body!==navigationTextBody(job.message_text)||
  !Array.isArray(preview.body?.buttons)||
  preview.body.buttons.length!==2)return false;
 const [portal,office]=preview.body.buttons;
 if(!portal||!office||portal.type!=='url'||office.type!=='url'||
  portal.buttonId!=='open_supplier_portal'||
  office.buttonId!=='contact_office'||
  portal.url!==SUPPLIER_PORTAL_URL)return false;
 for(const b of [portal,office]){
  if(typeof b.buttonText!=='string'||!b.buttonText||
   b.buttonText.trim()!==b.buttonText||b.buttonText.length>25||
   /[\x00-\x1f\x7f]/.test(b.buttonText))return false;
 }
 try{
  const link=new URL(office.url);
  if(link.protocol!=='https:'||link.host!=='wa.me'||
   link.username||link.password||link.hash||
   !/^\/[1-9][0-9]{7,14}$/.test(link.pathname)||
   [...link.searchParams.keys()].join(',')!=='text')return false;
  const draft=link.searchParams.get('text')||'';
  return draft.length<400&&
   draft.includes('אסמכתא: '+job.id)&&
   draft.includes('שלום, יש לי שאלה לגבי הודעה שקיבלתי.');
 }catch{return false;}
}
