// Pure opt-in office inquiry composer for a FUTURE approved Green API URL
// button. No provider, database or network calls. A wa.me link opens an
// editable DRAFT in a separate office chat; it cannot create a native reply
// bubble referencing a message in a different conversation.
// NEVER accept user-provided chat text as a supplier status transition.
// Default mode is 'none': existing production/offline payload unchanged.
const PHONE=/^[1-9][0-9]{7,14}$/;
const REF=/^[A-Za-z0-9_-]{3,128}$/;
const MAX_LINK=1800;
export type OfficeContextMode='none'|'reference'|'excerpt';
const error=(code:string)=>Object.assign(new Error(code),{code});
function shortSafeExcerpt(message:string):string{
 if(typeof message!=='string'||!message.trim())return '';
 // Remove URLs, visible e-mail addresses, and phone-like runs. The office
 // already has the full original assignment in Pulse; this is context only.
 const redacted=message
  .replace(/(?:https?:\/\/|www\.)\S+/gi,'[קישור הוסר]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[כתובת הוסרה]')
  // Preserve human event dates (15.11.2026), not phone-like sequences.
  .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g,m=>
    /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}$/.test(m.trim())?m:'[טלפון הוסר]')
  .replace(/[\u0000-\u001f\u007f]+/g,' ')
  .replace(/\s+/g,' ').trim();
 // Never echo the entire original template, signed URLs or phone numbers.
 return [...redacted].slice(0,300).join('');
}
export function buildOfficeWhatsAppInquiryLink(input:{
 officeNumber:string;outboxJobId?:string;messageText?:string;
 contextMode?:OfficeContextMode;
 messageKind?:'assignment'|'supplier_notice'
}):string{
 const number=input?.officeNumber;
 if(typeof number!=='string'||!PHONE.test(number))throw error('office_number_invalid');
 const base='https://wa.me/'+number;
 const mode=input.contextMode??'none';
 if(mode==='none')return base;
 if(!['reference','excerpt'].includes(mode))throw error('office_context_mode_invalid');
 if(!REF.test(input.outboxJobId||''))throw error('office_context_reference_invalid');
 const intro=input.messageKind==='supplier_notice'
  ?'שלום, יש לי שאלה לגבי הודעה שקיבלתי.'
  :'שלום, יש לי שאלה לגבי הודעת השיבוץ.';
 let text=intro+'\n'+'אסמכתא: '+input.outboxJobId;
 if(mode==='excerpt'){
  const excerpt=shortSafeExcerpt(input.messageText||'');
  if(excerpt){
   const lead='\nפרטי האירוע והשיבוץ: ';
   const tail='\nהשאלה שלי: ';
   // The URL is HIDDEN inside the native button, but WhatsApp still has a
   // provider URL-size limit. Fit as much of the actual event message as the
   // budget permits, without introducing a redirect, DB read or shortener.
   const safe=[...excerpt];let lo=0,hi=safe.length;
   while(lo<hi){
    const mid=Math.ceil((lo+hi)/2);
    if((base+'?text='+encodeURIComponent(text+lead+safe.slice(0,mid).join('')+tail)).length<=MAX_LINK)
     lo=mid;else hi=mid-1;
   }
   if(lo>0)text+=lead+safe.slice(0,lo).join('');
  }
 }
 text+='\nהשאלה שלי: ';
 const url=base+'?text='+encodeURIComponent(text);
 if(url.length>MAX_LINK)throw error('office_context_url_too_long');
 return url;
}
