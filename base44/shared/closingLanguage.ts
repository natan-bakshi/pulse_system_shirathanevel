// Text frozen into each new agreement. English is enabled only when its legal terms are configured.
export const closingCopy = {
  he: {
    terms: 'קראתי ואני מאשר/ת את פרטי האירוע, הצעת המחיר ותנאי ההתקשרות המפורטים במסמך זה.',
    token: 'ככל שאמסור כרטיס, אני בעל/ת הכרטיס או מורשה/ית להשתמש בו, ומאשר/ת שמירת מזהה מאובטח של הכרטיס אצל ספק הסליקה ושימוש בו בהתאם להרשאות המפורטות כאן.',
    fee: 'במועד הסכם זה לא מתווספת עמלת סליקה.',
    labels: ['תנאי ההתקשרות והצעת המחיר','שמירת כרטיס ושימוש בטוקן','גבייה לפי אבני הדרך','חיובים חריגים לפי ההסכם','עמלת סליקה','שינויים מוסכמים בהזמנה'],
    invitation: 'שלום {{customer_name}}, לאישור פרטי האירוע, חתימה והשלמת נוהל הסגירה עם שירת הנבל:\n{{link}}',
    otp: 'קוד האימות שלך לחתימת הסכם עם שירת הנבל: {{code}}. הקוד בתוקף ל-10 דקות. אין להעביר אותו לאחרים.',
    signed: 'עותק ההסכם החתום עבור {{event_name}}'
  },
  en: {
    terms: 'I have read and approve the event details, quotation and terms of engagement set out in this document.',
    token: 'If I provide a card, I am the cardholder or authorized to use it and consent to the secure storage of a card token by the payment provider and its use under the authorizations in this agreement.',
    fee: 'No processing fee applies at the time of this agreement.',
    labels: ['Terms of engagement and quotation','Card storage and token use','Payments by milestones','Exceptional charges under the agreement','Processing fee','Agreed changes to the booking'],
    invitation: 'Hello {{customer_name}}, please review your event details, sign and complete the closing steps with Shirat Hanevel:\n{{link}}',
    otp: 'Your verification code for signing your agreement with Shirat Hanevel is {{code}}. It expires in 10 minutes. Do not share it.',
    signed: 'Signed agreement for {{event_name}}'
  }
};
export const agreementLanguage = value => value === 'en' ? 'en' : 'he';
export function renderClosingMessage(config, kind, language, values) {
  const lang = agreementLanguage(language);
  const template = config?.[`closing_${kind}_template${lang === 'en' ? '_en' : ''}`] || closingCopy[lang][kind];
  return String(template).replace(/\{\{([a-z_]+)\}\}/g, (_, key) => String(values[key] ?? ''));
}
export function localizedAgreement(snapshot, language) {
  const lang = agreementLanguage(language);
  const version = snapshot?.translations?.[lang];
  if (!version) return snapshot;
  return {...snapshot, ...version, quote_summary: {...snapshot.quote_summary, pricing_note: version.pricing_note ?? snapshot.quote_summary?.pricing_note}};
}