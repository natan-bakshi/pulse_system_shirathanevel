import React from "react";
import { Check, Circle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ClosingStatus({agreement:a,busy,onToken,onDeposit,onPdf,onRefresh}) {
  const completed=!!a.completed_at;
  const tokenDone=a.token_state==="verified";
  const depositDone=a.deposit_state==="paid";
  const requirementsMet=(!a.require_token||tokenDone)&&(!a.require_deposit||depositDone);
  if(completed)return <section dir="rtl" className="mx-auto max-w-xl text-center space-y-5 py-10 sm:py-16" aria-label="אישור סגירת האירוע">
    <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-800"><Check aria-hidden="true" className="h-8 w-8"/></span>
    <div className="space-y-2"><h1 className="text-2xl sm:text-3xl font-bold text-red-950">הכול מוכן. האירוע אושר</h1><p className="text-stone-700 leading-7">ההסכם נחתם וכל הדרישות שנקבעו לסגירת האירוע הושלמו.</p></div>
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5 text-right space-y-2"><p className="font-semibold text-stone-900">מה הושלם?</p><p>ההסכם נחתם</p>{a.require_token&&<p>הכרטיס אומת</p>}{a.require_deposit&&<p>המקדמה שולמה</p>}</div>
    <Button variant="outline" disabled={busy} onClick={onPdf} className="min-h-11"><FileText aria-hidden="true" className="h-4 w-4"/> פתיחת העותק החתום</Button>
  </section>;
  return <section dir="rtl" className="space-y-5 border-t pt-6" aria-label="דרישות סגירת האירוע">
    <div><h2 className="text-xl font-semibold text-red-950">השלמת סגירת האירוע</h2><p className="mt-1 text-stone-600">רק השלבים שנקבעו בהסכם נדרשים להשלמת הסגירה.</p></div>
    <div className="space-y-3">{[
      {label:"חתימה על ההסכם",done:true},
      ...(a.require_token?[{label:"אימות כרטיס לתשלום",done:tokenDone,action:onToken,button:"שמירת כרטיס בדף מאובטח"}]:[]),
      ...(a.require_deposit?[{label:"תשלום מקדמה",done:depositDone,action:onDeposit,button:"תשלום מקדמה בדף מאובטח"}]:[])
    ].map(step=><div key={step.label} className="rounded-xl border border-stone-200 bg-stone-50 p-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0">{step.done?<Check aria-hidden="true" className="h-5 w-5 text-green-700 shrink-0"/>:<Circle aria-hidden="true" className="h-5 w-5 text-amber-700 shrink-0"/>}<div><p className="font-medium">{step.label}</p><p className="text-sm text-stone-600">{step.done?"הושלם":"ממתין לביצוע"}</p></div></div>{!step.done&&<Button disabled={busy} onClick={step.action} className="min-h-11 bg-red-900 text-white hover:bg-red-800">{step.button}</Button>}</div>)}</div>
    {requirementsMet&&<p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 leading-7">הדרישות בהסכם הושלמו, אך סגירת האירוע טרם אושרה במערכת. יש לפנות למנהל לבדיקת מצב האירוע.</p>}
    <div className="flex flex-wrap gap-3"><Button disabled={busy} variant="outline" onClick={onPdf} className="min-h-11">פתיחת העותק החתום</Button><Button disabled={busy} variant="outline" onClick={onRefresh} className="min-h-11">רענון מצב</Button></div>
  </section>;
}