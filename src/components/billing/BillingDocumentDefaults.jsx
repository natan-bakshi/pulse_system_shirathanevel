import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function BillingDocumentDefaults({ settings, onChange }) {
  return (
    <section className="space-y-4 border-t pt-5">
      <h3 className="font-semibold">ברירות מחדל למסמך</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label>סוג מסמך ברירת מחדל</Label><Select value={settings.default_document_type} onValueChange={(value) => onChange("default_document_type", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="invoice_receipt">חשבונית מס/קבלה</SelectItem><SelectItem value="receipt">קבלה</SelectItem></SelectContent></Select></div>
        <div><Label>שפת מסמך</Label><Select value={settings.default_language} onValueChange={(value) => onChange("default_language", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="he">עברית</SelectItem><SelectItem value="en">אנגלית</SelectItem></SelectContent></Select></div>
        <div><Label htmlFor="default_subject">נושא מסמך</Label><Input id="default_subject" value={settings.default_subject} onChange={(e) => onChange("default_subject", e.target.value)} placeholder="אופציונלי" /></div>
        <div><Label htmlFor="owner_copy_email">מייל להעתק</Label><Input id="owner_copy_email" type="email" dir="ltr" value={settings.owner_copy_email} onChange={(e) => onChange("owner_copy_email", e.target.value)} placeholder="אופציונלי" /></div>
      </div>
      <div className="flex items-center justify-between"><Label htmlFor="default_tax_included">המחירים כוללים מע״מ כברירת מחדל</Label><Switch id="default_tax_included" checked={settings.default_tax_included === "true"} onCheckedChange={(value) => onChange("default_tax_included", value ? "true" : "false")} /></div>
    </section>
  );
}