import React,{useState} from "react";
import { Check, Circle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { closingText } from "./closingI18n";

export default function ClosingStatus({agreement:a,busy,onToken,onDeposit,onBank,onPdf,onQuote,onRefresh,language="he"}) {
  const t=closingText[language]||closingText.he;
  const completed=!!a.completed_at;
  const tokenDone=a.token_state==="verified";
  const depositDone=a.deposit_state==="paid";
  const [showBank,setShowBank]=useState(a.deposit_method==="bank");
  const bankDetails=a.snapshot?.bank_details;
  const requirementsMet=(!a.require_token||tokenDone)&&(!a.require_deposit||depositDone);
  if(completed)return <section dir={language==="en"?"ltr":"rtl"} className="mx-auto max-w-xl text-center space-y-5 py-10 sm:py-16" aria-label="אישור סגירת האירוע">
    <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-800"><Check aria-hidden="true" className="h-8 w-8"/></span>
    <div className="space-y-2"><h1 className="text-2xl sm:text-3xl font-bold text-red-950">{t.doneTitle}</h1><p className="text-stone-700 leading-7">{t.doneDescription}</p></div>
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5 text-start space-y-2"><p className="font-semibold text-stone-900">{t.doneWhat}</p><p>{t.doneSigned}</p>{a.require_token&&<p>{t.doneCard}</p>}{a.require_deposit&&<p>{t.doneDeposit}</p>}</div>
    <div className="flex flex-wrap justify-center gap-3"><Button variant="outline" disabled={busy} onClick={onPdf} className="min-h-11"><FileText aria-hidden="true" className="h-4 w-4"/> {t.pdf}</Button>{a.snapshot?.quote_file?.file_uri&&<Button variant="outline" disabled={busy} onClick={onQuote} className="min-h-11"><FileText aria-hidden="true" className="h-4 w-4"/> {t.openQuote}</Button>}</div>
  </section>;
  return <section dir={language==="en"?"ltr":"rtl"} className="space-y-5 border-t pt-6" aria-label="דרישות סגירת האירוע">
    <div><h2 className="text-xl font-semibold text-red-950">{t.complete}</h2><p className="mt-1 text-stone-600">{t.completeDescription}</p></div>
    <div className="space-y-3">{[
      {label:t.stepSigned,done:true},
      ...(a.require_token?[{label:t.stepCard,done:tokenDone,action:onToken,button:t.cardButton}]:[]),
      ...(a.require_deposit?[{label:t.stepDeposit,done:depositDone,action:onDeposit,button:t.depositButton}]:[])
    ].map(step=><div key={step.label} className="rounded-xl border border-stone-200 bg-stone-50 p-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0">{step.done?<Check aria-hidden="true" className="h-5 w-5 text-green-700 shrink-0"/>:<Circle aria-hidden="true" className="h-5 w-5 text-amber-700 shrink-0"/>}<div><p className="font-medium">{step.label}</p><p className="text-sm text-stone-600">{step.done?(step.label===t.stepDeposit&&a.deposit_received?`${t.done} · ${a.deposit_received} ${a.snapshot?.currency||""}`:t.done):t.pending}</p></div></div>{!step.done&&<Button disabled={busy} onClick={step.action} className="min-h-11 bg-red-900 text-white hover:bg-red-800">{step.button}</Button>}</div>)}</div>
    {requirementsMet&&<p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 leading-7">{t.notClosed}</p>}
    <div className="flex flex-wrap gap-3"><Button disabled={busy} variant="outline" onClick={onPdf} className="min-h-11">{t.pdf}</Button><Button disabled={busy} variant="outline" onClick={onRefresh} className="min-h-11">{t.refresh}</Button></div>
  </section>;
}