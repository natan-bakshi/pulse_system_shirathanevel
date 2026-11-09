import React, { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check } from "lucide-react";
import {useLanguage} from '@/i18n/LanguageProvider';

// ויזארד ביטול מסמך דו-שלבי: (1) חשבונית זיכוי, (2) קבלה שלילית (החזר כספי).
export default function CancelInvoiceWizard({ document, step, onClose, onCredit, onRefund, loading }) {
  const {t: uiTranslate}=useLanguage();
  const [creditReason, setCreditReason] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const number = document?.document_number || "—";
  const isRefundStep = step === "refund";
  const isDone = step === "done";
  return <Dialog open={!!document} onOpenChange={(open) => !open && onClose()}>
    <DialogContent>
      <DialogHeader><DialogTitle>{uiTranslate("ביטול מסמך")} {number}</DialogTitle></DialogHeader>
      <div className="flex items-center gap-2 text-xs">
        <span className={`rounded-full px-3 py-1 ${isRefundStep || isDone ? "bg-green-100 text-green-800" : "bg-red-800 text-white"}`}>{uiTranslate("1. חשבונית זיכוי")}</span>
        <span className={`rounded-full px-3 py-1 ${isDone ? "bg-green-100 text-green-800" : isRefundStep ? "bg-red-800 text-white" : "bg-gray-100 text-gray-500"}`}>{uiTranslate("2. קבלה שלילית")}</span>
      </div>
      {!isRefundStep && !isDone && <div className="space-y-3">
        <p className="text-sm text-gray-600">{uiTranslate("שלב 1 מתוך 2: תופק חשבונית זיכוי מלאה עבור מסמך")} {number}{uiTranslate(". לא ניתן לבטל פעולה זו.")}</p>
        <div><Label htmlFor="credit-reason">{uiTranslate("סיבת הזיכוי")}</Label><Textarea id="credit-reason" value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="לדוגמה: ביטול עסקה" /></div>
      </div>}
      {isRefundStep && <div className="space-y-3">
        <p className="text-sm text-gray-600">{uiTranslate("שלב 2 מתוך 2: חשבונית הזיכוי הופקה. אם הכסף הוחזר ללקוח, יש להפיק קבלה שלילית לתיעוד ההחזר.")}</p>
        <div><Label htmlFor="refund-reason">{uiTranslate("סיבת ההחזר")}</Label><Textarea id="refund-reason" value={refundReason} onChange={(event) => setRefundReason(event.target.value)} placeholder="לדוגמה: החזר כספי ללקוח" /></div>
      </div>}
      {isDone && <p className="flex items-center gap-2 text-sm text-green-700"><Check className="h-4 w-4" />{uiTranslate("תהליך הביטול הושלם: הופקו חשבונית זיכוי וקבלה שלילית.")}</p>}
      <DialogFooter>
        {isDone
          ? <Button onClick={onClose}>{uiTranslate("סגור")}</Button>
          : isRefundStep
            ? <><Button variant="outline" onClick={onClose} disabled={loading}>{uiTranslate("דלג וסגור")}</Button><Button variant="destructive" onClick={() => onRefund(refundReason)} disabled={loading}>{loading ? "מפיק קבלה שלילית..." : "הפק קבלה שלילית"}</Button></>
            : <><Button variant="outline" onClick={onClose} disabled={loading}>{uiTranslate("ביטול")}</Button><Button variant="destructive" onClick={() => onCredit(creditReason)} disabled={loading}>{loading ? "מפיק זיכוי..." : "הפק חשבונית זיכוי"}</Button></>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}