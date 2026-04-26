import React, { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import FieldLabel from "../FieldLabel";
import VariablesGuide from "../VariablesGuide";

// טאב 2: תוכן ההתראה - כותרת, גוף Push, גוף WhatsApp + מדריך משתנים
export default function ContentTab({ template, onChange }) {
  const titleRef = useRef(null);
  const bodyRef = useRef(null);
  const whatsappRef = useRef(null);

  const update = (field, value) => onChange({ ...template, [field]: value });

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
            label="כותרת ההתראה" 
            tooltip='הכותרת שתופיע בהתראה. ניתן להשתמש במשתנים כמו {{event_name}}'
            required
          />
          <VariablesGuide onInsert={(v) => insertAtCursor(titleRef, 'title_template', v)} />
        </div>
        <Input
          ref={titleRef}
          value={template.title_template || ''}
          onChange={(e) => update('title_template', e.target.value)}
          placeholder="שיבוץ חדש לאירוע {{event_name}}"
          className="mt-1"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <FieldLabel 
            label="תוכן ההודעה (Push / In-App)" 
            tooltip='גוף ההודעה המלא להתראת מערכת. ניתן להשתמש במשתנים כמו {{supplier_name}}'
            required
          />
          <VariablesGuide onInsert={(v) => insertAtCursor(bodyRef, 'body_template', v)} />
        </div>
        <Textarea
          ref={bodyRef}
          value={template.body_template || ''}
          onChange={(e) => update('body_template', e.target.value)}
          placeholder="שלום {{supplier_name}}, שובצת לאירוע {{event_name}}..."
          rows={4}
          className="mt-1"
        />
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FieldLabel 
              label="הודעת וואטסאפ" 
              tooltip="תוכן ההודעה שתשלח בוואטסאפ (אם הערוץ פעיל)"
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
          placeholder="היי {{supplier_name}}, יש עדכון לגבי האירוע..."
          rows={4}
          className="border-green-200 focus-visible:ring-green-500"
        />
      </div>
    </div>
  );
}