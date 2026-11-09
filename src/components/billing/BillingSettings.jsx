import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard } from "lucide-react";
import BillingModuleToggle from "@/components/billing/BillingModuleToggle";
import {useLanguage} from '@/i18n/LanguageProvider';

export default function BillingSettings({ settings, onChange }) {
  const {t: uiTranslate}=useLanguage();
  const enabled = settings.billing_enabled === "true";
  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" />{uiTranslate("הגדרות חיוב וסליקה")}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <BillingModuleToggle enabled={enabled} onChange={(value) => onChange("billing_enabled", value ? "true" : "false")} />
        {enabled ? <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{uiTranslate("לאחר שמירת ההפעלה, הגדרות המסמכים, העמלות וההרשאות זמינות בלשונית „תשלומים וחשבוניות״.")}</p> : <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{uiTranslate("מודול החיוב כבוי. הפעל אותו כדי להציג את לשונית התשלומים והחשבוניות למנהלים.")}</p>}
      </CardContent>
    </Card>
  );
}