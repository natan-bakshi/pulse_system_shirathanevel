import React from "react";
import LinkedText from "./LinkedText";
import {israelDate} from "@/lib/israelDate";
const money=(value,currency="ILS")=>new Intl.NumberFormat("he-IL",{style:"currency",currency,maximumFractionDigits:2}).format(Number(value)||0);
export default function AgreementView({snapshot:s,onOpenQuote,busy=false}) {
 if(!s)return null;
 const q=s.quote_summary;
 return <div dir="rtl" className="space-y-6 text-right">
  <header className="rounded-2xl border border-amber-100 bg-gradient-to-l from-amber-50 to-white p-5 sm:p-6">
   <p className="text-xs font-semibold tracking-wide text-amber-800">האירוע שלכם</p><h2 className="text-2xl font-bold text-red-950 mt-2">{s.event_name}</h2>
   <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3 text-sm text-stone-700"><span>מועד האירוע: {israelDate(s.event_date)}</span><span>מחיר כולל: {money(s.total,s.currency)}</span></div>
   {s.recipient_name&&<p className="text-sm mt-3 text-stone-600">עבור {s.recipient_name} · <bdi>{s.recipient_phone}</bdi></p>}
  </header>
  <section className="rounded-2xl border border-stone-200 overflow-hidden">
   <div className="bg-stone-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold text-red-950">תמצית הצעת המחיר</h3>
    {s.quote_file&&onOpenQuote&&<button type="button" disabled={busy} onClick={onOpenQuote} className="rounded-lg bg-red-900 px-4 py-2 text-white text-sm hover:bg-red-800 disabled:opacity-50">פתיחת הצעת המחיר המלאה PDF ↗</button>}
   </div>
   {s.quote_file&&<p className="px-5 pt-3 text-xs text-stone-500">מצורפת הגרסה שנבחרה בעת הכנת ההסכם: {s.quote_file.file_name} · {israelDate(String(s.quote_file.created_at||"").slice(0,10))}</p>}
   {q?<div className="p-4 sm:p-5 space-y-4">{q.rows.map((r,i)=><div key={i} className="border-b border-stone-100 pb-4 last:border-0">
    <div className="flex justify-between items-start gap-4"><div><p className="font-semibold">{r.name} <span className="font-normal text-stone-500">× {r.quantity}</span></p>
     {r.children?.length>0&&<ul className="mt-2 space-y-1 text-sm text-stone-600">{r.children.map((c,j)=><li key={j}>{c.name} × {c.quantity}</li>)}</ul>}</div>
     <div className="shrink-0 text-left"><p className="font-semibold">{money(r.price*r.quantity,r.currency)}</p><p className="text-xs text-stone-500">{r.includes_vat?"כולל מע״מ":"לפני מע״מ"}</p>{r.quantity>1&&<p className="text-xs text-stone-500">{money(r.price,r.currency)} ליחידה</p>}</div></div>
   </div>)}
    {q.pricing_note&&<p className="text-sm text-amber-900 bg-amber-50 rounded-lg p-3">{q.pricing_note}</p>}
    <dl className="rounded-xl bg-stone-50 p-4 space-y-2 text-sm">
     {q.discount>0&&<div className="flex justify-between"><dt>הנחה הכלולה במחיר</dt><dd>{money(q.discount,q.currency)}</dd></div>}
     <div className="flex justify-between text-lg font-bold text-red-950"><dt>סה״כ כולל מע״מ</dt><dd>{money(q.total,q.currency)}</dd></div>
     <div className="flex justify-between"><dt>שולם במועד הכנת ההסכם</dt><dd>{money(q.paid,q.currency)}</dd></div><div className="flex justify-between"><dt>יתרה במועד הכנת ההסכם</dt><dd>{money(q.balance,q.currency)}</dd></div>
    </dl>
   </div>:<p className="p-5 text-sm leading-7"><LinkedText>{s.quote_text||s.quote}</LinkedText></p>}
  </section>
  <details open className="rounded-2xl border border-stone-200 p-5"><summary className="font-bold text-red-950 cursor-pointer">תנאי ההתקשרות</summary><p className="text-sm leading-7 mt-4"><LinkedText>{s.terms}</LinkedText></p></details>
  <section className="rounded-2xl border border-stone-200 p-5"><h3 className="font-bold text-red-950 mb-4">אבני הדרך לתשלום</h3>
   <div className="space-y-3">{s.milestones?.map((m,i)=><div key={i} className="flex items-start gap-3 rounded-xl bg-stone-50 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-900 text-white text-xs">{i+1}</span><div className="flex-1"><p className="font-medium">{m.label}</p><p className="text-sm text-stone-600 mt-1">עד {israelDate(m.due_date)}</p></div><strong className="text-sm whitespace-nowrap">{money(m.amount,s.currency)}</strong></div>)}</div>
  </section>
  <div className="rounded-2xl bg-amber-50/60 border border-amber-100 p-5 space-y-3 text-sm leading-7">
   <h3 className="font-semibold text-red-950">הרשאות ותנאי סגירה</h3><p>תקרת חיובים רגילים: <strong>{money(s.regular_cap,s.currency)}</strong> · תקרת חיובים חריגים: <strong>{money(s.exceptional_cap,s.currency)}</strong>. עמלת הסליקה לפי הסעיף שבהסכם.</p>
   <p>{s.exceptional_notice?"לפני חיוב חריג תישלח הודעה ותינתן אפשרות לתשלום חלופי במשך "+s.exceptional_notice_days+" ימים לפחות.":"לא נקבעה חובת הודעה מקדימה לפני חיוב חריג בהרשאה זו."}</p>
   <p>לסגירת האירוע נדרשת חתימה{s.require_token?" וכרטיס מאומת":"; המנהל אישר מסלול ללא חובת כרטיס"}{s.require_deposit?" ותשלום מקדמה בסך "+money(s.deposit,s.currency):"; המנהל אישר מסלול ללא חובת מקדמה"}. חיוב מהכרטיס מתבצע רק בפעולה ידנית של מנהל.</p>
  </div>
 </div>;
}

