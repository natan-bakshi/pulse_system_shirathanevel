import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Copy, Loader2 } from "lucide-react";
import PaymentLinkChannelPicker from "@/components/billing/PaymentLinkChannelPicker";
import { calcProcessingFee } from "@/components/billing/clearingUtils";

const emptyForm = { fullName: "", phone: "", email: "", description: "", amount: "", isInterestedInInvoice: true };

// שליחת דרישת תשלום בקישור - סליקה כללית שאינה משויכת לאירוע.
export default function PaymentLinkDialog({ open, onOpenChange, settings = {}, onSend, loading, result, onReset }) {
  const [form, setForm] = useState(emptyForm);
  const [via, setVia] = useState("whatsapp");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm);
    setVia("whatsapp");
    setCopied(false);
    onReset?.();
  }, [open]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const amount = Math.round((parseFloat(form.amount) || 0) * 100) / 100;
  const fee = calcProcessingFee(settings, amount);
  const needsPhone = via === "whatsapp" || via === "both";
  const needsEmail = via === "email" || via === "both";
  const canSubmit = !loading && form.fullName.trim() && form.description.trim() && amount > 0 && (!needsPhone || form.phone.trim()) && (!needsEmail || form.email.trim());

  const copyLink = async () => {
    await navigator.clipboard.writeText(result.paymentLink);
    setCopied(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>שליחת דרישת תשלום בקישור</DialogTitle></DialogHeader>

        {result?.paymentLink ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
              <p className="font-semibold">הקישור נשלח בהצלחה ללקוח</p>
              <p className="mt-1">התשלום נרשם במערכת בסטטוס ממתין ויתעדכן אוטומטית לאחר שהלקוח ישלם.</p>
            </div>
            <div>
              <Label>הקישור לתשלום</Label>
              <div className="flex gap-2">
                <Input dir="ltr" readOnly value={result.paymentLink} />
                <Button type="button" variant="outline" onClick={copyLink}>{copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">ייווצר קישור לדף תשלום מאובטח עם התיאור והסכום, וישלח ללקוח. הלקוח יזין את פרטי הכרטיס בעצמו.</p>
            <div><Label htmlFor="link-name">שם הלקוח</Label><Input id="link-name" value={form.fullName} onChange={(event) => set("fullName", event.target.value)} /></div>
            <div><Label htmlFor="link-description">תיאור לחשבונית</Label><Input id="link-description" value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="לדוגמה: ייעוץ הפקה" /></div>
            <div><Label htmlFor="link-amount">סכום לחיוב (₪)</Label><Input id="link-amount" type="number" inputMode="decimal" dir="ltr" value={form.amount} onChange={(event) => set("amount", event.target.value)} /></div>
            <PaymentLinkChannelPicker via={via} onChangeVia={setVia} phone={form.phone} onChangePhone={(value) => set("phone", value)} email={form.email} onChangeEmail={(value) => set("email", value)} />
            <label className="flex items-center gap-2"><Checkbox checked={form.isInterestedInInvoice} onCheckedChange={(value) => set("isInterestedInInvoice", value === true)} /><span className="text-sm">שלח את החשבונית ללקוח</span></label>
            {fee.amount > 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">ל{fee.label} בסך ₪{fee.amount.toLocaleString()} תתווסף לתשלום. סה״כ לחיוב: ₪{(amount + fee.amount).toLocaleString()}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{result?.paymentLink ? "סגור" : "ביטול"}</Button>
          {!result?.paymentLink && (
            <Button className="bg-red-800 text-white hover:bg-red-900" onClick={() => onSend({ ...form, amount, via })} disabled={!canSubmit}>
              {loading ? <><Loader2 className="ml-2 h-4 w-4 animate-spin" />שולח קישור...</> : "צור ושלח קישור"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}