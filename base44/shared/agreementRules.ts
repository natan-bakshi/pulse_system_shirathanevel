// Pure, shared business rules. Never performs a charge.
export const closingDefaults = {
 closing_regular_multiplier:"1", closing_exceptional_multiplier:"2",
 closing_reminder_enabled:"true", closing_reminder_days:"3", closing_reminder_time:"09:00",
 closing_send_copy:"true", closing_notify_admin:"true", closing_exceptional_notice:"true", closing_exceptional_notice_days:"3",
 closing_token_required:"true", closing_deposit_required:"true",
 closing_regular_text:"אני מאשר/ת לשירת הנבל לחייב ידנית את הכרטיס שמסרתי עבור תשלומי האירוע בהתאם לאבני הדרך ולתקרת החיוב המפורטות במסמך, אם לא התקבל תשלום באמצעי חלופי עד מועד התשלום. לא תתבצע סליקה אוטומטית.",
 closing_exceptional_text:"אני מאשר/ת חיוב ידני בכרטיס עבור נזק או חיוב חריג שאני חב/ה בו לפי הסכם ההתקשרות, עד לתקרה המפורטת במסמך. תינתן לי אפשרות לשלם באמצעי חלופי בהתאם למדיניות ההודעה המפורטת כאן.",
 closing_changes_text:"שינוי בשירותים או במחיר שביקשתי או אישרתי במפורש בערוץ מתועד יצורף להזמנה ולהסכם. כל שינוי יתועד עם תוכנו, מחירו, מועדו וזהות המאשר. שינוי מהותי בתקרת חיוב או בהרשאת השימוש בכרטיס יובא לאישורי המפורש; הסכמה זו אינה הרשאה לשינוי חד-צדדי.",
 closing_message_template:"שלום {{customer_name}}, בהתאם להסכם עבור האירוע {{event_name}}, סכום של {{amount}} {{currency}} מיועד לתשלום עד {{due_date}}. ניתן להעביר תשלום באמצעי חלופי עד המועד. אם לא יתקבל, שירת הנבל רשאית לבצע חיוב ידני בכרטיס השמור בהתאם להרשאה שעליה חתמת. עמלת סליקה, ככל שתחול, תתווסף לפי ההסכם. לשאלות: {{business_phone}}.",
 closing_form_language:"he", closing_message_language:"he", closing_terms_text:"", closing_terms_text_en:"",
 closing_regular_text_en:"I authorize Shirat Hanevel to charge the card I provide manually for event payments according to the milestones and limits in this agreement if I have not paid by another method by the due date. No automatic charges will be made.",
 closing_exceptional_text_en:"I authorize manual card charges for damage or exceptional amounts I owe under this agreement, up to the specified limit. I may use an alternative payment method subject to the notice terms here.",
 closing_changes_text_en:"Changes to services or pricing that I explicitly request or approve through a documented channel will be recorded with the details, price, time and approver. A material change to card authorization or its limit requires my express consent.",
 closing_message_template_en:"Hello {{customer_name}}, for the event {{event_name}}, {{amount}} {{currency}} is due by {{due_date}}. You may pay by another method by then; otherwise Shirat Hanevel may charge the saved card manually under your signed authorization. Any applicable processing fee will be added under the agreement. Questions: {{business_phone}}.",
 closing_invitation_template:"", closing_invitation_template_en:"", closing_otp_template:"", closing_otp_template_en:"", closing_signed_template:"", closing_signed_template_en:""
 };
export const roundMoney = n => Math.round(Number(n)*100)/100;
export const cleanText=(s,n=10000)=>String(s??"").trim().slice(0,n);
export function canonical(value) {
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 if(value && typeof value==="object")return "{"+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
 return JSON.stringify(value);
}
export async function digest(value) {
 const bytes=typeof value==="string"?new TextEncoder().encode(value):value;
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
}
export function firstCompletedPayment(payments, currency, rate=3.6) {
 const rows=payments.filter(p=>p.charge_type!=="exceptional"&&(!p.agreement_id||p.agreement_verified)&&(!p.payment_status||p.payment_status==="completed")&&Number(p.amount)>0)
  .sort((a,b)=>String(a.payment_date||a.created_date||"").localeCompare(String(b.payment_date||b.created_date||""))||String(a.created_date||"").localeCompare(String(b.created_date||"")));
 const p=rows[0];if(!p)return 0;
 const amount=Number(p.converted_amount)>0&&p.currency!==currency?Number(p.converted_amount):p.currency===currency||!p.currency?Number(p.amount):p.currency==="USD"&&currency==="ILS"?Number(p.amount)*rate:p.currency==="ILS"&&currency==="USD"?Number(p.amount)/rate:0;
 return roundMoney(amount);
}
export function defaultMilestones(total,deposit,eventDate,today=new Date().toISOString().slice(0,10),language="he") {
 const date=new Date(eventDate+"T12:00:00Z"); if(!Number.isFinite(date.getTime()))throw new Error("תאריך אירוע לא תקין");
 const before=new Date(date.getTime()-7*86400000).toISOString().slice(0,10);
 const half=roundMoney((total-deposit)/2);
 return [
 {label:language==="en"?"Deposit at event confirmation":"מקדמה בסגירת האירוע",amount:deposit,due_date:today},
 {label:language==="en"?"50% of balance — one week before event":"50% מהיתרה — שבוע לפני האירוע",amount:half,due_date:before<today?today:before},
 {label:language==="en"?"Remaining balance — on event day":"מלוא היתרה — ביום האירוע",amount:roundMoney(total-deposit-half),due_date:eventDate<today?today:eventDate}
 ];
}
export function validateMilestones(rows,total) {
 if(!Array.isArray(rows)||!rows.length||rows.length>12)throw new Error("יש להגדיר 1–12 אבני דרך");
 let cumulative=0,previous="";
 const result=rows.map((m,i)=>{
 const amount=roundMoney(m.amount),date=String(m.due_date||"");
 if(!Number.isFinite(amount)||amount<0||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<previous)throw new Error("סכום או סדר תאריכי אבני הדרך אינו תקין");
 previous=date;cumulative=roundMoney(cumulative+amount);
 return {position:i,label:cleanText(m.label,150)||"תשלום "+(i+1),amount,due_date:date,cumulative_amount:cumulative};
 });
 if(Math.abs(cumulative-total)>0.01)throw new Error("סכום אבני הדרך חייב להיות שווה למחיר האירוע");
 return result;
}
export function milestoneState(m,paid,now=new Date().toISOString().slice(0,10)) {
 return paid+0.005>=m.cumulative_amount?"paid":m.due_date<now?"overdue":"pending";
}
export function canClose({signed,requireToken,token,requireDeposit,depositPaid,active=true}) {
 return !!(active&&signed&&(!requireToken||token)&&(!requireDeposit||depositPaid));
}
export function formatMessage(template,values) {
 return String(template).replace(/\{\{([a-z_]+)\}\}/g,(_,k)=>String(values[k]??""));
}
export function assertChargePermission({snapshot,accepted,kind,amount,paid,exceptionalPaid=0,milestone,now=new Date().toISOString().slice(0,10)}) {
 if(!accepted?.token||!accepted?.[kind==="exceptional"?"exceptional":"regular"])throw new Error("אין הרשאה חתומה מתאימה לשימוש בכרטיס");
 if(!Number.isFinite(amount)||amount<=0)throw new Error("סכום לא תקין");
 if(kind==="exceptional") {
   if(amount+exceptionalPaid>snapshot.exceptional_cap+0.005)throw new Error("הסכום חורג מתקרת החיוב החריג החתומה");
 } else {
   if(!milestone||milestone.due_date>now)throw new Error("טרם הגיע מועד אבן הדרך שנבחרה");
   const paidSinceAgreement=Math.max(0,paid-Number(snapshot.regular_cap_paid_offset||0));
   if(amount+paid>Math.min(snapshot.total,milestone.cumulative_amount)+0.005||amount+paidSinceAgreement>snapshot.regular_cap+0.005)throw new Error("הסכום חורג מהיתרה המותרת לפי אבן הדרך והתקרה החתומה");
 }
}