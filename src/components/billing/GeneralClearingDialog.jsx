import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calcProcessingFee } from "@/components/billing/clearingUtils";

const emptyForm = { fullName: "", phone: "", email: "", description: "", amount: "", isInterestedInInvoice: true };

export default function GeneralClearingDialog({ open, onOpenChange, settings = {}, onStart, loading }) {
  const [form, setForm] = useState(emptyForm);
  useEffect(() => { if (open) setForm(emptyForm); }, [open]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const amount = Math.round((parseFloat(form.amount) || 0) * 100) / 100;
  const fee = calcProcessingFee(settings, amount);
  const canSubmit = !loading && form.fullName.trim() && form.phone.trim() && form.description.trim() && amount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>סליקה כללית</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">סליקה שאינה משויכת לאירוע. התשלום יירשם במערכת ותופק עבורו חשבונית.</p>
          <div><Label htmlFor="general-name">שם הלקוח</Label><Input id="general-name" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} /></div>
          <div><Label htmlFor="general-phone">טלפון</Label><Input id="general-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div><Label htmlFor="general-email">אימייל</Label><Input id="general-email" type="email" dir="ltr" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div><Label htmlFor="general-description">תיאור לחשבונית</Label><Input id="general-description" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="לדוגמה: ייעוץ הפקה" /></div>
          <div><Label htmlFor="general-amount">סכום לחיוב (₪)</Label><Input id="general-amount" type="number" inputMode="decimal" dir="ltr" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <label className="flex items-center gap-2"><Checkbox checked={form.isInterestedInInvoice} onCheckedChange={(value) => set("isInterestedInInvoice", value === true)} /><span className="text-sm">שלח את החשבונית ללקוח</span></label>
          {fee.amount > 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">ל{fee.label} בסך ₪{fee.amount.toLocaleString()} תתווסף לתשלום. סה״כ לחיוב: ₪{(amount + fee.amount).toLocaleString()}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>ביטול</Button>
          <Button onClick={() => onStart({ ...form, amount })} disabled={!canSubmit}>{loading ? "פותח תשלום..." : "המשך לתשלום מאובטח"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}