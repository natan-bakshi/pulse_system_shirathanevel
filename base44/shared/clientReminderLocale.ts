/**
 * Explicit, per-event recipient communication language for the still-disabled
 * legacy CLIENT_PAYMENT_REMINDER template.
 *
 * This is intentionally independent of the authenticated operator's
 * preferred_language, the quote's language, and the legally signed agreement.
 * It NEVER activates a notification, schedules a send, or creates a payment.
 */

const HEBREW=/[\u0590-\u05ff]/u;
const TOKEN=/\{\{([a-z_]+)\}\}/g;

export const reviewedClientPaymentReminderEnglish=Object.freeze({
 title_template_en:'A little reminder about {{event_name}}',
 body_template_en:'Hello,\nJust a small reminder about {{event_name}} on {{event_date}}. According to our records, the remaining balance is {{balance}} NIS.\n\nIf you have already taken care of it, thank you! Please let us know so we can update our records. We are happy to help with any questions.\nThe Shirat HaNevel team',
 whatsapp_body_template_en:'Hello,\nJust a little reminder about {{event_name}} on {{event_date}}. According to our records, the remaining balance is {{balance}} NIS.\n\nIf you have already paid, thank you! Please let us know so we can update our records. If you have any questions, we are here to help.\nThe Shirat HaNevel team'
});

export function clientNoticeLocale(event:any):'he'|'en'{
 return event?.client_notice_language==='en'?'en':'he';
}
function placeholders(text:unknown):string[]{
 return [...String(text||'').matchAll(TOKEN)].map(m=>m[1]).sort();
}
function samePlaceholders(a:unknown,b:unknown):boolean{
 return JSON.stringify(placeholders(a))===JSON.stringify(placeholders(b));
}

export function selectClientPaymentReminderCopy(
 template:any,event:any
):{ready:true;language:'he'|'en';title:string;body:string;whatsapp:string}|
   {ready:false;language:'en';reason:'english_copy_missing'|'english_copy_unreviewed'|'placeholder_mismatch'}{
 const language=clientNoticeLocale(event);
 if(language==='he'){
  return {ready:true,language,title:String(template?.title_template||''),
   body:String(template?.body_template||''),
   whatsapp:String(template?.whatsapp_body_template||template?.body_template||'')};
 }
 const title=String(template?.title_template_en||'').trim();
 const body=String(template?.body_template_en||'').trim();
 const whatsapp=String(template?.whatsapp_body_template_en||'').trim();
 const whatsappEnabled=(template?.allowed_channels||[]).includes('whatsapp');
 if(!title||!body||(whatsappEnabled&&!whatsapp))
  return {ready:false,language,reason:'english_copy_missing'};
 if(HEBREW.test(title)||HEBREW.test(body)||(whatsappEnabled&&HEBREW.test(whatsapp)))
  return {ready:false,language,reason:'english_copy_unreviewed'};
 if(!samePlaceholders(template?.title_template,title)||
    !samePlaceholders(template?.body_template,body)||
    (whatsappEnabled&&!samePlaceholders(
      template?.whatsapp_body_template||template?.body_template,whatsapp)))
  return {ready:false,language,reason:'placeholder_mismatch'};
 return {ready:true,language,title,body,
  whatsapp:whatsappEnabled?whatsapp:(whatsapp||body)};
}
