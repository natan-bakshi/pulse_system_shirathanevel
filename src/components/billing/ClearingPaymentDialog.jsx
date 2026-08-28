import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ClearingPaymentDialog({ open, onOpenChange, event, amount, onStart, loading }) {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", isInterestedInInvoice: true });
  useEffect(() => { if (open) { const contact = event?.parents?.[0] || {}; setForm({ fullName: contact.name || event?.family_name || "", phone: contact.phone || "", email: contact.email || "", isInterestedInInvoice: true }); } }, [open, event?.id]);
  const submit = () => onStart(form);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>פתיחת תשלום בכרטיס</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-gray-600">סכום התשלום: ₪{Number(amount || 0).toLocaleString()}</p><div><Label htmlFor="payer-name">שם מלא</Label><Input id="payer-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div><div><Label htmlFor="payer-phone">טלפון</Label><Input id="payer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div><div><Label htmlFor="payer-email">אימייל</Label><Input id="payer-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div><label className="flex items-center gap-2"><Checkbox checked={form.isInterestedInInvoice} onCheckedChange={(value) => setForm({ ...form, isInterestedInInvoice: value === true })} /><span className="text-sm">שלח חשבונית/קבלה לאחר תשלום</span></label></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>ביטול</Button><Button onClick={submit} disabled={loading || !form.fullName || !form.phone}>{loading ? "פותח תשלום..." : "המשך לתשלום מאובטח"}</Button></DialogFooter></DialogContent></Dialog>;
}