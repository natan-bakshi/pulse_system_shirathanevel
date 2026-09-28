import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save } from "lucide-react";
import BillingDocumentDefaults from "@/components/billing/BillingDocumentDefaults";
import BillingClearingRules from "@/components/billing/BillingClearingRules";
import BillingPaymentLinkSettings from "@/components/billing/BillingPaymentLinkSettings";
import BillingLifecycleSettings from "@/components/billing/BillingLifecycleSettings";
import { StoredCardSettings } from "@/components/billing/StoredCards";

import ClosingSettings, { closingDefaults } from "./ClosingSettings";

const defaults = { billing_fallback_email: "", ...closingDefaults, stored_cards_enabled: "false", stored_cards_env: "qa", stored_cards_cleanup: "off", invoice4u_env: "qa", invoice4u_branch_id: "", invoice4u_clearing_company_type: "", default_document_type: "invoice_receipt", default_language: "he", default_tax_included: "true", default_subject: "", default_subject_en: "", default_email_comment: "", owner_copy_email: "", processing_fee_enabled: "false", processing_fee_type: "percent", processing_fee_value: "0", processing_fee_label: "עמלת סליקה", default_advance_amount: "2500", default_advance_percent: "20", client_clearing_allowed: "false", manual_payment_invoice_enabled: "false", payment_link_message_template: "", payment_link_message_template_en: "", processing_fee_label_en: "Processing fee", default_email_comment_en: "", payment_link_expiry_days: "14", payment_link_reminder_days: "3", client_payment_receipt_enabled: "false", payment_receipt_message_template: "", payment_receipt_message_template_en: "", payment_link_reminder_template: "", payment_link_reminder_template_en: "" };

export default function BillingConfiguration() {
  const queryClient = useQueryClient();
  const [saveError,setSaveError]=useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  // draft מחזיק רק את השינויים שטרם נשמרו, כדי שלא נדרוס רשומות אחרות במטמון.
  const [draft, setDraft] = useState({});
  const { data: records = [] } = useQuery({ queryKey: ["appSettings"], queryFn: () => base44.entities.AppSettings.list() });
  const stored = useMemo(() => records.reduce((all, record) => ({ ...all, [record.setting_key]: record.setting_value }), {}), [records]);
  const settings = useMemo(() => ({ ...defaults, ...stored, ...draft }), [stored, draft]);
  const change = (key, value) => { setSavedAt(null); setDraft((current) => ({ ...current, [key]: value })); };

  const save = async () => {
    setSaveError("");
    const email=String(settings.billing_fallback_email||"").trim();
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setSaveError("כתובת מייל החברה אינה תקינה");return;}
    setSaving(true);
    try {
      const entries = Object.entries(draft).filter(([key]) => key in defaults);
      for (const [key, value] of entries) {
        const record = records.find((item) => item.setting_key === key);
        if (record?.id) await base44.entities.AppSettings.update(record.id, { setting_value: value });
        else await base44.entities.AppSettings.create({ setting_key: key, setting_value: value });
      }
      await queryClient.invalidateQueries({ queryKey: ["appSettings"] });
      setDraft({});
      setSavedAt(new Date());
    } finally { setSaving(false); }
  };

  return (
    <Card className="bg-white/95">
      <CardHeader><CardTitle>הגדרות חיוב וסליקה</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <BillingDocumentDefaults settings={settings} onChange={change} />
        <BillingClearingRules settings={settings} onChange={change} />
        <BillingPaymentLinkSettings settings={settings} onChange={change} />
        <BillingLifecycleSettings settings={settings} onChange={change} />
        <label className="block space-y-2"><span className="font-semibold">מייל החברה כברירת מחדל לסליקה</span><input type="email" dir="ltr" className="block w-full rounded-md border p-2" value={settings.billing_fallback_email} onChange={e=>change("billing_fallback_email",e.target.value.trim())}/><span className="block text-sm text-gray-600">ישמש רק כשאין מייל ללקוח. הודעות הספק עשויות להגיע לכתובת זו. אינו משנה את המייל בכרטיס הלקוח.</span></label>
        {saveError&&<p role="alert" className="text-red-700">{saveError}</p>}
        <StoredCardSettings settings={settings} onChange={change} />
        <ClosingSettings settings={settings} onChange={change} />
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || !Object.keys(draft).length}>
            {saving ? "שומר..." : <><Save className="ml-2 h-4 w-4" />שמור הגדרות חיוב</>}
          </Button>
          {Object.keys(draft).length > 0 && <span className="text-xs text-amber-600">יש שינויים שלא נשמרו</span>}
          {savedAt && !Object.keys(draft).length && <span className="text-xs text-green-600">ההגדרות נשמרו</span>}
        </div>
      </CardContent>
    </Card>
  );
}