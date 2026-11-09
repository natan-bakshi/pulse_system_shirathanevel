import React from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FieldLabel from "../FieldLabel";
import { AUDIENCES, PAGES_BY_ROLE } from "../constants";
import {notificationLinkPreset} from "@/lib/notificationLinkPresets";
import {useLanguage} from '@/i18n/LanguageProvider';

// טאב 5: קישורים מתקדמים - Deep Link וכו'
export default function AdvancedLinksTab({ template, onChange }) {
  const {t: uiTranslate}=useLanguage();
  const update = (field, value) => onChange({ ...template, [field]: value });
  const chooseSmartLink=(type)=>{
    if(type==='none'){
      update('dynamic_url_type','none');
      return;
    }
    const preset=notificationLinkPreset(type,template.target_audiences);
    if(!preset)return;
    // Also populate legacy deep-link fields: scheduled notifications use them,
    // while createNotificationCore uses dynamic_url_type. Both routes agree.
    onChange({...template,dynamic_url_type:type,...preset});
  };
  const hasSmartRole=!!notificationLinkPreset('event_page',template?.target_audiences);

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
          onValueChange={chooseSmartLink}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="בחר סוג קישור" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">ללא / ידני</SelectItem>
            <SelectItem value="event_page" disabled={!hasSmartRole}>כרטיסיית אירוע</SelectItem>
            <SelectItem value="payment_page" disabled={!notificationLinkPreset("payment_page",template?.target_audiences)}>דף תשלומים</SelectItem>
            <SelectItem value="assignment_page" disabled={!notificationLinkPreset("assignment_page",template?.target_audiences)}>דף שיבוצים/ספק</SelectItem>
            <SelectItem value="calendar_page" disabled={!notificationLinkPreset("calendar_page",template?.target_audiences)}>{uiTranslate("לוח אירועים")}</SelectItem>
            <SelectItem value="settings_page">{uiTranslate("הגדרות")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500 mt-1">
          הקישור נפתח רק לפי הרשאות הנמען. כדי למפות דף אירוע או תשלום נכון,
          בחר קהל יעד אחד בתנאים וקהלים. אם התבנית מיועדת למספר סוגי נמענים,
          אין לבחור יעד עסקי משותף שעלול להפנות לדף לא נכון.
          כפתורי WhatsApp מותאמים מוגדרים בלשונית כפתורים.
        </p>
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
            onValueChange={(v) => onChange({...template,deep_link_base:v,
            deep_link_params_map:/^(EventDetails|SupplierEventView)(\?|$)/.test(v)&&
              !template.deep_link_params_map?JSON.stringify({id:'{{event_id}}'}):
              template.deep_link_params_map})}
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