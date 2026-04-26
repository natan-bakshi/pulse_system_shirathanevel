import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FieldLabel from "../FieldLabel";
import { CATEGORIES } from "../constants";

// טאב 1: פרטים כלליים - קוד זיהוי, שם, תיאור, קטגוריה, ערוצים, מצב פעיל
export default function BasicInfoTab({ template, onChange }) {
  const update = (field, value) => onChange({ ...template, [field]: value });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <FieldLabel 
            label="קוד זיהוי" 
            tooltip="קוד ייחודי לזיהוי התבנית במערכת. רק אותיות גדולות באנגלית וקו תחתון. למשל: SUPPLIER_NEW_ASSIGNMENT"
            required
          />
          <Input
            value={template.type || ''}
            onChange={(e) => update('type', e.target.value.toUpperCase().replace(/[^A-Z_]/g, ''))}
            placeholder="SUPPLIER_NEW_ASSIGNMENT"
            className="font-mono text-sm mt-1"
          />
        </div>
        <div>
          <FieldLabel 
            label="שם התבנית" 
            tooltip="שם ידידותי שיעזור לך לזהות את התבנית ברשימה"
            required
          />
          <Input
            value={template.name || ''}
            onChange={(e) => update('name', e.target.value)}
            placeholder="שיבוץ חדש לספק"
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <FieldLabel 
          label="תיאור" 
          tooltip="תיאור פנימי לשימושך - לא יוצג למשתמשים"
        />
        <Input
          value={template.description || ''}
          onChange={(e) => update('description', e.target.value)}
          placeholder="תיאור התבנית לשימוש פנימי"
          className="mt-1"
        />
      </div>

      <div>
        <FieldLabel 
          label="קטגוריה" 
          tooltip="קטגוריה לסיווג התבנית - משמשת לארגון וסינון"
        />
        <Select 
          value={template.category || 'system'} 
          onValueChange={(v) => update('category', v)}
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CATEGORIES).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border-t pt-4">
        <FieldLabel 
          label="ערוצי שליחה מותרים" 
          tooltip="באילו ערוצים מותר לשלוח התראה זו"
        />
        <div className="flex gap-6 mt-2">
          <div className="flex items-center space-x-2 space-x-reverse">
            <Switch
              id="channel-push"
              checked={template.allowed_channels?.includes('push') || false}
              onCheckedChange={(checked) => {
                const channels = new Set(template.allowed_channels || []);
                if (checked) channels.add('push');
                else channels.delete('push');
                update('allowed_channels', Array.from(channels));
              }}
            />
            <Label htmlFor="channel-push">Push / אפליקציה</Label>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse">
            <Switch
              id="channel-whatsapp"
              checked={template.allowed_channels?.includes('whatsapp') || false}
              onCheckedChange={(checked) => {
                const channels = new Set(template.allowed_channels || []);
                if (checked) channels.add('whatsapp');
                else channels.delete('whatsapp');
                update('allowed_channels', Array.from(channels));
              }}
            />
            <Label htmlFor="channel-whatsapp">WhatsApp</Label>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border">
        <Switch
          checked={template.is_active}
          onCheckedChange={(checked) => update('is_active', checked)}
        />
        <div>
          <Label>התראה פעילה</Label>
          <p className="text-xs text-gray-500">כבה כדי להשבית זמנית את ההתראה מבלי למחוק אותה</p>
        </div>
      </div>
    </div>
  );
}