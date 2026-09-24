// Pure, shared business rules. Never performs a charge.
export const closingDefaults = {
 closing_regular_multiplier:"1", closing_exceptional_multiplier:"2",
 closing_reminder_enabled:"true", closing_reminder_days:"3", closing_reminder_time:"09:00",
 closing_send_copy:"true", closing_notify_admin:"true", closing_exceptional_notice:"true", closing_exceptional_notice_days:"3",
 closing_token_required:"true", closing_deposit_required:"true",
 closing_regular_text:"אני מאשר/ת לשירת הנבל לחייב ידנית את הכרטיס שמסרתי עבור תשלומי האירוע בהתאם לאבני הדרך ולתקרת החיוב המפורטות במסמך, אם לא התקבל תשלום באמצעי חלופי עד מועד התשלום. לא תתבצע סליקה אוטומטית.",
 closing_exceptional_text:"אני מאשר/ת חיוב ידני בכרטיס עבור נזק או חיוב חריג שאני חב/ה בו לפי הסכם ההתקשרות, עד לתקרה המפורטת במסמך. תינתן לי אפשרות לשלם באמצעי חלופי בהתאם למדיניות ההודעה המפורטת כאן.",
 closing_changes_text:"שינוי בשירותים או במחיר שביקשתי או אישרתי במפורש בערוץ מתועד יצורף להזמנה ולהסכם. כל שינוי יתועד עם תוכנו, מחירו, מועדו וזהות המאשר. שינוי מהותי בתקרת חיוב או בהרשאת השימוש בכרטיס יובא לאישורי המפורש; הסכמה זו אינה הרשאה לשינוי חד-צדדי.",
 closing_message_template:"שלום {{customer_name}}, בהתאם להסכם עבור האירוע {{event_name}}, סכום של {{amount}} {{currency}} מיועד לתשלום עד {{due_date}}. ניתן להעביר תשלום באמצעי חלופי עד המועד. אם לא יתקבל, שירת הנבל רשאית לבצע חיוב ידני בכרטיס השמור בהתאם להרשאה שעליה חתמת. עמלת סליקה, ככל שתחול, תתווסף לפי ההסכם. לשאלות: {{business_phone}}."
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
export function defaultMilestones(total,deposit,eventDate,today=new Date().toISOString().slice(0,10)) {
 const date=new Date(eventDate+"T12:00:00Z"); if(!Number.isFinite(date.getTime()))throw new Error("תאריך אירוע לא תקין");
 const before=new Date(date.getTime()-7*86400000).toISOString().slice(0,10);
 const half=roundMoney((total-deposit)/2);
 return [
 {label:"מקדמה בסגירת האירוע",amount:deposit,due_date:today},
 {label:"50% מהיתרה — שבוע לפני האירוע",amount:half,due_date:before<today?today:before},
 {label:"מלוא היתרה — ביום האירוע",amount:roundMoney(total-deposit-half),due_date:eventDate<today?today:eventDate}
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
   if(amount+paid>Math.min(snapshot.total,snapshot.regular_cap,milestone.cumulative_amount)+0.005)throw new Error("הסכום חורג מהיתרה המותרת לפי אבן הדרך והתקרה החתומה");
 }
}
