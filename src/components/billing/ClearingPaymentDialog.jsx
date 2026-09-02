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
import { calcAdvanceAmount, calcProcessingFee } from "@/components/billing/clearingUtils";

export default function ClearingPaymentDialog({ open, onOpenChange, event, balance = 0, totalPaid = 0, settings = {}, isAdmin = false, onStart, loading, initialMode = "direct", contacts = [], linkResult, onResetLinkResult }) {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", isInterestedInInvoice: true, itemized: false });
  const [chargeType, setChargeType] = useState("regular");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(initialMode);
  const [via, setVia] = useState("whatsapp");
  const [copied, setCopied] = useState(false);
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
    onResetLinkResult?.();
  }, [open, event?.id, balance, initialMode]);

  const selectType = (type) => {
    setChargeType(type);
    setAmount(String(type === "advance" ? advanceAmount : Math.round(balance * 100) / 100));
  };

  const isLink = mode === "link";
  const numericAmount = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const fee = calcProcessingFee(settings, numericAmount);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isLink ? "שליחת דרישת תשלום בקישור" : "פתיחת תשלום בכרטיס"}</DialogTitle></DialogHeader>

        {linkResult?.paymentLink ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
              <p className="font-semibold">הקישור נשלח בהצלחה</p>
              <p className="mt-1">התשלום נרשם באירוע בסטטוס ממתין ויתעדכן אוטומטית לאחר שהלקוח ישלם.</p>
            </div>
            <div>
              <Label>הקישור לתשלום</Label>
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
                <CreditCard className="h-4 w-4" />סליקה כאן ועכשיו
              </button>
              <button type="button" onClick={() => setMode("link")} className={`flex items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-colors ${isLink ? "bg-red-800 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                <Link2 className="h-4 w-4" />שליחת קישור ללקוח
              </button>
            </div>

            <ClearingAmountSelector chargeType={chargeType} onChangeType={selectType} amount={amount} onChangeAmount={setAmount} balance={balance} advanceAmount={advanceAmount} allowAdvance={allowAdvance} symbol={symbol} />
            {tooHigh && <p className="text-sm text-red-600">לא ניתן לסלוק סכום הגבוה מהיתרה לתשלום.</p>}
            <div><Label htmlFor="payer-name">שם מלא</Label><Input id="payer-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
            {isLink ? (
              <PaymentLinkChannelPicker via={via} onChangeVia={setVia} phone={form.phone} onChangePhone={(value) => setForm({ ...form, phone: value })} email={form.email} onChangeEmail={(value) => setForm({ ...form, email: value })} contacts={contacts} />
            ) : (
              <>
                <div><Label htmlFor="payer-phone">טלפון</Label><Input id="payer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label htmlFor="payer-email">אימייל</Label><Input id="payer-email" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </>
            )}
            <label className="flex items-center gap-2"><Checkbox checked={form.isInterestedInInvoice} onCheckedChange={(value) => setForm({ ...form, isInterestedInInvoice: value === true })} /><span className="text-sm">שלח את החשבונית ללקוח לאחר התשלום</span></label>
            {isAdmin && chargeType === "regular" && <label className="flex items-center gap-2"><Checkbox checked={form.itemized} onCheckedChange={(value) => setForm({ ...form, itemized: value === true })} /><span className="text-sm">פרט חבילות ושירותים בחשבונית</span></label>}
            {fee.amount > 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">ל{fee.label} בסך {symbol}{fee.amount.toLocaleString()} תתווסף לתשלום. סה״כ לחיוב: {symbol}{(numericAmount + fee.amount).toLocaleString()}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{linkResult?.paymentLink ? "סגור" : "ביטול"}</Button>
          {!linkResult?.paymentLink && (
            <Button onClick={() => onStart({ ...form, amount: numericAmount, chargeType, mode, via })} disabled={!canSubmit}>
              {loading ? <><Loader2 className="ml-2 h-4 w-4 animate-spin" />{isLink ? "שולח קישור..." : "פותח תשלום..."}</> : (isLink ? "צור ושלח קישור" : "המשך לתשלום מאובטח")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}