import React from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {useLanguage} from '@/i18n/LanguageProvider';
import {customerMessageDefaults} from '../../../base44/shared/customerMessageTone.ts';

// תבניות ההודעה הנשלחת ללקוח יחד עם קישור דרישת התשלום - בעברית ובאנגלית.
export default function BillingPaymentLinkSettings({ settings, onChange }) {
  const {t: uiTranslate}=useLanguage();
  return (
    <div className="space-y-4 border-t border-gray-200 pt-4">
      <div className="space-y-2">
        <Label className="font-semibold">{uiTranslate("הודעת קישור לתשלום (עברית)")}</Label>
        <p className="text-xs text-gray-500">{uiTranslate("משתנים זמינים:")} {"{{name}}"}, {"{{business_name}}"}, {"{{description}}"}, {"{{amount}}"}, {"{{link}}"}{uiTranslate(". אם יישאר ריק - תישלח הודעת ברירת המחדל.")}</p>
        <Textarea rows={6} value={settings.payment_link_message_template || ""} onChange={(event) => onChange("payment_link_message_template", event.target.value)} placeholder={customerMessageDefaults.payment_link.he} />
      </div>
      <div className="space-y-2">
        <Label className="font-semibold">Payment link message (English)</Label>
        <p className="text-xs text-gray-500">{uiTranslate("נשלחת כאשר נבחרה אנגלית בדיאלוג הסליקה. אם תישאר ריקה - תישלח הודעת ברירת המחדל באנגלית.")}</p>
        <Textarea dir="ltr" rows={6} value={settings.payment_link_message_template_en || ""} onChange={(event) => onChange("payment_link_message_template_en", event.target.value)} placeholder={customerMessageDefaults.payment_link.en} />
      </div>
    </div>
  );
}