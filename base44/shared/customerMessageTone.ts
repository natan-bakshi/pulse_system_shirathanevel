/**
 * Customer communication tone, separate from immutable signed consent clauses.
 * Only friendly operational templates live here. Never authorizes charges,
 * changes due dates, schedules reminders, or sends any message.
 */
export const customerMessageDefaults = {
 milestone: {
  he: 'שלום {{customer_name}},\nרק תזכורת קטנה מאיתנו לקראת התשלום הקרוב עבור {{event_name}}.\nלפי לוח התשלומים שסיכמנו, נותר לשלב הזה {{amount}} {{currency}}, לתאריך {{due_date}}.\n\nאם כבר העברתם את התשלום, תודה רבה! נשמח לעדכון כדי שנוכל לסמן אצלנו. ואם יש שאלה או צורך בתיאום, אנחנו כאן בשמחה: {{business_phone}}.\nצוות שירת הנבל',
  en: 'Hi {{customer_name}},\nJust a little reminder about the next payment for {{event_name}}.\nAccording to the schedule we agreed on, the remaining amount for this stage is {{amount}} {{currency}}, scheduled for {{due_date}}.\n\nIf you have already taken care of it, thank you! Please let us know so we can update our records. If you have a question or need to coordinate anything, we are here to help: {{business_phone}}.\nThe Shirat HaNevel team'
 },
 payment_link: {
  he: 'שלום {{name}},\nמצרפים קישור נוח ומאובטח להסדרת התשלום עבור {{description}}, בסך {{amount}}:\n{{link}}\n\nאם כבר שילמתם בדרך אחרת, אין צורך לשלם שוב — רק עדכנו אותנו. נשמח לעזור בכל שאלה.\nצוות {{business_name}}',
  en: 'Hi {{name}},\nHere is a convenient, secure link for the payment of {{amount}} for {{description}}:\n{{link}}\n\nIf you have already paid another way, there is no need to pay again — just let us know. We are happy to help with any questions.\nThe {{business_name}} team'
 },
 reminder: {
  he: 'שלום {{name}},\nתזכורת קטנה לגבי קישור התשלום ששלחנו, בסך {{amount}}. הקישור זמין עד {{expiry_date}}:\n{{link}}\n\nאם כבר שילמתם בדרך אחרת, תודה רבה! נשמח לעדכון קצר. אם צריך עזרה או קישור חדש, אנחנו כאן בשמחה.\nצוות {{business_name}}',
  en: 'Hi {{name}},\nJust a little reminder about the payment link we sent for {{amount}}. The link is available until {{expiry_date}}:\n{{link}}\n\nIf you have already paid another way, thank you! Please let us know. If you need a hand or a new link, we are here to help.\nThe {{business_name}} team'
 },
 receipt: {
  he: 'שלום {{name}},\nתודה רבה! התשלום בסך {{amount}} התקבל אצלנו.\nמצרפים את המסמך שלכם:\n{{document_url}}\n\nשמחים להיות חלק מהשמחה שלכם,\nצוות שירת הנבל',
  en: 'Hi {{name}},\nThank you! We have received your payment of {{amount}}.\nHere is your document:\n{{document_url}}\n\nWe are delighted to be part of your celebration.\nThe Shirat HaNevel team'
 },
 invitation: {
  he: 'שלום {{customer_name}},\nשמחים להתקדם יחד לקראת האירוע שלכם!\nריכזנו כאן את פרטי האירוע וההסכם כדי שתוכלו לעבור עליהם בנחת, לשאול אם צריך, וכשתהיו מוכנים — לאשר ולחתום:\n{{link}}\n\nלכל שאלה או תיקון אנחנו כאן בשמחה.\nצוות שירת הנבל',
  en: 'Hi {{customer_name}},\nWe are looking forward to celebrating with you!\nHere are your event details and agreement. Take your time to review everything and, when you are ready, approve and sign:\n{{link}}\n\nIf anything needs clarification or adjusting, we are happy to help.\nThe Shirat HaNevel team'
 },
 otp: {
  he: 'קוד האימות שלכם לצפייה בפרטי האירוע בשירת הנבל: {{code}}.\nהקוד בתוקף ל-10 דקות. כדי לשמור על הפרטיות שלכם, אין לשתף אותו עם אחרים.',
  en: 'Your code to view your Shirat HaNevel event details is {{code}}.\nIt is valid for 10 minutes. To protect your privacy, please do not share it.'
 },
 signed: {
  he: 'שלום {{customer_name}},\nתודה רבה! החתימה שלכם נשמרה, ומצורף עותק ההסכם עבור {{event_name}}.\nאם נותר שלב נוסף להשלמת ההזמנה, תוכלו לראות אותו בטופס. לכל שאלה אנחנו כאן בשמחה.\nצוות שירת הנבל',
  en: 'Hi {{customer_name}},\nThank you! Your signature has been saved, and we have attached a copy of the agreement for {{event_name}}.\nIf any further steps are needed, you can see them in the form. We are happy to help with any questions.\nThe Shirat HaNevel team'
 }
} as const;

// Exact historical defaults, which were automatically saved as milestone
// templates on existing events. Do not overwrite any operator-written message.
export const legacyMilestoneTemplates = [
 'שלום {{customer_name}}, בהתאם להסכם עבור האירוע {{event_name}}, סכום של {{amount}} {{currency}} מיועד לתשלום עד {{due_date}}. ניתן להעביר תשלום באמצעי חלופי עד המועד. אם לא יתקבל, שירת הנבל רשאית לבצע חיוב ידני בכרטיס השמור בהתאם להרשאה שעליה חתמת. עמלת סליקה, ככל שתחול, תתווסף לפי ההסכם. לשאלות: {{business_phone}}.',
 'Hello {{customer_name}}, for the event {{event_name}}, {{amount}} {{currency}} is due by {{due_date}}. You may pay by another method by then; otherwise Shirat Hanevel may charge the saved card manually under your signed authorization. Any applicable processing fee will be added under the agreement. Questions: {{business_phone}}.'
] as const;
export function customerMessageTemplate(kind:keyof typeof customerMessageDefaults,
 language:unknown,configured:unknown=''):string{
 const lang=language==='en'?'en':'he';
 const value=typeof configured==='string'?configured.trim():'';
 if(!value || (kind==='milestone'&&legacyMilestoneTemplates.includes(value as any)))
  return customerMessageDefaults[kind][lang];
 // A saved Hebrew template must never leak into an English message when
 // notification language is changed. The opposite direction also matters.
 const withoutPlaceholders=value.replace(/\{\{[^{}]+\}\}/g,'');
 if(lang==='en'&&/[\u0590-\u05ff]/.test(withoutPlaceholders))
  return customerMessageDefaults[kind].en;
 return value; // Preserve deliberate customized copy.
}
export function formatCustomerMessage(template:unknown,values:Record<string,unknown>={}):string{
 return String(template||'').replace(/\{\{([a-z_]+)\}\}/g,
  (_whole,key)=>String(values[key]??''));
}
export function customerBusinessName(config:Record<string,unknown>,language:unknown):string{
 const name=String(config?.business_name||config?.company_name||'').trim();
 if(language!=='en')return name||'שירת הנבל';
 const english=String(config?.business_name_en||config?.company_name_en||'').trim();
 return english||(!/[\u0590-\u05ff]/.test(name)&&name?name:'Shirat HaNevel');
}
