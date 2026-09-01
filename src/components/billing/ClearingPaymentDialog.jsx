import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrencySymbol } from "@/components/utils/currencyUtils";
import ClearingAmountSelector from "@/components/billing/ClearingAmountSelector";
import { calcAdvanceAmount, calcProcessingFee } from "@/components/billing/clearingUtils";

export default function ClearingPaymentDialog({ open, onOpenChange, event, balance = 0, totalPaid = 0, settings = {}, isAdmin = false, onStart, loading }) {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", isInterestedInInvoice: true, itemized: false });
  const [chargeType, setChargeType] = useState("regular");
  const [amount, setAmount] = useState("");
  const symbol = getCurrencySymbol(event?.primary_currency || "ILS");
  const allowAdvance = totalPaid === 0 && balance > 0;
  const advanceAmount = useMemo(() => calcAdvanceAmount(settings, balance), [settings, balance]);

  useEffect(() => {
    if (!open) return;
    const contact = event?.parents?.[0] || {};
    setForm({ fullName: contact.name || event?.family_name || "", phone: contact.phone || "", email: contact.email || "", isInterestedInInvoice: true, itemized: false });
    setChargeType("regular");
    setAmount(String(Math.round(balance * 100) / 100));
  }, [open, event?.id, balance]);

  const selectType = (type) => {
    setChargeType(type);
    setAmount(String(type === "advance" ? advanceAmount : Math.round(balance * 100) / 100));
  };

  const numericAmount = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const fee = calcProcessingFee(settings, numericAmount);
  const tooHigh = numericAmount > balance + 0.01;
  const canSubmit = !loading && form.fullName && form.phone && numericAmount > 0 && !tooHigh;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>פתיחת תשלום בכרטיס</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <ClearingAmountSelector chargeType={chargeType} onChangeType={selectType} amount={amount} onChangeAmount={setAmount} balance={balance} advanceAmount={advanceAmount} allowAdvance={allowAdvance} symbol={symbol} />
          {tooHigh && <p className="text-sm text-red-600">לא ניתן לסלוק סכום הגבוה מהיתרה לתשלום.</p>}
          <div><Label htmlFor="payer-name">שם מלא</Label><Input id="payer-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
          <div><Label htmlFor="payer-phone">טלפון</Label><Input id="payer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><Label htmlFor="payer-email">אימייל</Label><Input id="payer-email" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <label className="flex items-center gap-2"><Checkbox checked={form.isInterestedInInvoice} onCheckedChange={(value) => setForm({ ...form, isInterestedInInvoice: value === true })} /><span className="text-sm">שלח לי את החשבונית לאחר התשלום</span></label>
          {isAdmin && chargeType === "regular" && <label className="flex items-center gap-2"><Checkbox checked={form.itemized} onCheckedChange={(value) => setForm({ ...form, itemized: value === true })} /><span className="text-sm">פרט חבילות ושירותים בחשבונית</span></label>}
          {fee.amount > 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">ל{fee.label} בסך {symbol}{fee.amount.toLocaleString()} תתווסף לתשלום. סה״כ לחיוב: {symbol}{(numericAmount + fee.amount).toLocaleString()}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>ביטול</Button>
          <Button onClick={() => onStart({ ...form, amount: numericAmount, chargeType })} disabled={!canSubmit}>{loading ? "פותח תשלום..." : "המשך לתשלום מאובטח"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}