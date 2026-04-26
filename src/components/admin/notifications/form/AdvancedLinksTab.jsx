import React from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FieldLabel from "../FieldLabel";
import { AUDIENCES, PAGES_BY_ROLE } from "../constants";

// טאב 5: קישורים מתקדמים - Deep Link וכו'
export default function AdvancedLinksTab({ template, onChange }) {
  const update = (field, value) => onChange({ ...template, [field]: value });

  // Get relevant pages based on selected audiences
  const getRelevantPages = () => {
    if (!template?.target_audiences) return [];
    
    const audiences = template.target_audiences;
    const pages = new Set();
    const result = [];

    if (audiences.includes('system_creator')) {
      PAGES_BY_ROLE.system_creator.forEach(p => {
        if (!pages.has(p.value)) {
          pages.add(p.value);
          result.push({ ...p, role: 'יוצר המערכת' });
        }
      });
    }
    if (audiences.includes('admin')) {
      PAGES_BY_ROLE.admin.forEach(p => {
        if (!pages.has(p.value)) {
          pages.add(p.value);
          result.push({ ...p, role: 'מנהל' });
        }
      });
    }
    if (audiences.includes('client')) {
      PAGES_BY_ROLE.client.forEach(p => {
        if (!pages.has(p.value)) {
          pages.add(p.value);
          result.push({ ...p, role: 'לקוח' });
        }
      });
    }
    if (audiences.includes('supplier')) {
      PAGES_BY_ROLE.supplier.forEach(p => {
        if (!pages.has(p.value)) {
          pages.add(p.value);
          result.push({ ...p, role: 'ספק' });
        }
      });
    }
    return result;
  };

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel 
          label="סוג קישור חכם" 
          tooltip="יוצר אוטומטית קישור ישיר לדף הרלוונטי (למשל: לאירוע הספציפי שהפעיל את ההתראה). מומלץ לחסוך הגדרת פרמטרים ידנית."
        />
        <Select 
          value={template.dynamic_url_type || 'none'} 
          onValueChange={(v) => update('dynamic_url_type', v)}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="בחר סוג קישור" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">ללא / ידני</SelectItem>
            <SelectItem value="event_page">כרטיסיית אירוע</SelectItem>
            <SelectItem value="payment_page">דף תשלומים</SelectItem>
            <SelectItem value="assignment_page">דף שיבוצים/ספק</SelectItem>
            <SelectItem value="calendar_page">לוח אירועים</SelectItem>
            <SelectItem value="settings_page">הגדרות</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {(!template.dynamic_url_type || template.dynamic_url_type === 'none') && (
        <div>
          <FieldLabel 
            label="דף יעד ידני" 
            tooltip="בחר דף מתוך הדפים הזמינים לקהל היעד הנבחר"
          />
          <div className="text-xs text-gray-500 mb-1">
            הדפים מוצגים בהתאם לקהלי היעד שנבחרו ({template.target_audiences?.map(a => AUDIENCES[a]?.label).join(', ')})
          </div>
          <Select 
            value={template.deep_link_base || ''} 
            onValueChange={(v) => update('deep_link_base', v)}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="בחר דף" />
            </SelectTrigger>
            <SelectContent>
              {getRelevantPages().map((page, i) => (
                <SelectItem key={`${page.value}-${i}`} value={page.value}>
                  <span className="flex justify-between w-full gap-2">
                    <span>{page.label}</span>
                    <span className="text-gray-400 text-[10px]">{page.role}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      
      <div>
        <FieldLabel 
          label="פרמטרים" 
          tooltip='פרמטרים להעברה לדף היעד בפורמט JSON. למשל: {"id": "{{event_id}}"}'
        />
        <Input
          value={template.deep_link_params_map || ''}
          onChange={(e) => update('deep_link_params_map', e.target.value)}
          placeholder='{"id": "{{event_id}}"}'
          className="font-mono text-sm mt-1"
        />
      </div>
    </div>
  );
}