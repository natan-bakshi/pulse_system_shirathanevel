import React from "react";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {securityExplanation,depositExplanation} from "./closingGuidance";
export default function ClosingIntroduction({agreement:a,language="he",open,onClose}){
 const en=language==="en";
 return <Dialog open={open} onOpenChange={value=>{if(!value)onClose();}}><DialogContent dir={en?"ltr":"rtl"} className="max-w-2xl max-h-[90dvh] overflow-auto rounded-2xl p-5 sm:p-8">
 <DialogHeader><DialogTitle className="text-xl text-red-950">{en?"Before we begin — what is this form for?":"לפני שמתחילים — מה עושים בטופס?"}</DialogTitle><DialogDescription>{en?"These are the steps selected for your event. You can review everything before signing.":"אלה השלבים שנקבעו לאירוע שלכם. אפשר לקרוא הכול בנחת לפני החתימה."}</DialogDescription></DialogHeader>
 <ol className="list-decimal list-inside space-y-4 text-sm leading-7">
 <li className="rounded-xl bg-stone-50 p-4"><strong>{en?"Review and sign":"קוראים וחותמים"}</strong><p>{en?"Review your quotation and terms of engagement, confirm the applicable clauses and sign with a finger or mouse.":"עוברים על הצעת המחיר והסכם ההתקשרות, מאשרים את הסעיפים וחותמים באצבע או בעכבר."}</p></li>
 {a.require_token&&<li className="rounded-xl border border-amber-200 bg-amber-50 p-4"><strong>{en?"A card as security — not a payment":"כרטיס לביטחון — הזנת הכרטיס אינה תשלום"}</strong><p>{securityExplanation[language]||securityExplanation.he}</p></li>}
 {a.require_deposit&&<li className="rounded-xl bg-stone-50 p-4"><strong>{en?"Deposit":"מקדמה"} · {a.effective_deposit??a.snapshot.deposit} {a.snapshot.currency}</strong><p>{depositExplanation(a,language)}</p>{a.deposit_state==="paid"&&<p className="font-semibold text-green-800">{en?"Your deposit has already been recorded. No further deposit payment is needed.":"המקדמה שלכם כבר נקלטה. אין צורך לשלם אותה שוב."}</p>}</li>}
 </ol>
 <p className="text-sm text-stone-600">{en?"Signing alone does not finish any other required steps. A clear status summary will show what is complete and what remains.":"החתימה לבדה אינה משלימה את יתר השלבים הנדרשים. בהמשך תראו בבירור מה הושלם ומה עוד נותר."}</p>
 <Button className="w-full bg-red-900" onClick={onClose}>{en?"Understood — continue to the form":"הבנתי, אפשר להמשיך לטופס"}</Button>
 </DialogContent></Dialog>;
}