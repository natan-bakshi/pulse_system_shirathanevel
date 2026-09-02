import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DialogLanguageToggle from "@/components/billing/DialogLanguageToggle";
import { billingText, feeLabelForLang } from "@/components/billing/billingI18n";
import { calcProcessingFee } from "@/components/billing/clearingUtils";

const emptyForm = { fullName: "", phone: "", email: "", description: "", amount: "", isInterestedInInvoice: true };

export default function GeneralClearingDialog({ open, onOpenChange, settings = {}, onStart, loading }) {
  const [form, setForm] = useState(emptyForm);
  const [lang, setLang] = useState("he");
  const text = billingText(lang);
  useEffect(() => { if (open) { setForm(emptyForm); setLang("he"); } }, [open]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const amount = Math.round((parseFloat(form.amount) || 0) * 100) / 100;
  const fee = calcProcessingFee(settings, amount);
  const feeLabel = feeLabelForLang(settings, lang);
  const canSubmit = !loading && form.fullName.trim() && form.phone.trim() && form.description.trim() && amount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={text.dir} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pe-6">
            <span>{text.titleGeneral}</span>
            <DialogLanguageToggle lang={lang} onChange={setLang} />
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{text.generalNote}</p>
          <div><Label htmlFor="general-name">{text.clientName}</Label><Input id="general-name" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} /></div>
          <div><Label htmlFor="general-phone">{text.phone}</Label><Input id="general-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div><Label htmlFor="general-email">{text.email}</Label><Input id="general-email" type="email" dir="ltr" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div><Label htmlFor="general-description">{text.description}</Label><Input id="general-description" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={text.descriptionPlaceholder} /></div>
          <div><Label htmlFor="general-amount">{text.amountToCharge} (₪)</Label><Input id="general-amount" type="number" inputMode="decimal" dir="ltr" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <label className="flex items-center gap-2"><Checkbox checked={form.isInterestedInInvoice} onCheckedChange={(value) => set("isInterestedInInvoice", value === true)} /><span className="text-sm">{text.sendInvoiceToClient}</span></label>
          {fee.amount > 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{feeLabel}: ₪{fee.amount.toLocaleString()} · {text.totalDue}: ₪{(amount + fee.amount).toLocaleString()}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{text.cancel}</Button>
          <Button onClick={() => onStart({ ...form, amount, language: lang })} disabled={!canSubmit}>{loading ? text.openingPayment : text.continueSecure}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}