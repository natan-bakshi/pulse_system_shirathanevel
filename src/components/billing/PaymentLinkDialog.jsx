import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Copy, Loader2 } from "lucide-react";
import PaymentLinkChannelPicker from "@/components/billing/PaymentLinkChannelPicker";
import DialogLanguageToggle from "@/components/billing/DialogLanguageToggle";
import { billingText, feeLabelForLang } from "@/components/billing/billingI18n";
import { calcProcessingFee } from "@/components/billing/clearingUtils";

const emptyForm = { fullName: "", phone: "", email: "", description: "", amount: "", isInterestedInInvoice: true };

// שליחת דרישת תשלום בקישור - סליקה כללית שאינה משויכת לאירוע.
export default function PaymentLinkDialog({ open, onOpenChange, settings = {}, onSend, loading, result, onReset }) {
  const [form, setForm] = useState(emptyForm);
  const [via, setVia] = useState("whatsapp");
  const [copied, setCopied] = useState(false);
  const [lang, setLang] = useState("he");
  const text = billingText(lang);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm);
    setVia("whatsapp");
    setCopied(false);
    setLang("he");
    onReset?.();
  }, [open]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const amount = Math.round((parseFloat(form.amount) || 0) * 100) / 100;
  const fee = calcProcessingFee(settings, amount);
  const feeLabel = feeLabelForLang(settings, lang);
  const needsPhone = via === "whatsapp" || via === "both";
  const needsEmail = via === "email" || via === "both";
  const canSubmit = !loading && form.fullName.trim() && form.description.trim() && amount > 0 && (!needsPhone || form.phone.trim()) && (!needsEmail || form.email.trim());

  const copyLink = async () => {
    await navigator.clipboard.writeText(result.paymentLink);
    setCopied(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={text.dir} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pe-6">
            <span>{text.titleLink}</span>
            <DialogLanguageToggle lang={lang} onChange={setLang} />
          </DialogTitle>
        </DialogHeader>

        {result?.paymentLink ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
              <p className="font-semibold">{text.linkSentTitle}</p>
              <p className="mt-1">{text.linkSentBody}</p>
            </div>
            <div>
              <Label>{text.paymentLink}</Label>
              <div className="flex gap-2">
                <Input dir="ltr" readOnly value={result.paymentLink} />
                <Button type="button" variant="outline" onClick={copyLink}>{copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{text.linkIntro}</p>
            <div><Label htmlFor="link-name">{text.clientName}</Label><Input id="link-name" value={form.fullName} onChange={(event) => set("fullName", event.target.value)} /></div>
            <div><Label htmlFor="link-description">{text.description}</Label><Input id="link-description" value={form.description} onChange={(event) => set("description", event.target.value)} placeholder={text.descriptionPlaceholder} /></div>
            <div><Label htmlFor="link-amount">{text.amountToCharge} (₪)</Label><Input id="link-amount" type="number" inputMode="decimal" dir="ltr" value={form.amount} onChange={(event) => set("amount", event.target.value)} /></div>
            <PaymentLinkChannelPicker via={via} onChangeVia={setVia} phone={form.phone} onChangePhone={(value) => set("phone", value)} email={form.email} onChangeEmail={(value) => set("email", value)} lang={lang} />
            <label className="flex items-center gap-2"><Checkbox checked={form.isInterestedInInvoice} onCheckedChange={(value) => set("isInterestedInInvoice", value === true)} /><span className="text-sm">{text.sendInvoiceToClient}</span></label>
            {fee.amount > 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{feeLabel}: ₪{fee.amount.toLocaleString()} · {text.totalDue}: ₪{(amount + fee.amount).toLocaleString()}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{result?.paymentLink ? text.close : text.cancel}</Button>
          {!result?.paymentLink && (
            <Button className="bg-red-800 text-white hover:bg-red-900" onClick={() => onSend({ ...form, amount, via, language: lang })} disabled={!canSubmit}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" />{text.sendingLink}</> : text.createSendLink}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}