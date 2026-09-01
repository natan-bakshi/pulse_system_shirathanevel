import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// פרטי העסק המשמשים כפרטי מנפיק במסמכים פיננסיים.
export default function BusinessDetailsFields({ settings, onChange }) {
  return (
    <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="business_tax_id">ח.פ. / מספר עוסק</Label>
        <Input id="business_tax_id" dir="ltr" value={settings.business_tax_id || ""} onChange={(e) => onChange("business_tax_id", e.target.value)} placeholder="לדוגמה: 123456789" />
      </div>
      <div>
        <Label htmlFor="business_phone">טלפון העסק</Label>
        <Input id="business_phone" dir="ltr" value={settings.business_phone || ""} onChange={(e) => onChange("business_phone", e.target.value)} />
      </div>
      <div>
        <Label htmlFor="business_address">כתובת העסק</Label>
        <Input id="business_address" value={settings.business_address || ""} onChange={(e) => onChange("business_address", e.target.value)} />
      </div>
      <div>
        <Label htmlFor="business_email">מייל העסק</Label>
        <Input id="business_email" type="email" dir="ltr" value={settings.business_email || ""} onChange={(e) => onChange("business_email", e.target.value)} />
      </div>
      <p className="text-xs text-gray-500 sm:col-span-2">פרטים אלו משמשים כפרטי המנפיק במסמכים פיננסיים, במידה ואינם מוגדרים בחשבון Invoice4U.</p>
    </div>
  );
}