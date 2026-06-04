import React, { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, Save, Loader2, Plus, Trash2, GripVertical, Info, Star } from "lucide-react";
import OrganizerFieldsEditor from "./OrganizerFieldsEditor";
import OrganizerBlocksEditor from "./OrganizerBlocksEditor";
import RichTextEditor from "../manualQuote/RichTextEditor";

export default function OrganizerTypeEditor({ type, onSave, onCancel, isSaving }) {
  const [typeName, setTypeName] = useState(type.type_name || "");
  const [titleTemplate, setTitleTemplate] = useState(type.quote_main_title_template || "");
  const [fields, setFields] = useState(() => {
    try { return JSON.parse(type.event_fields || '[]'); } catch { return []; }
  });
  const [blocks, setBlocks] = useState(() => {
    try { return JSON.parse(type.quote_blocks || '[]'); } catch { return []; }
  });

  // Available variables for title template
  // Available variables for title template and blocks
  // When custom fields are defined, use ONLY those (they replace the built-in fields)
  // When no custom fields exist, fall back to built-in defaults
  const availableVars = useMemo(() => {
    if (fields.length > 0) {
      return fields.map(f => ({ key: f.id, label: f.name }));
    }
    return [
      { key: 'event_name', label: 'שם אירוע' },
      { key: 'event_type', label: 'סוג אירוע' },
      { key: 'event_date', label: 'תאריך אירוע' },
      { key: 'family_name', label: 'שם משפחה' },
      { key: 'child_name', label: 'שם ילד/ה' },
      { key: 'city', label: 'עיר' },
      { key: 'guest_count', label: 'מספר אורחים' },
      { key: 'location', label: 'מיקום' },
      { key: 'concept', label: 'קונספט' },
    ];
  }, [fields]);

  const handleSave = useCallback(() => {
    onSave({
      ...type,
      type_name: typeName,
      quote_main_title_template: titleTemplate || null,
      event_fields: fields.length > 0 ? JSON.stringify(fields) : null,
      quote_blocks: blocks.length > 0 ? JSON.stringify(blocks) : null,
    });
  }, [type, typeName, titleTemplate, fields, blocks, onSave]);

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <CardTitle>עריכת סוג: {type.type_name}</CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Type Name */}
        <div>
          <Label>שם סוג ההזמנה</Label>
          <Input
            value={typeName}
            onChange={(e) => setTypeName(e.target.value)}
            placeholder="שם הסוג"
          />
        </div>

        <Tabs defaultValue="fields" className="space-y-4">
          <TabsList className="bg-gray-100 flex-wrap h-auto">
            <TabsTrigger value="fields">שדות</TabsTrigger>
            <TabsTrigger value="title">כותרת ראשית</TabsTrigger>
            <TabsTrigger value="blocks">בלוקים</TabsTrigger>
          </TabsList>

          {/* Tab 1: Fields */}
          <TabsContent value="fields">
            <OrganizerFieldsEditor fields={fields} onChange={setFields} />
          </TabsContent>

          {/* Tab 2: Main Title Template */}
          <TabsContent value="title" className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium mb-1">איך זה עובד?</p>
                  <ul className="list-disc mr-4 space-y-1 text-xs">
                    <li>משתנה בסוגריים מרובעים: <code className="bg-blue-100 px-1 rounded">[שם_שדה]</code> - יוחלף בערך השדה</li>
                    <li>טקסט מותנה: <code className="bg-blue-100 px-1 rounded">((טקסט עם [משתנה]))</code> - יוצג רק אם למשתנה יש ערך</li>
                    <li>השאר ריק כדי להשתמש בכותרת ברירת מחדל הקיימת</li>
                  </ul>
                </div>
              </div>
            </div>

            <div>
              <Label>תבנית כותרת ראשית</Label>
              <RichTextEditor
                value={titleTemplate}
                onChange={setTitleTemplate}
                placeholder='לדוגמה: הצעת מחיר עבור ((חברת [company_name] לידי)) [contact_person]'
                minHeight={100}
              />
            </div>

            {/* Variables Reference */}
            <div className="border rounded-lg p-3">
              <Label className="text-xs font-semibold mb-2 block">משתנים זמינים:</Label>
              <div className="flex flex-wrap gap-1">
                {availableVars.map(v => (
                  <Badge
                    key={v.key}
                    variant="outline"
                    className="text-xs cursor-pointer hover:bg-blue-50"
                    onClick={() => {
                      setTitleTemplate(prev => prev + `[${v.key}]`);
                    }}
                    title={`לחץ להוספת [${v.key}]`}
                  >
                    [{v.key}] - {v.label}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Preview */}
            {titleTemplate && (
              <div className="border rounded-lg p-3 bg-gray-50">
                <Label className="text-xs font-semibold mb-1 block">תצוגה מקדימה (עם ערכי דוגמה):</Label>
                <p className="text-sm text-gray-700">{previewTitle(titleTemplate)}</p>
              </div>
            )}
          </TabsContent>

          {/* Tab 3: Blocks */}
          <TabsContent value="blocks">
            <OrganizerBlocksEditor blocks={blocks} onChange={setBlocks} fields={fields} availableVars={availableVars} />
          </TabsContent>
        </Tabs>
      </CardContent>

      <CardFooter className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>ביטול</Button>
        <Button onClick={handleSave} disabled={isSaving || !typeName.trim()}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
          שמור
        </Button>
      </CardFooter>
    </Card>
  );
}

function previewTitle(template) {
  const sampleValues = {
    event_name: 'אירוע לדוגמה',
    event_type: 'בר מצווה',
    event_date: '01.01.2026',
    family_name: 'כהן',
    child_name: 'יוסי',
    city: 'תל אביב',
    guest_count: '150',
    location: 'אולם הגדול',
    concept: 'אורבני',
    company_name: 'חברת החשמל',
    contact_person: 'מורן',
  };

  let result = template;
  
  // First handle conditional blocks ((text))
  result = result.replace(/\(\((.*?)\)\)/g, (match, content) => {
    // Check if any variables in this block have values
    const hasValue = content.replace(/\[(.*?)\]/g, (m, key) => {
      return sampleValues[key] || '';
    }).trim();
    if (!hasValue) return '';
    return content.replace(/\[(.*?)\]/g, (m, key) => sampleValues[key] || '');
  });

  // Then handle remaining simple variables
  result = result.replace(/\[(.*?)\]/g, (match, key) => sampleValues[key] || '');

  return result;
}