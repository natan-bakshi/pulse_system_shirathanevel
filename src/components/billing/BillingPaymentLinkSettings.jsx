import React from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// תבנית ההודעה הנשלחת ללקוח יחד עם קישור דרישת התשלום.
export default function BillingPaymentLinkSettings({ settings, onChange }) {
  return (
    <div className="space-y-2 border-t border-gray-200 pt-4">
      <Label className="font-semibold">הודעת דרישת תשלום בקישור</Label>
      <p className="text-xs text-gray-500">משתנים זמינים: {"{{name}}"}, {"{{business_name}}"}, {"{{description}}"}, {"{{amount}}"}, {"{{link}}"}. אם יישאר ריק - תישלח הודעת ברירת המחדל.</p>
      <Textarea rows={6} value={settings.payment_link_message_template || ""} onChange={(event) => onChange("payment_link_message_template", event.target.value)} placeholder={"שלום {{name}},\nהתקבלה עבורך דרישת תשלום מ{{business_name}}.\n\n{{description}}\nסכום לתשלום: {{amount}}\n\nלתשלום מאובטח:\n{{link}}"} />
    </div>
  );
}