import React from "react";
export default function AgreementView({snapshot:s}) {
 if(!s)return null;
 return <div dir="rtl" className="space-y-5 text-right">
  <header><h2 className="text-xl font-bold">{s.event_name}</h2><p>{s.event_date} · מחיר האירוע: {s.total?.toLocaleString("he-IL")} {s.currency}</p>
  {s.recipient_name&&<p>לקוח/ה: {s.recipient_name} · {s.recipient_phone}</p>}</header>
  <details open><summary className="font-semibold cursor-pointer">הצעת המחיר</summary><p className="whitespace-pre-wrap break-words text-sm leading-7 mt-2">{s.quote_text||s.quote}</p></details>
  <details open><summary className="font-semibold cursor-pointer">תנאי ההתקשרות</summary><p className="whitespace-pre-wrap break-words text-sm leading-7 mt-2">{s.terms}</p></details>
  <section><h3 className="font-semibold mb-2">אבני דרך לתשלום</h3><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-right p-2">שלב</th><th>לתשלום</th><th>עד לתאריך</th></tr></thead><tbody>{s.milestones.map((m,i)=><tr key={i} className="border-t"><td className="p-2">{m.label}</td><td className="p-2 whitespace-nowrap">{m.amount} {s.currency}</td><td className="p-2 whitespace-nowrap">{m.due_date}</td></tr>)}</tbody></table></div></section>
  <p>תקרת חיובים רגילים: <strong>{s.regular_cap} {s.currency}</strong> · תקרת חיובים חריגים: <strong>{s.exceptional_cap} {s.currency}</strong>. עמלת הסליקה תחושב לפי הסעיף שבהסכם.</p>
  <p>{s.exceptional_notice ? "לפני חיוב חריג תישלח הודעה ותינתן אפשרות לתשלום חלופי במשך "+s.exceptional_notice_days+" ימים לפחות." : "לא נקבעה חובת הודעה מקדימה לפני חיוב חריג בהרשאה זו."}</p>
  <p className="rounded bg-slate-50 p-3">לסגירת האירוע נדרשת חתימה{s.require_token?" וכרטיס מאומת":"; המנהל אישר מסלול ללא חובת כרטיס"}{s.require_deposit?" ותשלום מקדמה בסך "+s.deposit+" "+s.currency:"; המנהל אישר מסלול ללא חובת מקדמה"}. חיוב מהכרטיס מתבצע רק בפעולה ידנית של מנהל.</p>
 </div>;
}
