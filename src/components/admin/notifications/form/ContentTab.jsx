import React, { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import FieldLabel from "../FieldLabel";
import VariablesGuide from "../VariablesGuide";
import {useLanguage} from '@/i18n/LanguageProvider';
import {reviewedClientPaymentReminderEnglish,selectClientPaymentReminderCopy} from '../../../../../base44/shared/clientReminderLocale.ts';

// טאב 2: תוכן ההתראה - כותרת, גוף Push, גוף WhatsApp + מדריך משתנים
export default function ContentTab({ template, onChange }) {
  const {t: uiTranslate}=useLanguage();
  const titleRef = useRef(null);
  const bodyRef = useRef(null);
  const whatsappRef = useRef(null);

  const update = (field, value) => onChange({ ...template, [field]: value });
  const updateEnglish = (field, value) => onChange({ ...template, [field]: value,english_copy_reviewed:false });

  // הכנסת משתנה במיקום הסמן בשדה הפעיל
  const insertAtCursor = (ref, field, varText) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const current = template[field] || '';
    const newValue = current.substring(0, start) + varText + current.substring(end);
    update(field, newValue);
    // החזרת הפוקוס לאחר עדכון
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + varText.length, start + varText.length);
    }, 0);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <FieldLabel
            label={uiTranslate("כותרת ההתראה")}
            tooltip={uiTranslate("הכותרת שתופיע בהתראה. ניתן להשתמש במשתנים כמו {{event_name}}")}
            required
          />
          <VariablesGuide onInsert={(v) => insertAtCursor(titleRef, 'title_template', v)} />
        </div>
        <Input
          ref={titleRef}
          value={template.title_template || ''}
          onChange={(e) => update('title_template', e.target.value)}
          placeholder={uiTranslate("שיבוץ חדש לאירוע {{event_name}}")}
          className="mt-1"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <FieldLabel
            label={uiTranslate("תוכן ההודעה (Push / In-App)")}
            tooltip={uiTranslate("גוף ההודעה המלא להתראת מערכת. ניתן להשתמש במשתנים כמו {{supplier_name}}")}
            required
          />
          <VariablesGuide onInsert={(v) => insertAtCursor(bodyRef, 'body_template', v)} />
        </div>
        <Textarea
          ref={bodyRef}
          value={template.body_template || ''}
          onChange={(e) => update('body_template', e.target.value)}
          placeholder={uiTranslate("שלום {{supplier_name}}, שובצת לאירוע {{event_name}}...")}
          rows={4}
          className="mt-1"
        />
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FieldLabel
              label={uiTranslate("הודעת וואטסאפ")}
              tooltip={uiTranslate("תוכן ההודעה שתשלח בוואטסאפ (אם הערוץ פעיל)")}
            />
            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
              WhatsApp
            </Badge>
          </div>
          <VariablesGuide onInsert={(v) => insertAtCursor(whatsappRef, 'whatsapp_body_template', v)} />
        </div>
        <Textarea
          ref={whatsappRef}
          value={template.whatsapp_body_template || ''}
          onChange={(e) => update('whatsapp_body_template', e.target.value)}
          placeholder={uiTranslate("היי {{supplier_name}}, יש עדכון לגבי האירוע...")}
          rows={4}
          className="border-green-200 focus-visible:ring-green-500"
        />
      </div>
      {template.type==='CLIENT_PAYMENT_REMINDER'&&<details className="border rounded-lg p-3 space-y-3">
        <summary className="cursor-pointer font-semibold text-sm">{uiTranslate('נוסחי הודעות באנגלית ללקוחות')}</summary>
        <p className="text-xs text-gray-600 mt-3">{uiTranslate('שפת הודעות ללקוח מוגדרת לכל אירוע בנפרד. תבנית זו תישאר כבויה עד להפעלתה בנפרד. יש לשמור על כל המשתנים המקוריים.')}</p>
        <div className="space-y-3 mt-3">
          <label className="block text-sm font-medium" htmlFor="client-reminder-title-en">
            {uiTranslate('כותרת באנגלית')}
          </label>
          <Input id="client-reminder-title-en" dir="ltr" value={template.title_template_en||''}
            placeholder={reviewedClientPaymentReminderEnglish.title_template_en}
            onChange={e=>updateEnglish('title_template_en',e.target.value)}/>
          <label className="block text-sm font-medium" htmlFor="client-reminder-body-en">
            {uiTranslate('גוף ההודעה באנגלית')}
          </label>
          <Textarea id="client-reminder-body-en" dir="ltr" rows={5}
            value={template.body_template_en||''}
            placeholder={reviewedClientPaymentReminderEnglish.body_template_en}
            onChange={e=>updateEnglish('body_template_en',e.target.value)}/>
          <label className="block text-sm font-medium" htmlFor="client-reminder-whatsapp-en">
            {uiTranslate('הודעת WhatsApp באנגלית')}
          </label>
          <Textarea id="client-reminder-whatsapp-en" dir="ltr" rows={5}
            value={template.whatsapp_body_template_en||''}
            placeholder={reviewedClientPaymentReminderEnglish.whatsapp_body_template_en}
            onChange={e=>updateEnglish('whatsapp_body_template_en',e.target.value)}/>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={template.english_copy_reviewed===true}
              onCheckedChange={checked=>update('english_copy_reviewed',checked===true)}/>
            {uiTranslate('בדקתי ואישרתי את הנוסחים באנגלית')}
          </label>
          {(()=>{const checked=selectClientPaymentReminderCopy(template,{client_notice_language:'en'});
           return <p className={'text-xs '+(checked.ready?'text-green-700':'text-amber-700')} role="status">
            {checked.ready?uiTranslate('הנוסחים באנגלית מוכנים לבדיקה.'):
             uiTranslate('הנוסחים באנגלית חסרים, אינם תואמים או טרם אושרו. הודעה באנגלית לא תישלח עד להשלמה ואישור.')}
           </p>})()}
        </div>
      </details>}
    </div>
  );
}