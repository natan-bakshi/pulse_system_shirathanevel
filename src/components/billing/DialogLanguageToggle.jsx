import React from "react";
import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";
import { billingText } from "@/components/billing/billingI18n";

// מחליף את שפת הדיאלוג והמסמך שיופק (עברית / אנגלית). ברירת המחדל היא עברית.
export default function DialogLanguageToggle({ lang = "he", onChange }) {
  const text = billingText(lang);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      onClick={() => onChange(lang === "he" ? "en" : "he")}
      title={lang === "he" ? "Switch document language to English" : "החלף את שפת המסמך לעברית"}
    >
      <Languages className="h-3.5 w-3.5" />
      {text.switchTo}
    </Button>
  );
}