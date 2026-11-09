import React from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Cog } from "lucide-react";
import FieldLabel from "../FieldLabel";
import { TRIGGER_TYPES, TIMING_UNITS } from "../constants";
import { getSystemTemplateInfo } from "../systemTemplatesInfo";
import {useLanguage} from '@/i18n/LanguageProvider';

// טאב 3: מתי לשלוח? - סוג טריגר, תזמון, תזכורות
export default function TriggerTimingTab({ template, onChange }) {
  const {t: uiTranslate}=useLanguage();
  const update = (field, value) => onChange({ ...template, [field]: value });
  const isScheduled = template.trigger_type === 'scheduled_check';
  const isEntityTrigger = ['entity_create', 'entity_update', 'supplier_assignment_create', 'supplier_assignment_delete', 'assignment_status_change', 'event_critical_update'].includes(template.trigger_type);
  const systemInfo = getSystemTemplateInfo(template.type);

  return (
    <div className="space-y-4">
      {/* תיוג תבנית מערכת - תצוגה מודעת על תבניות עם טיפול קוד קשיח */}
      {systemInfo && (
        <Alert className="bg-purple-50 border-purple-200">
          <Cog className="h-4 w-4 text-purple-600" />
          <AlertDescription className="text-purple-800 text-sm">
            <div className="font-semibold mb-1">{uiTranslate("תבנית מערכת - מטופלת בקוד")}</div>
            <div className="text-xs space-y-1">
              <p><span className="font-medium">{uiTranslate("פונקציה:")}</span> {systemInfo.handler} • {systemInfo.phase}</p>
              <p><span className="font-medium">{uiTranslate("תדירות:")}</span> {systemInfo.frequency}</p>
              <p>{systemInfo.description}</p>
              <p className="mt-2 pt-2 border-t border-purple-200">
                <span className="font-medium">{uiTranslate("שדות בשימוש מתוך התבנית:")}</span>{' '}
                <code className="text-[10px] bg-white px-1 py-0.5 rounded">{systemInfo.controls.join(', ')}</code>
              </p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div>
        <FieldLabel 
          label="סוג טריגר" 
          tooltip="מה יגרום לשליחת ההתראה"
        />
        <Select 
          value={template.trigger_type || 'scheduled_check'} 
          onValueChange={(v) => update('trigger_type', v)}
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TRIGGER_TYPES).map(([value, info]) => (
              <SelectItem key={value} value={value}>
                <div className="text-right">
                  <div>{info.label}</div>
                  <div className="text-xs text-gray-500">{info.example}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* הסבר על הטריגר הנבחר */}
      {template.trigger_type && TRIGGER_TYPES[template.trigger_type] && (
        <Alert className="bg-blue-50 border-blue-100">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-700 text-sm">
            {TRIGGER_TYPES[template.trigger_type].description}
          </AlertDescription>
        </Alert>
      )}

      {/* הגדרות תזמון - רק לטריגר מתוזמן */}
      {isScheduled && (
        <div className="border rounded-lg p-3 bg-gray-50 space-y-3">
          <h3 className="font-medium text-sm text-gray-700">{uiTranslate("הגדרות תזמון")}</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel 
                label="ערך זמן" 
                tooltip="מספר היחידות לפני/אחרי נקודת הייחוס"
              />
              <Input
                type="number"
                value={template.timing_value || ''}
                onChange={(e) => update('timing_value', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="7"
                className="mt-1"
              />
            </div>
            <div>
              <FieldLabel label="יחידת זמן" />
              <Select 
                value={template.timing_unit || 'days'} 
                onValueChange={(v) => update('timing_unit', v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIMING_UNITS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel 
                label="מתי?" 
                tooltip="לפני, אחרי או בזמן האירוע/היעד"
              />
              <Select 
                value={template.timing_direction || 'before'} 
                onValueChange={(v) => update('timing_direction', v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="בחר זמן" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="before">{uiTranslate("לפני")}</SelectItem>
                  <SelectItem value="after">{uiTranslate("אחרי")}</SelectItem>
                  <SelectItem value="during">{uiTranslate("ביום ה")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel 
                label="ביחס ל..." 
                tooltip="נקודת הייחוס לחישוב הזמן"
              />
              <Select 
                value={template.timing_reference || 'event_date'} 
                onValueChange={(v) => update('timing_reference', v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="בחר ייחוס" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="event_date">{uiTranslate("תאריך האירוע")}</SelectItem>
                  <SelectItem value="event_end_time">{uiTranslate("סיום האירוע")}</SelectItem>
                  <SelectItem value="payment_due_date">{uiTranslate("מועד תשלום")}</SelectItem>
                  <SelectItem value="assignment_date">{uiTranslate("מועד שיבוץ")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t pt-3">
            <h4 className="font-medium text-sm text-gray-700 mb-2">{uiTranslate("תזכורת חוזרת")}</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel 
                  label="כל" 
                  tooltip="כל כמה זמן לשלוח תזכורת חוזרת (השאר ריק לביטול)"
                />
                <Input
                  type="number"
                  value={template.reminder_interval_value || ''}
                  onChange={(e) => update('reminder_interval_value', e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="24"
                  className="mt-1"
                />
              </div>
              <div>
                <FieldLabel label="יחידת זמן" />
                <Select 
                  value={template.reminder_interval_unit || 'hours'} 
                  onValueChange={(v) => update('reminder_interval_unit', v)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">{uiTranslate("שעות")}</SelectItem>
                    <SelectItem value="days">{uiTranslate("ימים")}</SelectItem>
                    <SelectItem value="weeks">{uiTranslate("שבועות")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* הגדרות לטריגרי Entity - איזו ישות לעקוב אחריה */}
      {isEntityTrigger && (
        <div className="border rounded-lg p-3 bg-blue-50 space-y-3">
          <h3 className="font-medium text-sm text-blue-900">{uiTranslate("ישות מטרה")}</h3>
          <p className="text-xs text-blue-700">
            {uiTranslate("בחר על איזו ישות הטריגר עוקב. זה מצמצם את הפעלת ההתראה רק לשינויים בישות הזו.")}
          </p>
          <div>
            <FieldLabel
              label="שם הישות (entity_name)"
              tooltip="שם הישות במערכת. למשל: Event לאירועים, EventService לשיבוצי ספקים"
            />
            <Select
              value={template.entity_name || ''}
              onValueChange={(v) => update('entity_name', v)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="בחר ישות" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Event">{uiTranslate("Event - אירועים")}</SelectItem>
                <SelectItem value="EventService">{uiTranslate("EventService - שיבוצי ספקים")}</SelectItem>
                <SelectItem value="Supplier">{uiTranslate("Supplier - ספקים")}</SelectItem>
                <SelectItem value="Payment">{uiTranslate("Payment - תשלומים")}</SelectItem>
                <SelectItem value="Task">{uiTranslate("Task - משימות")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-blue-700 mt-1">
              {uiTranslate("⚠️ חובה לבחור ישות עבור טריגר מסוג זה - אחרת ההתראה לא תופעל.")}
            </p>
          </div>
        </div>
      )}

      {!isScheduled && !isEntityTrigger && (
        <Alert className="bg-amber-50 border-amber-200">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            {uiTranslate("הגדרות תזמון רלוונטיות רק לטריגר \"בדיקה מתוזמנת\". טריגרים אחרים מופעלים אוטומטית עם התרחשות האירוע.")}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}