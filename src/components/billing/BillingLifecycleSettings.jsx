import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// הגדרות מחזור החיים של דרישות תשלום בקישור ואישורי תשלום ללקוח.
export default function BillingLifecycleSettings({ settings, onChange }) {
  const receiptEnabled = settings.client_payment_receipt_enabled === "true";
  const reminderDays = Number(settings.payment_link_reminder_days) || 0;

  return (
    <section className="space-y-4 border-t border-gray-200 pt-5">
      <h3 className="font-semibold">מחזור חיים של דרישות תשלום</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="payment_link_expiry_days">תפוגת קישור תשלום (ימים)</Label>
          <Input id="payment_link_expiry_days" type="number" min="0" value={settings.payment_link_expiry_days} onChange={(event) => onChange("payment_link_expiry_days", event.target.value)} />
          <p className="mt-1 text-xs text-gray-500">דרישה שלא שולמה עד אז תבוטל אוטומטית. 0 = ללא תפוגה.</p>
        </div>
        <div>
          <Label htmlFor="payment_link_reminder_days">תזכורת ללקוח (ימים לפני התפוגה)</Label>
          <Input id="payment_link_reminder_days" type="number" min="0" value={settings.payment_link_reminder_days} onChange={(event) => onChange("payment_link_reminder_days", event.target.value)} />
          <p className="mt-1 text-xs text-gray-500">0 = ללא תזכורת. נשלחת פעם אחת בוואטסאפ (ובהיעדר טלפון - במייל).</p>
        </div>
      </div>

      {reminderDays > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-gray-500">תבנית תזכורת (עברית)</Label>
            <Textarea rows={4} value={settings.payment_link_reminder_template || ""} onChange={(event) => onChange("payment_link_reminder_template", event.target.value)} placeholder={"משתנים: {{name}}, {{business_name}}, {{amount}}, {{expiry_date}}, {{link}}"} />
          </div>
          <div>
            <Label className="text-xs text-gray-500">Reminder template (English)</Label>
            <Textarea dir="ltr" rows={4} value={settings.payment_link_reminder_template_en || ""} onChange={(event) => onChange("payment_link_reminder_template_en", event.target.value)} placeholder={"Variables: {{name}}, {{business_name}}, {{amount}}, {{expiry_date}}, {{link}}"} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="client_payment_receipt_enabled">שלח אישור תשלום ללקוח</Label>
          <p className="mt-1 text-xs text-gray-500">מיד לאחר סליקה מוצלחת, כולל קישור לקבלה שהופקה.</p>
        </div>
        <Switch id="client_payment_receipt_enabled" checked={receiptEnabled} onCheckedChange={(value) => onChange("client_payment_receipt_enabled", value ? "true" : "false")} />
      </div>

      {receiptEnabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-gray-500">תבנית אישור תשלום (עברית)</Label>
            <Textarea rows={4} value={settings.payment_receipt_message_template || ""} onChange={(event) => onChange("payment_receipt_message_template", event.target.value)} placeholder={"משתנים: {{name}}, {{business_name}}, {{amount}}, {{document_url}}"} />
          </div>
          <div>
            <Label className="text-xs text-gray-500">Payment confirmation (English)</Label>
            <Textarea dir="ltr" rows={4} value={settings.payment_receipt_message_template_en || ""} onChange={(event) => onChange("payment_receipt_message_template_en", event.target.value)} placeholder={"Variables: {{name}}, {{business_name}}, {{amount}}, {{document_url}}"} />
          </div>
        </div>
      )}
    </section>
  );
}