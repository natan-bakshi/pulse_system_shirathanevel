import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Copy, CreditCard, Link2, Loader2 } from "lucide-react";
import { getCurrencySymbol } from "@/components/utils/currencyUtils";
import ClearingAmountSelector from "@/components/billing/ClearingAmountSelector";
import PaymentLinkChannelPicker from "@/components/billing/PaymentLinkChannelPicker";
import DialogLanguageToggle from "@/components/billing/DialogLanguageToggle";
import { billingText, feeLabelForLang } from "@/components/billing/billingI18n";
import { calcAdvanceAmount, calcProcessingFee } from "@/components/billing/clearingUtils";

export default function ClearingPaymentDialog({ open, onOpenChange, event, balance = 0, totalPaid = 0, settings = {}, isAdmin = false, onStart, loading, initialMode = "direct", contacts = [], linkResult, onResetLinkResult }) {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", isInterestedInInvoice: true, itemized: false });
  const [chargeType, setChargeType] = useState("regular");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(initialMode);
  const [via, setVia] = useState("whatsapp");
  const [copied, setCopied] = useState(false);
  // שפת הדיאלוג והמסמך שיופק - עברית כברירת מחדל.
  const [lang, setLang] = useState("he");
  const text = billingText(lang);
  const symbol = getCurrencySymbol(event?.primary_currency || "ILS");
  const allowAdvance = totalPaid === 0 && balance > 0;
  const advanceAmount = useMemo(() => calcAdvanceAmount(settings, balance), [settings, balance]);

  useEffect(() => {
    if (!open) return;
    const contact = event?.parents?.[0] || {};
    setForm({ fullName: contact.name || event?.family_name || "", phone: contact.phone || "", email: contact.email || "", isInterestedInInvoice: true, itemized: false });
    setChargeType("regular");
    setAmount(String(Math.round(balance * 100) / 100));
    setMode(initialMode);
    setVia("whatsapp");
    setCopied(false);
    setLang("he");
    onResetLinkResult?.();
  }, [open, event?.id, balance, initialMode]);

  const selectType = (type) => {
    setChargeType(type);
    setAmount(String(type === "advance" ? advanceAmount : Math.round(balance * 100) / 100));
  };

  const isLink = mode === "link";
  const numericAmount = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const fee = calcProcessingFee(settings, numericAmount);
  const feeLabel = feeLabelForLang(settings, lang);
  const tooHigh = numericAmount > balance + 0.01;
  const needsPhone = isLink && (via === "whatsapp" || via === "both");
  const needsEmail = isLink && (via === "email" || via === "both");
  const canSubmit = !loading && form.fullName && numericAmount > 0 && !tooHigh
    && (isLink ? (!needsPhone || form.phone.trim()) && (!needsEmail || form.email.trim()) : !!form.phone);

  const copyLink = async () => {
    await navigator.clipboard.writeText(linkResult.paymentLink);
    setCopied(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={text.dir} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pe-6">
            <span>{isLink ? text.titleLink : text.titleDirect}</span>
            <DialogLanguageToggle lang={lang} onChange={setLang} />
          </DialogTitle>
        </DialogHeader>

        {linkResult?.paymentLink ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
              <p className="font-semibold">{text.linkSentTitle}</p>
              <p className="mt-1">{text.linkSentBody}</p>
            </div>
            <div>
              <Label>{text.paymentLink}</Label>
              <div className="flex gap-2">
                <Input dir="ltr" readOnly value={linkResult.paymentLink} />
                <Button type="button" variant="outline" onClick={copyLink}>{copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-1">
              <button type="button" onClick={() => setMode("direct")} className={`flex items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-colors ${!isLink ? "bg-red-800 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                <CreditCard className="h-4 w-4" />{text.tabDirect}
              </button>
              <button type="button" onClick={() => setMode("link")} className={`flex items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-colors ${isLink ? "bg-red-800 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                <Link2 className="h-4 w-4" />{text.tabLink}
              </button>
            </div>

            <ClearingAmountSelector chargeType={chargeType} onChangeType={selectType} amount={amount} onChangeAmount={setAmount} balance={balance} advanceAmount={advanceAmount} allowAdvance={allowAdvance} symbol={symbol} lang={lang} />
            {tooHigh && <p className="text-sm text-red-600">{text.tooHigh}</p>}
            <div><Label htmlFor="payer-name">{text.fullName}</Label><Input id="payer-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
            {isLink ? (
              <PaymentLinkChannelPicker via={via} onChangeVia={setVia} phone={form.phone} onChangePhone={(value) => setForm({ ...form, phone: value })} email={form.email} onChangeEmail={(value) => setForm({ ...form, email: value })} contacts={contacts} lang={lang} />
            ) : (
              <>
                <div><Label htmlFor="payer-phone">{text.phone}</Label><Input id="payer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label htmlFor="payer-email">{text.email}</Label><Input id="payer-email" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </>
            )}
            <label className="flex items-center gap-2"><Checkbox checked={form.isInterestedInInvoice} onCheckedChange={(value) => setForm({ ...form, isInterestedInInvoice: value === true })} /><span className="text-sm">{text.sendInvoiceToClient}</span></label>
            {isAdmin && chargeType === "regular" && <label className="flex items-center gap-2"><Checkbox checked={form.itemized} onCheckedChange={(value) => setForm({ ...form, itemized: value === true })} /><span className="text-sm">{text.itemizeInvoice}</span></label>}
            {fee.amount > 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{feeLabel}: {symbol}{fee.amount.toLocaleString()} · {text.totalDue}: {symbol}{(numericAmount + fee.amount).toLocaleString()}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{linkResult?.paymentLink ? text.close : text.cancel}</Button>
          {!linkResult?.paymentLink && (
            <Button onClick={() => onStart({ ...form, amount: numericAmount, chargeType, mode, via, language: lang })} disabled={!canSubmit}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" />{isLink ? text.sendingLink : text.openingPayment}</> : (isLink ? text.createSendLink : text.continueSecure)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}