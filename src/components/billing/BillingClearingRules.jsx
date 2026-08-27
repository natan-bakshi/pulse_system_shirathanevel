import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function BillingClearingRules({ settings, onChange }) {
  const feeEnabled = settings.processing_fee_enabled === "true";
  return (
    <section className="space-y-4 border-t pt-5">
      <h3 className="font-semibold">עמלות, מקדמות והרשאות</h3>
      <div className="flex items-center justify-between"><div><Label htmlFor="processing_fee_enabled">הוספת עמלת סליקה</Label><p className="text-xs text-gray-500 mt-1">העמלה תוצג לפני התשלום ותתווסף כשורה במסמך.</p></div><Switch id="processing_fee_enabled" checked={feeEnabled} onCheckedChange={(value) => onChange("processing_fee_enabled", value ? "true" : "false")} /></div>
      {feeEnabled && <div className="grid gap-4 sm:grid-cols-3"><div><Label>סוג עמלה</Label><Select value={settings.processing_fee_type} onValueChange={(value) => onChange("processing_fee_type", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percent">אחוזים</SelectItem><SelectItem value="fixed">סכום קבוע</SelectItem></SelectContent></Select></div><div><Label htmlFor="processing_fee_value">ערך עמלה</Label><Input id="processing_fee_value" type="number" min="0" step="0.01" value={settings.processing_fee_value} onChange={(e) => onChange("processing_fee_value", e.target.value)} /></div><div><Label htmlFor="processing_fee_label">תווית במסמך</Label><Input id="processing_fee_label" value={settings.processing_fee_label} onChange={(e) => onChange("processing_fee_label", e.target.value)} /></div></div>}
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="default_advance_amount">סכום מקדמה מינימלי</Label><Input id="default_advance_amount" type="number" min="0" value={settings.default_advance_amount} onChange={(e) => onChange("default_advance_amount", e.target.value)} /><p className="text-xs text-gray-500 mt-1">המערכת תשווה גם ל־20% מהיתרה ותבחר בגבוה מביניהם.</p></div><div><Label>סביבת Invoice4U</Label><Select value={settings.invoice4u_env} onValueChange={(value) => onChange("invoice4u_env", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="qa">בדיקות (QA)</SelectItem><SelectItem value="production">ייצור</SelectItem></SelectContent></Select></div></div>
      <div className="flex items-center justify-between"><div><Label htmlFor="client_clearing_allowed">אפשר סליקה ללקוחות</Label><p className="text-xs text-gray-500 mt-1">כאשר כבוי, רק מנהלים יוכלו לפתוח תשלום.</p></div><Switch id="client_clearing_allowed" checked={settings.client_clearing_allowed === "true"} onCheckedChange={(value) => onChange("client_clearing_allowed", value ? "true" : "false")} /></div>
      <div className="flex items-center justify-between"><div><Label htmlFor="manual_payment_invoice_enabled">הצע הפקת מסמך לתשלום ידני</Label><p className="text-xs text-gray-500 mt-1">לתשלומי מזומן, העברה בנקאית וצ׳קים שנוספו למערכת.</p></div><Switch id="manual_payment_invoice_enabled" checked={settings.manual_payment_invoice_enabled === "true"} onCheckedChange={(value) => onChange("manual_payment_invoice_enabled", value ? "true" : "false")} /></div>
    </section>
  );
}