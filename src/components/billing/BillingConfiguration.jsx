import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save } from "lucide-react";
import BillingDocumentDefaults from "@/components/billing/BillingDocumentDefaults";
import BillingClearingRules from "@/components/billing/BillingClearingRules";
import BillingPaymentLinkSettings from "@/components/billing/BillingPaymentLinkSettings";

const defaults = { invoice4u_env: "qa", invoice4u_branch_id: "", invoice4u_clearing_company_type: "", default_document_type: "invoice_receipt", default_language: "he", default_tax_included: "true", default_subject: "", default_email_comment: "", owner_copy_email: "", processing_fee_enabled: "false", processing_fee_type: "percent", processing_fee_value: "0", processing_fee_label: "עמלת סליקה", default_advance_amount: "2500", client_clearing_allowed: "false", manual_payment_invoice_enabled: "false", payment_link_message_template: "" };

export default function BillingConfiguration() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  // draft מחזיק רק את השינויים שטרם נשמרו, כדי שלא נדרוס רשומות אחרות במטמון.
  const [draft, setDraft] = useState({});
  const { data: records = [] } = useQuery({ queryKey: ["appSettings"], queryFn: () => base44.entities.AppSettings.list() });
  const stored = useMemo(() => records.reduce((all, record) => ({ ...all, [record.setting_key]: record.setting_value }), {}), [records]);
  const settings = useMemo(() => ({ ...defaults, ...stored, ...draft }), [stored, draft]);
  const change = (key, value) => { setSavedAt(null); setDraft((current) => ({ ...current, [key]: value })); };

  const save = async () => {
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