// Additive URL-only buttons for EXISTING supplier text notifications.
// No callback, no new Outbox row, no DB read, no scheduled worker and no
// additional Base44 integration. The regular Green send is replaced with
// ONE mixed-URL send in the already claimed central queue worker.
// Generic 'notification' is deliberately excluded: related_supplier_id is
// not sufficient proof of who receives all multi-audience InApp notifications.
// All other message types, groups and Wasender retain ordinary text routing.
import {buildOfficeWhatsAppInquiryLink} from './whatsappOfficeInquiryLink.ts';
import {SUPPLIER_PORTAL_URL} from './supplierPortalLink.ts';
import {GREEN_SUPPLIER_NAVIGATION_SOURCES} from './greenSupplierNavigationPolicy.ts';
import {selectSupplierButtonSnapshot} from './greenSupplierButtonSnapshot.ts';

const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const IDENT=/^[A-Za-z0-9_-]{3,160}$/;
const OFFICE=/^[1-9][0-9]{7,14}$/;
const SOURCES=new Set<string>(GREEN_SUPPLIER_NAVIGATION_SOURCES);
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
 // No new DB read: read the versioned owner policy from the queue control
 // that the worker already holds. Corrupt policies fail closed to old text.
 const policy=selectSupplierButtonSnapshot(control,job);
 if(!policy||(!policy.portal&&!policy.office))return null;
 const body=policy.portal?navigationTextBody(job.message_text):job.message_text;
 if(typeof body!=='string'||!body.trim()||body.length>4096)return null;
 const officeLabel=policy.officeLabel||String(config.officeLabel||'פנייה למשרד');
 const portalLabel=policy.portalLabel||String(config.supplierPortalLabel||'כניסה למערכת');
 if([officeLabel,portalLabel].some(x=>
  !x||x.length>25||x.trim()!==x||/[\x00-\x1f\x7f]/.test(x)))return null;
 const buttons:SupplierNavigationPreview['body']['buttons']=[];
 if(policy.portal)buttons.push({type:'url',buttonId:'open_supplier_portal',
  buttonText:portalLabel,url:SUPPLIER_PORTAL_URL});
 if(policy.office){
  let url:string;
  try{url=buildOfficeWhatsAppInquiryLink({
   officeNumber:config.officeNumber,outboxJobId:job.id,
   messageText:job.message_text,contextMode:'excerpt',
   messageKind:'supplier_notice'
  });}catch{return null;}
  buttons.push({type:'url',buttonId:'contact_office',buttonText:officeLabel,url});
 }
 return {method:'sendInteractiveButtons',kind:'interactive_navigation',
  body:{chatId:job.chat_id,body,buttons},
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
  !Array.isArray(preview.body?.buttons)||
  preview.body.buttons.length<1||preview.body.buttons.length>2)return false;
 const buttons=preview.body.buttons;
 const portal=buttons.find((b:any)=>b?.buttonId==='open_supplier_portal');
 const office=buttons.find((b:any)=>b?.buttonId==='contact_office');
 if(buttons.length!==Number(!!portal)+Number(!!office)||
  (portal&&office&&buttons[0]!==portal)||
  preview.body?.body!==(portal?navigationTextBody(job.message_text):job.message_text))
  return false;
 for(const b of buttons){
  if(!b||b.type!=='url'||
   typeof b.buttonText!=='string'||!b.buttonText||
   b.buttonText.trim()!==b.buttonText||b.buttonText.length>25||
   /[\x00-\x1f\x7f]/.test(b.buttonText))return false;
 }
 if(portal&&portal.url!==SUPPLIER_PORTAL_URL)return false;
 if(!office)return !!portal;
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
