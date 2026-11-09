// Friendly, purpose-specific public validation messages. Never soften the
// signed agreement or turn an uncertain payment/send state into a retry prompt.
const errors={
 'הקישור אינו זמין או בוטל':'This link is no longer available. Please ask the office for a new one.',
 'הקישור פג תוקף או שנדרש אימות מחדש':'The link has expired or needs a new verification. The office can help.',
 'מכסת האימות מוצתה. יש לבקש קישור חדש מהמנהל.':'For your security, the verification limit was reached. Please ask the office for a new link.',
 'ניתן לשלוח קוד נוסף לאחר דקה':'You can request another code after one minute.',
 'קוד האימות שגוי':'That code does not look right. Please check and try again.',
 'קוד האימות אינו תקין':'That code does not look right. Please check and try again.',
 'קוד האימות פג תוקף':'The code has expired. You can request a new one.',
 'נדרש אימות מחדש':'Please verify again to continue.',
 'יש למלא את שם החותם':'Please enter the name of the person signing.',
 'נדרשת חתימה מצוירת':'Please add your signature with a finger or mouse.',
 'חתימה לא תקינה':'We could not read that signature. Please sign again.',
 'נדרשת חתימה ברורה':'Please sign again so we can save it clearly.',
 'נדרשת הסכמה לכל הסעיפים':'Please review and accept each applicable clause before signing.',
 'פרטי האירוע השתנו מאז התצוגה; יש לפתוח טיוטה מחדש':'Some event details changed. Please ask the office to refresh the agreement.',
 'ההסכם השתנה; יש לרענן':'The agreement was updated. Please refresh the page.',
 'פעולה בהסכם בטיפול; יש לרענן':'A step is being processed. Please refresh the page before trying again.',
 'הספק דחה את הבקשה':'The payment provider did not accept that request. Please contact the office.',
 'תוצאת יצירת התשלום בבירור; יש לפנות למנהל לפני ניסיון נוסף.':'We are checking the payment-link result. Please contact the office before trying again.',
 'הפקת PDF נכשלה; ניתן לנסות שוב':'The signed PDF is not ready yet. Please try opening it again later.'
};
export function localizeClosingError(value,language='he'){
 const raw=String(value||'').trim();
 if(language!=='en')return raw||'הפעולה לא הושלמה. נשמח לעזור בכל שאלה.';
 if(errors[raw])return errors[raw];
 // Uncertain transport and payment outcomes MUST NOT invite a second send.
 if(/תוצאה אינה ודאית|תוצאת השליחה|נדרש בירור|יש לבדוק.*שליחה|אין לשלוח שוב|תור הודעות|WhatsApp/.test(raw))
  return 'The message or payment result needs checking. Please contact the office before repeating this action.';
 if(/תשלום|סליקה|כרטיס|חיוב|הסכם|אימות|חתימ|טלפון|הקישור|לא תקין|נכשל|נדרש/.test(raw))
  return 'We could not complete that step just yet. Please contact the office and we will be happy to help.';
 return raw||'We could not complete that step. Please get in touch if you need help.';
}
