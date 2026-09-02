import React from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// תבניות ההודעה הנשלחת ללקוח יחד עם קישור דרישת התשלום - בעברית ובאנגלית.
export default function BillingPaymentLinkSettings({ settings, onChange }) {
  return (
    <div className="space-y-4 border-t border-gray-200 pt-4">
      <div className="space-y-2">
        <Label className="font-semibold">הודעת דרישת תשלום בקישור (עברית)</Label>
        <p className="text-xs text-gray-500">משתנים זמינים: {"{{name}}"}, {"{{business_name}}"}, {"{{description}}"}, {"{{amount}}"}, {"{{link}}"}. אם יישאר ריק - תישלח הודעת ברירת המחדל.</p>
        <Textarea rows={6} value={settings.payment_link_message_template || ""} onChange={(event) => onChange("payment_link_message_template", event.target.value)} placeholder={"שלום {{name}},\nהתקבלה עבורך דרישת תשלום מ{{business_name}}.\n\n{{description}}\nסכום לתשלום: {{amount}}\n\nלתשלום מאובטח:\n{{link}}"} />
      </div>
      <div className="space-y-2">
        <Label className="font-semibold">Payment request message (English)</Label>
        <p className="text-xs text-gray-500">נשלחת כאשר נבחרה אנגלית בדיאלוג הסליקה. אם תישאר ריקה - תישלח הודעת ברירת המחדל באנגלית.</p>
        <Textarea dir="ltr" rows={6} value={settings.payment_link_message_template_en || ""} onChange={(event) => onChange("payment_link_message_template_en", event.target.value)} placeholder={"Hello {{name}},\nYou have received a payment request from {{business_name}}.\n\n{{description}}\nAmount due: {{amount}}\n\nPay securely:\n{{link}}"} />
      </div>
    </div>
  );
}