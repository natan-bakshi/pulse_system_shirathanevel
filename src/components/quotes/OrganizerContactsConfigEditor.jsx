import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Edit, Info } from "lucide-react";

const EXTRA_FIELD_TYPES = [
  { value: 'text', label: 'טקסט' },
  { value: 'phone', label: 'טלפון' },
  { value: 'email', label: 'אימייל' },
  { value: 'select', label: 'בחירה מרשימה' },
];

export default function OrganizerContactsConfigEditor({ config, onChange }) {
  const [showFieldDialog, setShowFieldDialog] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [fieldForm, setFieldForm] = useState({ id: '', name: '', type: 'text', options: '' });

  const label = config?.label || "אנשי קשר";
  const itemLabel = config?.item_label || "איש קשר";
  const extraFields = config?.extra_fields || [];

  const updateConfig = (updates) => {
    onChange({
      label,
      item_label: itemLabel,
      extra_fields: extraFields,
      ...config,
      ...updates
    });
  };

  const openNewField = () => {
    setEditingIndex(null);
    setFieldForm({ id: '', name: '', type: 'text', options: '' });
    setShowFieldDialog(true);
  };

  const openEditField = (index) => {
    const f = extraFields[index];
    setEditingIndex(index);
    setFieldForm({
      id: f.id || '',
      name: f.name || '',
      type: f.type || 'text',
      options: Array.isArray(f.options) ? f.options.join(', ') : ''
    });
    setShowFieldDialog(true);
  };

  const saveField = () => {
    const id = fieldForm.id || fieldForm.name.replace(/\s+/g, '_').toLowerCase() + '_' + Date.now();
    const newField = {
      id,
      name: fieldForm.name,
      type: fieldForm.type,
      options: fieldForm.type === 'select' ? fieldForm.options.split(',').map(o => o.trim()).filter(Boolean) : undefined,
    };
    const updated = [...extraFields];
    if (editingIndex !== null) {
      updated[editingIndex] = newField;
    } else {
      updated.push(newField);
    }
    updateConfig({ extra_fields: updated });
    setShowFieldDialog(false);
  };

  const removeField = (index) => {
    updateConfig({ extra_fields: extraFields.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>אנשי קשר הם שדה קבוע בכל אירוע מסוג הזמנה זה. כאן ניתן להגדיר את שם הקטע, שם כל איש קשר, ושדות נוספים מעבר לשם, טלפון ואימייל.</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>שם הקטע (כותרת)</Label>
          <Input
            value={label}
            onChange={(e) => updateConfig({ label: e.target.value })}
            placeholder="אנשי קשר"
          />
        </div>
        <div>
          <Label>שם איש קשר בודד</Label>
          <Input
            value={itemLabel}
            onChange={(e) => updateConfig({ item_label: e.target.value })}
            placeholder="איש קשר"
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h4 className="font-semibold text-sm">שדות נוספים לאיש קשר ({extraFields.length})</h4>
            <p className="text-xs text-gray-500">מעבר לשם, טלפון ואימייל (שתמיד קיימים)</p>
          </div>
          <Button size="sm" variant="outline" onClick={openNewField}>
            <Plus className="h-4 w-4 ml-1" />הוסף שדה
          </Button>
        </div>

        {extraFields.length === 0 && (
          <div className="text-center py-4 border-2 border-dashed rounded-lg text-gray-400 text-sm">
            רק שם, טלפון ואימייל (ללא שדות נוספים)
          </div>
        )}

        <div className="space-y-2">
          {extraFields.map((field, index) => (
            <div key={field.id || index} className="flex items-center gap-2 p-2 border rounded-lg bg-gray-50/50">
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm">{field.name}</span>
                <span className="text-xs text-gray-500 mr-2">
                  ({EXTRA_FIELD_TYPES.find(t => t.value === field.type)?.label || field.type})
                </span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditField(index)}>
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeField(index)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={showFieldDialog} onOpenChange={setShowFieldDialog}>
        <DialogContent dir="rtl" className="sm:max-w-[400px]" onPointerDownOutside={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{editingIndex !== null ? 'עריכת שדה' : 'שדה נוסף לאיש קשר'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>שם השדה *</Label>
              <Input
                value={fieldForm.name}
                onChange={(e) => setFieldForm(p => ({ ...p, name: e.target.value }))}
                placeholder="למשל: תפקיד"
                autoFocus
              />
            </div>
            <div>
              <Label>סוג</Label>
              <Select value={fieldForm.type} onValueChange={(v) => setFieldForm(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXTRA_FIELD_TYPES.map(ft => (
                    <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {fieldForm.type === 'select' && (
              <div>
                <Label>אפשרויות (מופרדות בפסיק)</Label>
                <Input
                  value={fieldForm.options}
                  onChange={(e) => setFieldForm(p => ({ ...p, options: e.target.value }))}
                  placeholder="אפשרות 1, אפשרות 2"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowFieldDialog(false)}>ביטול</Button>
            <Button onClick={saveField} disabled={!fieldForm.name.trim()}>
              {editingIndex !== null ? 'עדכן' : 'הוסף'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}