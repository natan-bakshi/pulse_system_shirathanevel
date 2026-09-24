import { base44 } from "@/api/base44Client";
export const agreementError=e=>e.response?.data?.error||e.message||"הפעולה לא הושלמה";
export async function agreementAction(action,body={}) {
 const {data}=await base44.functions.invoke("eventAgreement",{...body,action});
 if(data?.error)throw new Error(data.error);
 return data;
}
export const agreementLabels={draft:"טיוטה",issued:"קישור הופק",signed:"נחתם",completed:"הנוהל הושלם",cancelled:"בוטל",pending:"ממתין",verified:"אומת",paid:"שולם",ready:"מוכן",failed:"נכשל",unknown:"בבירור",accepted:"התקבל אצל ספק הוואטסאפ",dispatching:"שליחה בבירור",disabled:"כבוי",not_signed:"טרם נחתם",overdue:"באיחור"};
export const statusLabel=s=>agreementLabels[s]||s||"—";
