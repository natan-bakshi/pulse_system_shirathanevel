import React from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {useLanguage} from '@/i18n/LanguageProvider';

export default function BillingModuleToggle({ enabled, onChange }) {
  const {t: uiTranslate}=useLanguage();
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor="billing_enabled" className="font-semibold">{uiTranslate("חיוב, סליקה וחשבוניות")}</Label>
        <p className="text-xs text-gray-500 mt-1">{uiTranslate("כאשר כבוי, כל אפשרויות החיוב והסליקה מוסתרות מהמערכת.")}</p>
      </div>
      <Switch id="billing_enabled" checked={enabled} onCheckedChange={onChange} />
    </div>
  );
}