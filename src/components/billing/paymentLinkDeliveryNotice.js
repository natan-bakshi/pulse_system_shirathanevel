// Shared UI copy for link creation vs queue acceptance vs provider receipt.
// This cannot claim WhatsApp delivery because no delivered webhook exists.
export function paymentLinkDeliveryNotice(result,lang='he'){
 const he=lang!=='en';
 const review=!!result?.manual_review_required;
 const queued=(result?.queuedVia||[]).includes('whatsapp');
 const accepted=(result?.sentVia||[]).includes('whatsapp');
 const emailed=(result?.sentVia||[]).includes('email');
 const partial=(result?.failures||[]).length>0;
 if(review)return {
  tone:'warning',
  title:he?'קישור התשלום נוצר — הודעת WhatsApp בבירור':'Payment link created — WhatsApp status uncertain',
  body:he?'אין אישור שההודעה נקלטה בתור או נשלחה. בדוק את תור WhatsApp לפני ניסיון חוזר.':
    'WhatsApp queue acceptance or delivery is not confirmed. Review the WhatsApp queue before retrying.'
 };
 if(queued)return {
  tone:'neutral',
  title:he?'קישור התשלום נשמר בתור WhatsApp':'Payment link queued for WhatsApp',
  body:he?'ההודעה ממתינה לאישור ספק WhatsApp. טרם אומתה מסירה ללקוח.':
    'The provider has not yet accepted the message. Recipient delivery is not confirmed.'
 };
 if(accepted)return {
  tone:'neutral',
  title:he?'הספק אישר את הודעת התשלום':'Payment message accepted by provider',
  body:he?'התקבל אישור מספק WhatsApp, אך מסירה ללקוח עדיין לא אומתה.':
    'The WhatsApp provider accepted the message. Recipient delivery is not verified.'
 };
 if(partial)return {
  tone:'warning',
  title:he?'קישור התשלום נוצר — חלק מערוצי השליחה נכשלו':'Payment link created — some channels failed',
  body:he?(emailed?'האימייל נשלח, אך יש לבדוק את ערוצי השליחה האחרים.':'יש לבדוק את שגיאות השליחה; אפשר להעתיק את הקישור ללקוח.'):
    (emailed?'Email was sent; review the other delivery channels.':'Review delivery errors or copy the link manually.')
 };
 if(emailed)return {
  tone:'neutral',
  title:he?'קישור התשלום נשלח באימייל':'Payment link sent by email',
  body:he?'האימייל נשלח לספק הדואר. יש לוודא שהלקוח קיבל אותו.':
    'The email was submitted. Recipient delivery is not verified.'
 };
 return {
  tone:'warning',
  title:he?'קישור התשלום נוצר':'Payment link created',
  body:he?'לא קיים אישור לשליחת הודעה ללקוח. אפשר להעתיק את הקישור.':
    'No message dispatch has been confirmed. You can copy the link.'
 };
}
