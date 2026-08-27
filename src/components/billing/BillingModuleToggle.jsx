import React from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function BillingModuleToggle({ enabled, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor="billing_enabled" className="font-semibold">חיוב, סליקה וחשבוניות</Label>
        <p className="text-xs text-gray-500 mt-1">כאשר כבוי, כל אפשרויות החיוב והסליקה מוסתרות מהמערכת.</p>
      </div>
      <Switch id="billing_enabled" checked={enabled} onCheckedChange={onChange} />
    </div>
  );
}