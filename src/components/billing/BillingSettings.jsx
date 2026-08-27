import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard } from "lucide-react";
import BillingModuleToggle from "@/components/billing/BillingModuleToggle";
import BillingDocumentDefaults from "@/components/billing/BillingDocumentDefaults";
import BillingClearingRules from "@/components/billing/BillingClearingRules";

export default function BillingSettings({ settings, onChange }) {
  const enabled = settings.billing_enabled === "true";
  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" />הגדרות חיוב וסליקה</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <BillingModuleToggle enabled={enabled} onChange={(value) => onChange("billing_enabled", value ? "true" : "false")} />
        {enabled ? <><BillingDocumentDefaults settings={settings} onChange={onChange} /><BillingClearingRules settings={settings} onChange={onChange} /></> : <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">מודול החיוב כבוי. הפעל אותו כדי להגדיר סליקה, מסמכים והרשאות.</p>}
      </CardContent>
    </Card>
  );
}