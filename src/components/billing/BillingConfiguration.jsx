import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save } from "lucide-react";
import BillingDocumentDefaults from "@/components/billing/BillingDocumentDefaults";
import BillingClearingRules from "@/components/billing/BillingClearingRules";

const defaults = { invoice4u_env: "qa", invoice4u_branch_id: "", default_document_type: "invoice_receipt", default_language: "he", default_tax_included: "true", default_subject: "", default_email_comment: "", owner_copy_email: "", processing_fee_enabled: "false", processing_fee_type: "percent", processing_fee_value: "0", processing_fee_label: "עמלת סליקה", default_advance_amount: "2500", client_clearing_allowed: "false", manual_payment_invoice_enabled: "false" };

export default function BillingConfiguration() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const { data: records = [] } = useQuery({ queryKey: ["appSettings"], queryFn: () => base44.entities.AppSettings.list() });
  const settings = useMemo(() => records.reduce((all, record) => ({ ...all, [record.setting_key]: record.setting_value }), defaults), [records]);
  const change = (key, value) => queryClient.setQueryData(["appSettings"], (current = []) => {
    const found = current.find((record) => record.setting_key === key);
    return found ? current.map((record) => record.id === found.id ? { ...record, setting_value: value } : record) : [...current, { setting_key: key, setting_value: value }];
  });
  const save = async () => { setSaving(true); try { await Promise.all(Object.entries(settings).filter(([key]) => key in defaults).map(([key, value]) => { const record = records.find((item) => item.setting_key === key); return record ? base44.entities.AppSettings.update(record.id, { setting_value: value }) : base44.entities.AppSettings.create({ setting_key: key, setting_value: value }); })); queryClient.invalidateQueries({ queryKey: ["appSettings"] }); } finally { setSaving(false); } };
  return <Card className="bg-white/95"><CardHeader><CardTitle>הגדרות חיוב וסליקה</CardTitle></CardHeader><CardContent className="space-y-5"><BillingDocumentDefaults settings={settings} onChange={change} /><BillingClearingRules settings={settings} onChange={change} /><Button onClick={save} disabled={saving}>{saving ? "שומר..." : <><Save className="ml-2 h-4 w-4" />שמור הגדרות חיוב</>}</Button></CardContent></Card>;
}