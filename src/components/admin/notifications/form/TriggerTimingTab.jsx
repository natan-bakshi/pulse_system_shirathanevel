import React from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import FieldLabel from "../FieldLabel";
import { TRIGGER_TYPES, TIMING_UNITS } from "../constants";

// טאב 3: מתי לשלוח? - סוג טריגר, תזמון, תזכורות
export default function TriggerTimingTab({ template, onChange }) {
  const update = (field, value) => onChange({ ...template, [field]: value });
  const isScheduled = template.trigger_type === 'scheduled_check';

  return (
    <div className="space-y-4">
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
          <h3 className="font-medium text-sm text-gray-700">הגדרות תזמון</h3>
          
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
                  <SelectItem value="before">לפני</SelectItem>
                  <SelectItem value="after">אחרי</SelectItem>
                  <SelectItem value="during">ביום ה</SelectItem>
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
                  <SelectItem value="event_date">תאריך האירוע</SelectItem>
                  <SelectItem value="event_end_time">סיום האירוע</SelectItem>
                  <SelectItem value="payment_due_date">מועד תשלום</SelectItem>
                  <SelectItem value="assignment_date">מועד שיבוץ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t pt-3">
            <h4 className="font-medium text-sm text-gray-700 mb-2">תזכורת חוזרת</h4>
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
                    <SelectItem value="hours">שעות</SelectItem>
                    <SelectItem value="days">ימים</SelectItem>
                    <SelectItem value="weeks">שבועות</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isScheduled && (
        <Alert className="bg-amber-50 border-amber-200">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            הגדרות תזמון רלוונטיות רק לטריגר "בדיקה מתוזמנת". טריגרים אחרים מופעלים אוטומטית עם התרחשות האירוע.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}