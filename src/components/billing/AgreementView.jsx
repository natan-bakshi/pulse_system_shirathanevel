import React from "react";
import LinkedText from "./LinkedText";
import {israelDate} from "@/lib/israelDate";
import {closingText,localizedSnapshot} from "./closingI18n";
const money=(value,currency="ILS",language="he")=>new Intl.NumberFormat(language==="en"?"en-US":"he-IL",{style:"currency",currency,maximumFractionDigits:2}).format(Number(value)||0);
export default function AgreementView({snapshot,onOpenQuote,busy=false,language="he",paidAmount=0}) {
  if(!snapshot)return null;
  const s=localizedSnapshot(snapshot,language),t=closingText[language]||closingText.he;
  const q=s.quote_summary,fmt=(value,currency=s.currency)=>money(value,currency,language);
  return <div dir={language==="en"?"ltr":"rtl"} className="space-y-6 text-start">
  <header className="rounded-2xl border border-amber-100 bg-gradient-to-l from-amber-50 to-white p-5 sm:p-6">
   <p className="text-xs font-semibold tracking-wide text-amber-800">{t.event}</p><h2 className="text-2xl font-bold text-red-950 mt-2">{s.event_name}</h2>
   <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3 text-sm text-stone-700"><span>{t.date}: {israelDate(s.event_date)}</span><span>{t.total}: {fmt(s.total)}</span></div>
   {s.recipient_name&&<p className="text-sm mt-3 text-stone-600">{t.for} {s.recipient_name} · <bdi>{s.recipient_phone}</bdi></p>}
  </header>
  <section className="rounded-2xl border border-stone-200 overflow-hidden">
   <div className="bg-stone-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold text-red-950">{t.summary}</h3>
    {s.quote_file&&onOpenQuote&&<button type="button" disabled={busy} onClick={onOpenQuote} className="rounded-lg bg-red-900 px-4 py-2 text-white text-sm hover:bg-red-800 disabled:opacity-50">{t.openQuote}</button>}
   </div>
   {s.quote_file&&<p className="px-5 pt-3 text-xs text-stone-500">{t.attached} {s.quote_file.file_name} · {israelDate(String(s.quote_file.created_at||"").slice(0,10))}</p>}
   {q?<div className="p-4 sm:p-5 space-y-4">{q.rows.map((r,i)=><div key={i} className="border-b border-stone-100 pb-4 last:border-0">
    <div className="flex justify-between items-start gap-4"><div><p className="font-semibold">{r.name} <span className="font-normal text-stone-500">× {r.quantity}</span></p>
     {r.children?.length>0&&<ul className="mt-2 space-y-1 text-sm text-stone-600">{r.children.map((c,j)=><li key={j}>{c.name} × {c.quantity}</li>)}</ul>}</div>
     {!q.all_inclusive&&<div className="shrink-0 text-end"><p className="font-semibold">{fmt(r.price*r.quantity,r.currency)}</p><p className="text-xs text-stone-500">{r.includes_vat?t.vatIncluded:t.vatExcluded}</p>{r.quantity>1&&<p className="text-xs text-stone-500">{fmt(r.price,r.currency)} {t.perUnit}</p>}</div>}</div>
   </div>)}
    {q.pricing_note&&<p className="text-sm text-amber-900 bg-amber-50 rounded-lg p-3">{q.pricing_note}</p>}
    <dl className="rounded-xl bg-stone-50 p-4 space-y-2 text-sm">
     {q.discount>0&&<div className="flex justify-between"><dt>{t.discount}</dt><dd>{fmt(q.discount,q.currency)}</dd></div>}
     <div className="flex justify-between text-lg font-bold text-red-950"><dt>{q.all_inclusive?t.allInclusiveTotal:t.total}</dt><dd>{fmt(q.total,q.currency)}</dd></div>
     <div className="flex justify-between"><dt>{t.paid}</dt><dd>{fmt(q.paid,q.currency)}</dd></div><div className="flex justify-between"><dt>{t.balance}</dt><dd>{fmt(q.balance,q.currency)}</dd></div>
    </dl>
   </div>:<p className="p-5 text-sm leading-7"><LinkedText>{s.quote_text||s.quote}</LinkedText></p>}
  </section>
  <details open className="rounded-2xl border border-stone-200 p-5"><summary className="font-bold text-red-950 cursor-pointer">{t.terms}</summary><p className="text-sm leading-7 mt-4"><LinkedText>{s.terms}</LinkedText></p></details>
  <section className="rounded-2xl border border-stone-200 p-5"><h3 className="font-bold text-red-950 mb-4">{t.milestones}</h3>
   <div className="space-y-3">{s.milestones?.map((m,i)=>{const paid=i===0&&Number(m.amount)>0&&(s.deposit_paid_at_creation||Number(paidAmount)>=Number(m.amount));return <div key={i} className="flex items-start gap-3 rounded-xl bg-stone-50 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-900 text-white text-xs">{i+1}</span><div className="flex-1"><p className="font-medium">{m.label}</p><p className="text-sm text-stone-600 mt-1">{paid?t.paidMilestone:t.due+" "+israelDate(m.due_date)}</p></div><strong className="text-sm whitespace-nowrap">{fmt(m.amount)}</strong></div>})}</div>
  </section>
  <div className="rounded-2xl bg-amber-50/60 border border-amber-100 p-5 space-y-3 text-sm leading-7">
   <h3 className="font-semibold text-red-950">{t.conditions}</h3><p>{t.regularCap}: <strong>{fmt(s.regular_cap)}</strong> · {t.exceptionalCap}: <strong>{fmt(s.exceptional_cap)}</strong>. {t.feeNote}</p>
   <p>{s.exceptional_notice?t.notice+' '+s.exceptional_notice_days+' '+t.days:t.noNotice}</p>
   <p>{t.closingNeeds}{s.require_token?t.cardNeeded:t.cardWaived}{s.require_deposit?t.depositNeeded+fmt(s.deposit):t.depositWaived}. {t.manualOnly}</p>
  </div>
 </div>;
}