import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import ClosingLinkedField from "./ClosingLinkedField";

const fields = [
  ["closing_terms_text", "תנאי ההתקשרות", "Terms of engagement", true],
  ["closing_regular_text", "הרשאה לגבייה רגילה", "Regular card authorization", true],
  ["closing_exceptional_text", "הרשאה לגבייה חריגה", "Exceptional charges authorization", true],
  ["closing_changes_text", "שינויים מוסכמים", "Agreed changes", true],
  ["closing_message_template", "תוכן התזכורת", "Payment reminder"],
  ["closing_invitation_template", "הזמנה לחתימה", "Invitation to sign"],
  ["closing_otp_template", "הודעת קוד אימות", "Verification code"],
  ["closing_signed_template", "כותרת עותק חתום", "Signed copy title"],
];

export default function ClosingLanguageFields({ settings, onChange }) {
  const [language, setLanguage] = useState("he");
  const english = language === "en";
  return <div className="space-y-4 border-t pt-4">
    <div className="flex items-center gap-3">
      <span className={!english ? "font-semibold" : "text-gray-500"}>עברית</span>
      <Switch aria-label="החלפת שפת עריכת נוסח הסגירה" checked={english} onCheckedChange={checked => setLanguage(checked ? "en" : "he")} />
      <span className={english ? "font-semibold" : "text-gray-500"}>English</span>
    </div>
    <p className="text-sm text-gray-600">המתג משנה רק את שפת העריכה כאן; שפת הטופס וההודעות כברירת מחדל נקבעת בבחירות שלמעלה. כל נוסח נשמר בנפרד בלחיצה על „שמור הגדרות חיוב”.</p>
    <p className="text-sm text-gray-600">תנאי ההתקשרות הם נוסח ההסכם; הרשאות הגבייה והשינויים הם סעיפים שהלקוח מאשר; התזכורת, ההזמנה וקוד האימות הם הודעות ללקוח; כותרת העותק החתום מופיעה בהודעה המצורפת למסמך.</p>
    <p className="text-sm text-gray-600">{english ? "English terms must be reviewed and saved before the English form can be used." : "אם תנאי ההתקשרות בעברית ריקים, תוצג תבנית ההסכם הקיימת."}</p>
    {fields.map(([base, heLabel, enLabel, linked]) => {
      const key = base + (english ? "_en" : "");
      const label = english ? enLabel : heLabel;
      const value = settings[key] || "";
      return linked
        ? <ClosingLinkedField key={key} label={label} dir={english ? "ltr" : "rtl"} value={value} onChange={v => onChange(key, v)} />
        : <label key={key} className="block">{label}<textarea dir={english ? "ltr" : "rtl"} rows={3} className="block w-full border rounded p-2 bg-white mt-1" value={value} onChange={e => onChange(key, e.target.value)} /></label>;
    })}
    <p className="text-xs break-words">משתני תזכורת: {"{{customer_name}}, {{event_name}}, {{amount}}, {{currency}}, {{due_date}}, {{business_phone}}"}</p>
    <p className="text-xs break-words">משתני הודעות: {"{{customer_name}}, {{event_name}}, {{link}}, {{code}}"}</p>
  </div>;
}