import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {useLanguage} from '@/i18n/LanguageProvider';
import {customerMessageDefaults} from '../../../base44/shared/customerMessageTone.ts';

// הגדרות מחזור החיים של דרישות תשלום בקישור ואישורי תשלום ללקוח.
export default function BillingLifecycleSettings({ settings, onChange }) {
  const {t: uiTranslate}=useLanguage();
  const receiptEnabled = settings.client_payment_receipt_enabled !== "false";
  const reminderDays = Number(settings.payment_link_reminder_days) || 0;

  return (
    <section className="space-y-4 border-t border-gray-200 pt-5">
      <h3 className="font-semibold">{uiTranslate("מחזור חיים של דרישות תשלום")}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="payment_link_expiry_days">{uiTranslate("תפוגת קישור תשלום (ימים)")}</Label>
          <Input id="payment_link_expiry_days" type="number" min="0" value={settings.payment_link_expiry_days} onChange={(event) => onChange("payment_link_expiry_days", event.target.value)} />
          <p className="mt-1 text-xs text-gray-500">{uiTranslate("דרישה שלא שולמה עד אז תבוטל אוטומטית. 0 = ללא תפוגה.")}</p>
        </div>
        <div>
          <Label htmlFor="payment_link_reminder_days">{uiTranslate("תזכורת ללקוח (ימים לפני התפוגה)")}</Label>
          <Input id="payment_link_reminder_days" type="number" min="0" value={settings.payment_link_reminder_days} onChange={(event) => onChange("payment_link_reminder_days", event.target.value)} />
          <p className="mt-1 text-xs text-gray-500">{uiTranslate("0 = ללא תזכורת. נשלחת פעם אחת בוואטסאפ (ובהיעדר טלפון - במייל).")}</p>
        </div>
      </div>

      {reminderDays > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-gray-500">{uiTranslate("תבנית תזכורת (עברית)")}</Label>
            <Textarea rows={4} value={settings.payment_link_reminder_template || ""} onChange={(event) => onChange("payment_link_reminder_template", event.target.value)} placeholder={customerMessageDefaults.reminder.he} />
          </div>
          <div>
            <Label className="text-xs text-gray-500">Reminder template (English)</Label>
            <Textarea dir="ltr" rows={4} value={settings.payment_link_reminder_template_en || ""} onChange={(event) => onChange("payment_link_reminder_template_en", event.target.value)} placeholder={customerMessageDefaults.reminder.en} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="client_payment_receipt_enabled">{uiTranslate("שלח אישור תשלום ללקוח")}</Label>
          <p className="mt-1 text-xs text-gray-500">{uiTranslate("מיד לאחר סליקה מוצלחת, כולל קישור לקבלה שהופקה.")}</p>
        </div>
        <Switch id="client_payment_receipt_enabled" checked={receiptEnabled} onCheckedChange={(value) => onChange("client_payment_receipt_enabled", value ? "true" : "false")} />
      </div>

      {receiptEnabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-gray-500">{uiTranslate("תבנית אישור תשלום (עברית)")}</Label>
            <Textarea rows={4} value={settings.payment_receipt_message_template || ""} onChange={(event) => onChange("payment_receipt_message_template", event.target.value)} placeholder={customerMessageDefaults.receipt.he} />
          </div>
          <div>
            <Label className="text-xs text-gray-500">Payment confirmation (English)</Label>
            <Textarea dir="ltr" rows={4} value={settings.payment_receipt_message_template_en || ""} onChange={(event) => onChange("payment_receipt_message_template_en", event.target.value)} placeholder={customerMessageDefaults.receipt.en} />
          </div>
        </div>
      )}
    </section>
  );
}