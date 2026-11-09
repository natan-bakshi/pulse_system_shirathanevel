import {customerMessageDefaults,customerMessageTemplate,formatCustomerMessage} from './customerMessageTone.ts';

// Text frozen into each new agreement. English is enabled only when its legal terms are configured.
export const closingCopy = {
  he: {
    terms: 'קראתי ואני מאשר/ת את פרטי האירוע, הצעת המחיר ותנאי ההתקשרות המפורטים במסמך זה.',
    token: 'הכרטיס נמסר לביטחון בלבד, בדומה לצ׳ק פיקדון, ולא כאמצעי התשלום השוטף לאירוע. הזנת הכרטיס אינה תשלום. פרטי הכרטיס המלאים נשמרים אצל ספק הסליקה ואינם נגישים לשירת הנבל; המשרד מקבל מזהה מאובטח והרשאה לחיוב ידני בלבד במקרים ובתקרות שאישרתם בהסכם, למשל אם תשלום לא הוסדר עד המועד שנקבע. לא מתבצעת גבייה אוטומטית. תשלום מקדמה באשראי, אם תבחרו בו, הוא פעולה נפרדת. אני מאשר/ת שאני בעל/ת הכרטיס או מורשה/ית להשתמש בו, ומסכים/ה לשמירת המזהה ולשימוש בו לפי ההרשאות בהסכם.',
    fee: 'במועד הסכם זה לא מתווספת עמלת סליקה.',
    labels: ['תנאי ההתקשרות והצעת המחיר','כרטיס לביטחון — שמירה אצל ספק הסליקה','גבייה לפי אבני הדרך','חיובים חריגים לפי ההסכם','עמלת סליקה','שינויים מוסכמים בהזמנה'],
    invitation: customerMessageDefaults.invitation.he,
    otp: customerMessageDefaults.otp.he,
    signed: customerMessageDefaults.signed.he
  },
  en: {
    terms: 'I have read and approve the event details, quotation and terms of engagement set out in this document.',
    token: 'The card is provided as security, similar to a security deposit cheque, rather than for routine event payments. Entering the card is not a payment. Full card details are stored by the payment provider and are not accessible to Shirat Hanevel. The office receives a secure identifier and authorization for manual charges only in the circumstances and limits you approve in the agreement, for example if a payment remains unpaid after its due date. There are no automatic charges. Paying a deposit by card, if you choose to do so, is a separate action. I confirm that I am the cardholder or authorized to use the card and consent to storing the identifier and using it under this agreement.',
    fee: 'No processing fee applies at the time of this agreement.',
    labels: ['Terms of engagement and quotation','Security card — stored by the payment provider','Payments by milestones','Exceptional charges under the agreement','Processing fee','Agreed changes to the booking'],
    invitation: customerMessageDefaults.invitation.en,
    otp: customerMessageDefaults.otp.en,
    signed: customerMessageDefaults.signed.en
  }
};
export const agreementLanguage = value => value === 'en' ? 'en' : 'he';
export function renderClosingMessage(config, kind, language, values) {
  const lang = agreementLanguage(language);
  const configured=config?.[`closing_${kind}_template${lang === 'en' ? '_en' : ''}`];
  return formatCustomerMessage(customerMessageTemplate(kind,lang,configured),values);
}
export function localizedAgreement(snapshot, language) {
  const lang = agreementLanguage(language);
  const version = snapshot?.translations?.[lang];
  if (!version) return snapshot;
  return {...snapshot,...version,
   quote_summary:{...snapshot.quote_summary,...version.quote_summary,
    pricing_note:version.pricing_note??version.quote_summary?.pricing_note??snapshot.quote_summary?.pricing_note}};
}