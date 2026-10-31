// Server-owned, non-business WhatsApp URL actions for Green supplier
// NotificationTemplates. No custom callbacks, code execution, or new
// provider/database calls. The exact choices are frozen at enqueue.
import {PULSE_ORIGIN} from './notificationValidation.ts';
import {SUPPLIER_PORTAL_URL} from './supplierPortalLink.ts';
import {buildOfficeWhatsAppInquiryLink} from './whatsappOfficeInquiryLink.ts';

export const GREEN_CUSTOM_LINK_KINDS=Object.freeze([
 'supplier_calendar','supplier_dashboard','event_details',
 'notification_settings','office','external'
] as const);
export type GreenCustomLinkKind=(typeof GREEN_CUSTOM_LINK_KINDS)[number];
export type GreenCustomLink={kind:GreenCustomLinkKind;label:string;url:string};
const KIND=new Set<string>(GREEN_CUSTOM_LINK_KINDS);
const LABEL=/^[^\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]{1,25}$/u;
const SAFE_EVENT=/^[A-Za-z0-9_-]{3,100}$/;
const HAS_EVENT=new Set(['event_reminder','scheduled_template']);
const MAX_URL=600;
const fail=(reason:string):never=>{throw Object.assign(
 Error('Invalid custom WhatsApp button: '+reason),{status:400});};

// Only public HTTPS destinations. In particular, do NOT allow internal IPs,
// localhost, credentials, protocol-relative links or URL scheme smuggling.
// No outbound HTTP request is made to validate a link.
export function normalizePublicWhatsAppUrl(value:unknown):string{
 if(typeof value!=='string'||value.length<12||value.length>MAX_URL||
  value!==value.trim()||/[\\\s\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)||
  /%(?:0[ad]|1[cf]|7f)/i.test(value)||!/^https:\/\//i.test(value))
  fail('https_url_required');
 let url:URL;
 try{url=new URL(value);}catch{fail('invalid_url');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||!!url.username||!!url.password||
  !!url.port||!host.includes('.')||host.endsWith('.')||
  host.startsWith('[')||/^[0-9.]+$/.test(host)||
  /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)||
  !/^[a-z0-9.-]+$/.test(host))
  fail('public_https_only');
 if(url.href.length>MAX_URL)fail('url_too_long');
 return url.href;
}
export function normalizeCustomLink(raw:any):GreenCustomLink{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  Object.keys(raw).sort().join(',')!=='kind,label,url'||
  !KIND.has(raw.kind)||typeof raw.label!=='string'||
  !LABEL.test(raw.label)||raw.label!==raw.label.trim()||
  typeof raw.url!=='string')fail('button_fields');
 return {
  kind:raw.kind,label:raw.label,
  url:raw.kind==='external'?normalizePublicWhatsAppUrl(raw.url):
   raw.url===''?'':fail('url_only_for_external')
 };
}
export function normalizeCustomLinks(raw:any):GreenCustomLink[]{
 if(!Array.isArray(raw)||raw.length>3)
  fail('too_many_url_buttons');
 const result=raw.map(normalizeCustomLink);
 if(result.filter(x=>x.kind==='office').length>1)
  fail('duplicate_office_button');
 return result;
}
export function customLinkNeedsEvent(kind:string):boolean{
 return kind==='event_details';
}
export function customLinkDestination(button:GreenCustomLink,job:any,
 officeNumber?:string):string|null{
 try{
  switch(button.kind){
   case 'supplier_calendar':return SUPPLIER_PORTAL_URL;
   case 'supplier_dashboard':return PULSE_ORIGIN+'/SupplierDashboard';
   case 'notification_settings':return PULSE_ORIGIN+'/MyNotificationSettings';
   case 'event_details':
    return HAS_EVENT.has(job?.source_type)&&SAFE_EVENT.test(job?.source_id||'')?
     PULSE_ORIGIN+'/EventDetails?id='+encodeURIComponent(job.source_id):null;
   case 'external':return normalizePublicWhatsAppUrl(button.url);
   case 'office':
    return officeNumber?buildOfficeWhatsAppInquiryLink({
     officeNumber,outboxJobId:job.id,messageText:job.message_text,
     contextMode:'excerpt',messageKind:'supplier_notice'
    }):null;
   default:return null;
  }
 }catch{return null;}
}
export function isSafeOfficeLinkForJob(urlValue:unknown,job:any):boolean{
 if(typeof urlValue!=='string'||urlValue.length>1800)return false;
 try{
  const link=new URL(urlValue);
  if(link.protocol!=='https:'||link.host!=='wa.me'||
   link.username||link.password||link.hash||
   !/^\/[1-9][0-9]{7,14}$/.test(link.pathname)||
   [...link.searchParams.keys()].join(',')!=='text')return false;
  const draft=link.searchParams.get('text')||'';
  return draft.length<400&&draft.includes('אסמכתא: '+job.id)&&
   draft.includes('שלום, יש לי שאלה לגבי הודעה שקיבלתי.');
 }catch{return false;}
}
// Verify the original Outbox snapshot, NOT user-editable message text,
// before a final transport call. The destination cannot be replaced between
// queue preparation and Green's sendInteractiveButtons request.
export function verifyCustomLinkRows(rows:any[],links:GreenCustomLink[],
 job:any):boolean{
 if(!Array.isArray(rows)||rows.length!==links.length)return false;
 return links.every((link,index)=>{
  const b=rows[index];
  if(!b||b.type!=='url'||b.buttonId!=='custom_link_'+(index+1)||
   b.buttonText!==link.label)return false;
  return link.kind==='office'?
   isSafeOfficeLinkForJob(b.url,job):
   b.url===customLinkDestination(link,job);
 });
}
