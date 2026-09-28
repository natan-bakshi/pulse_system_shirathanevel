import { base44 } from "@/api/base44Client";
export const agreementError=e=>e.response?.data?.error||e.message||"הפעולה לא הושלמה";
export async function agreementAction(action,body={}) {
 const {data}=await base44.functions.invoke("eventAgreement",{...body,action});
 if(data?.error)throw new Error(data.error);
 return data;
}
export const agreementLabels={draft:"טיוטה",issued:"קישור הופק",signed:"נחתם",completed:"הנוהל הושלם",cancelled:"בוטל",pending:"ממתין",verified:"אומת",paid:"שולם",waived:"לא נדרשת",ready:"מוכן",failed:"נכשל",unknown:"בבירור",accepted:"התקבל אצל ספק הוואטסאפ",dispatching:"שליחה בבירור",disabled:"כבוי",not_signed:"טרם נחתם",overdue:"באיחור"};
export const agreementLabelsEn={draft:"Draft",issued:"Link issued",signed:"Signed",completed:"Complete",cancelled:"Cancelled",pending:"Pending",verified:"Verified",paid:"Paid",waived:"Not required",ready:"Ready",failed:"Failed",unknown:"Under review",accepted:"Accepted by WhatsApp provider",dispatching:"Delivery uncertain",disabled:"Disabled",not_signed:"Not signed",overdue:"Overdue"};
export const statusLabel=(s,lang="he")=>(lang==="en"?agreementLabelsEn:agreementLabels)[s]||s||"—";