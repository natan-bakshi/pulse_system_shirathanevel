import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, Loader2, Info, Calendar } from "lucide-react";

// Available template variables with Hebrew descriptions
const TEMPLATE_VARIABLES = [
  { key: '{{event_type_hebrew}}', desc: 'סוג האירוע (בר מצווה, בת מצווה, חתונה, אירוע)' },
  { key: '{{event_name}}', desc: 'שם האירוע' },
  { key: '{{child_name}}', desc: 'שם הילד/ה' },
  { key: '{{family_name}}', desc: 'שם המשפחה' },
  { key: '{{concept}}', desc: 'קונספט האירוע' },
  { key: '{{guest_count}}', desc: 'מספר אורחים' },
  { key: '{{notes}}', desc: 'הערות כלליות מהאירוע' },
  { key: '{{schedule_text}}', desc: 'לו"ז האירוע מעוצב' },
  { key: '{{company_name}}', desc: 'שם החברה (מהגדרות)' },
  { key: '{{app_link}}', desc: 'לינק למערכת' },
];

const SUPPLIER_ONLY_VARIABLES = [
  { key: '{{service_name}}', desc: 'שם השירות של הספק' },
  { key: '{{supplier_note}}', desc: 'הערה ספציפית לספק' },
];

const ADMIN_ONLY_VARIABLES = [
  { key: '{{suppliers_list}}', desc: 'רשימת ספקים מאושרים לפי קטגוריות שירות נבחרות' },
];

// Default templates
const DEFAULT_TEMPLATES = {
  admin: {
    summary: '{{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}[[, בקונספט {{concept}}]]',
    description: '{{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}[[, בקונספט {{concept}}]].\n[[מספר אורחים: {{guest_count}}]]\n[[הערות: {{notes}}]]\n[[לו"ז האירוע:\n{{schedule_text}}]]\n[[ספקים משויכים:\n{{suppliers_list}}]]\n[[לינק למערכת: {{app_link}}]]'
  },
  supplier: {
    summary: 'אירוע {{event_type_hebrew}} עם {{company_name}}, {{service_name}}. [[הערה עבורך: ({{supplier_note}})]]',
    description: 'אירוע {{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}.\n[[בקונספט: {{concept}}.]]\n[[לו"ז האירוע:\n{{schedule_text}}]]\n[[לינק למערכת: {{app_link}}]]'
  },
  client: {
    summary: '{{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}[[, בקונספט {{concept}}]]',
    description: 'אירוע {{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}[[, בקונספט {{concept}}]].\n[[הערות: {{notes}}]]\n[[לינק למערכת: {{app_link}}]]'
  }
};

const SETTING_KEYS = [
  'google_calendar_admin_summary_template',
  'google_calendar_admin_description_template',
  'google_calendar_supplier_summary_template',
  'google_calendar_supplier_description_template',
  'google_calendar_client_summary_template',
  'google_calendar_client_description_template',
  'google_calendar_admin_supplier_categories',
];

const USER_TYPE_LABELS = {
  admin: 'מנהל',
  supplier: 'ספק',
  client: 'לקוח'
};

export default function CalendarTemplateSettings() {
  const [selectedUserType, setSelectedUserType] = useState('admin');
  const [templates, setTemplates] = useState({});
  const [supplierCategories, setSupplierCategories] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const { data: appSettings = [] } = useQuery({
    queryKey: ['appSettings'],
    queryFn: () => base44.entities.AppSettings.list(),
    staleTime: 10 * 60 * 1000,
  });

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => base44.entities.Service.list(),
    staleTime: 5 * 60 * 1000,
  });

  // Load templates from settings
  useEffect(() => {
    if (appSettings.length > 0) {
      const settingsMap = appSettings.reduce((acc, s) => { acc[s.setting_key] = s.setting_value; return acc; }, {});
      
      const loaded = {};
      for (const type of ['admin', 'supplier', 'client']) {
        loaded[`${type}_summary`] = settingsMap[`google_calendar_${type}_summary_template`] || DEFAULT_TEMPLATES[type].summary;
        loaded[`${type}_description`] = settingsMap[`google_calendar_${type}_description_template`] || DEFAULT_TEMPLATES[type].description;
      }
      setTemplates(loaded);

      // Load supplier categories
      const cats = settingsMap.google_calendar_admin_supplier_categories;
      if (cats) {
        try { setSupplierCategories(JSON.parse(cats)); } catch { setSupplierCategories([]); }
      }
    }
  }, [appSettings]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const existingSettings = await base44.entities.AppSettings.list();
      const promises = [];

      // Save templates
      for (const type of ['admin', 'supplier', 'client']) {
        for (const field of ['summary', 'description']) {
          const key = `google_calendar_${type}_${field}_template`;
          const value = templates[`${type}_${field}`] || DEFAULT_TEMPLATES[type][field];
          const existing = existingSettings.find(s => s.setting_key === key);
          if (existing) {
            if (existing.setting_value !== value) {
              promises.push(base44.entities.AppSettings.update(existing.id, { setting_value: value }));
            }
          } else {
            promises.push(base44.entities.AppSettings.create({ setting_key: key, setting_value: value }));
          }
        }
      }

      // Save supplier categories
      const catKey = 'google_calendar_admin_supplier_categories';
      const catValue = JSON.stringify(supplierCategories);
      const existingCat = existingSettings.find(s => s.setting_key === catKey);
      if (existingCat) {
        if (existingCat.setting_value !== catValue) {
          promises.push(base44.entities.AppSettings.update(existingCat.id, { setting_value: catValue }));
        }
      } else {
        promises.push(base44.entities.AppSettings.create({ setting_key: catKey, setting_value: catValue }));
      }

      await Promise.all(promises);
      queryClient.invalidateQueries({ queryKey: ['appSettings'] });
      alert("תבניות היומן נשמרו בהצלחה!");
    } catch (error) {
      console.error("Failed to save templates:", error);
      alert("שגיאה בשמירת התבניות.");
    } finally {
      setIsSaving(false);
    }
  }, [templates, supplierCategories, queryClient]);

  const toggleServiceCategory = useCallback((serviceName) => {
    setSupplierCategories(prev => 
      prev.includes(serviceName)
        ? prev.filter(s => s !== serviceName)
        : [...prev, serviceName]
    );
  }, []);

  const resetToDefault = useCallback(() => {
    if (!window.confirm('לאפס את התבניות לברירת מחדל?')) return;
    const type = selectedUserType;
    setTemplates(prev => ({
      ...prev,
      [`${type}_summary`]: DEFAULT_TEMPLATES[type].summary,
      [`${type}_description`]: DEFAULT_TEMPLATES[type].description
    }));
  }, [selectedUserType]);

  const allVariables = selectedUserType === 'supplier' 
    ? [...TEMPLATE_VARIABLES, ...SUPPLIER_ONLY_VARIABLES]
    : selectedUserType === 'admin'
    ? [...TEMPLATE_VARIABLES, ...ADMIN_ONLY_VARIABLES]
    : TEMPLATE_VARIABLES;

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          הגדרת מבנה אירוע ביומן Google
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* User type selector */}
        <div className="flex items-center gap-3">
          <Label>סוג משתמש:</Label>
          <Select value={selectedUserType} onValueChange={setSelectedUserType}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">מנהל</SelectItem>
              <SelectItem value="supplier">ספק</SelectItem>
              <SelectItem value="client">לקוח</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Info box */}
        <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800 space-y-2">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium mb-1">איך זה עובד?</p>
              <ul className="list-disc mr-4 space-y-1 text-xs">
                <li>הכנס טקסט חופשי ומשתנים בפורמט <code dir="ltr" className="bg-blue-100 px-1 rounded">{'{{variable}}'}</code></li>
                <li>טקסט מותנה: עטוף ב-<code dir="ltr" className="bg-blue-100 px-1 rounded">{'[[ text {{variable}} ]]'}</code> - יוצג רק אם המשתנה קיים באירוע</li>
                <li>תאריך, שעה ומיקום <strong>לא צריכים</strong> להופיע בתיאור - הם נקבעים אוטומטית בשדות האירוע ביומן</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Variables reference */}
        <div className="border rounded-lg p-3">
          <Label className="text-xs font-semibold mb-2 block">משתנים זמינים עבור {USER_TYPE_LABELS[selectedUserType]}:</Label>
          <div className="flex flex-wrap gap-1">
            {allVariables.map(v => (
              <Badge key={v.key} variant="outline" className="text-xs cursor-help" title={v.desc}>
                {v.key} <span className="text-gray-400 mr-1">- {v.desc}</span>
              </Badge>
            ))}
          </div>
        </div>

        {/* Summary template */}
        <div>
          <Label className="font-semibold">כותרת האירוע ביומן (Summary)</Label>
          <Textarea
            value={templates[`${selectedUserType}_summary`] || ''}
            onChange={e => setTemplates(prev => ({ ...prev, [`${selectedUserType}_summary`]: e.target.value }))}
            className="mt-1 dir-rtl text-right font-mono text-sm"
            rows={2}
            placeholder="הזן תבנית לכותרת..."
          />
        </div>

        {/* Description template */}
        <div>
          <Label className="font-semibold">תיאור האירוע ביומן (Description)</Label>
          <Textarea
            value={templates[`${selectedUserType}_description`] || ''}
            onChange={e => setTemplates(prev => ({ ...prev, [`${selectedUserType}_description`]: e.target.value }))}
            className="mt-1 dir-rtl text-right font-mono text-sm"
            rows={8}
            placeholder="הזן תבנית לתיאור..."
          />
        </div>

        {/* Supplier categories for admin view */}
        {selectedUserType === 'admin' && (
          <div className="border-t pt-4">
            <Label className="font-semibold mb-2 block">קטגוריות שירות להצגת ספקים ברשימה (עבור מנהלים)</Label>
            <p className="text-xs text-gray-500 mb-3">בחר את קטגוריות השירות שהספקים המאושרים שלהן יוצגו בתיאור האירוע ביומן המנהל</p>
            <div className="flex flex-wrap gap-2">
              {services.filter(s => s.is_active).map(service => (
                <Badge
                  key={service.id}
                  variant={supplierCategories.includes(service.service_name) ? "default" : "outline"}
                  className="cursor-pointer transition-colors"
                  onClick={() => toggleServiceCategory(service.service_name)}
                >
                  {service.service_name}
                </Badge>
              ))}
            </div>
            {supplierCategories.length > 0 && (
              <p className="text-xs text-green-600 mt-2">נבחרו: {supplierCategories.join(', ')}</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
            שמור תבניות
          </Button>
          <Button variant="outline" onClick={resetToDefault}>
            איפוס לברירת מחדל ({USER_TYPE_LABELS[selectedUserType]})
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}