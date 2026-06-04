import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Edit, Star, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const FIELD_TYPES = [
  { value: 'text', label: 'טקסט' },
  { value: 'number', label: 'מספר' },
  { value: 'email', label: 'אימייל' },
  { value: 'phone', label: 'טלפון' },
  { value: 'textarea', label: 'תיאור (שורות)' },
  { value: 'select', label: 'בחירה מרשימה' },
  { value: 'date', label: 'תאריך' },
  { value: 'time', label: 'שעה' },
  { value: 'url', label: 'קישור' },
];

const FIELD_TYPE_LABELS = FIELD_TYPES.reduce((acc, ft) => { acc[ft.value] = ft.label; return acc; }, {});

export default function OrganizerFieldsEditor({ fields, onChange }) {
  const [showFieldDialog, setShowFieldDialog] = useState(false);
  const [editingFieldIndex, setEditingFieldIndex] = useState(null);
  const [fieldForm, setFieldForm] = useState({ id: '', name: '', type: 'text', required: false, placeholder: '', options: '' });

  const openNewField = () => {
    setEditingFieldIndex(null);
    setFieldForm({ id: '', name: '', type: 'text', required: false, placeholder: '', options: '' });
    setShowFieldDialog(true);
  };

  const openEditField = (index) => {
    const f = fields[index];
    setEditingFieldIndex(index);
    setFieldForm({
      id: f.id || '',
      name: f.name || '',
      type: f.type || 'text',
      required: f.required || false,
      placeholder: f.placeholder || '',
      options: Array.isArray(f.options) ? f.options.join(', ') : (f.options || '')
    });
    setShowFieldDialog(true);
  };

  const saveField = () => {
    const id = fieldForm.id || fieldForm.name.replace(/\s+/g, '_').toLowerCase() + '_' + Date.now();
    const newField = {
      id,
      name: fieldForm.name,
      type: fieldForm.type,
      required: fieldForm.required,
      placeholder: fieldForm.placeholder,
      options: fieldForm.type === 'select' ? fieldForm.options.split(',').map(o => o.trim()).filter(Boolean) : undefined,
      order: editingFieldIndex !== null ? fields[editingFieldIndex].order : fields.length
    };

    if (editingFieldIndex !== null) {
      const updated = [...fields];
      updated[editingFieldIndex] = { ...updated[editingFieldIndex], ...newField };
      onChange(updated);
    } else {
      onChange([...fields, newField]);
    }
    setShowFieldDialog(false);
  };

  const removeField = (index) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="font-semibold text-sm">שדות דינמיים ({fields.length})</h4>
          <p className="text-xs text-gray-500">שדות שיופיעו בכרטיסיית האירוע. ריק = שדות ברירת מחדל (שם משפחה, שם ילד וכו')</p>
        </div>
        <Button size="sm" variant="outline" onClick={openNewField}>
          <Plus className="h-4 w-4 ml-1" />
          הוסף שדה
        </Button>
      </div>

      {fields.length === 0 && (
        <div className="text-center py-6 border-2 border-dashed rounded-lg text-gray-400 text-sm">
          לא הוגדרו שדות מותאמים - ישמשו שדות ברירת מחדל
        </div>
      )}

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id || index} className="flex items-center gap-2 p-3 border rounded-lg bg-gray-50/50 hover:bg-gray-50">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{field.name}</span>
                {field.required && <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {FIELD_TYPE_LABELS[field.type] || field.type}
                {field.type === 'select' && field.options ? ` (${Array.isArray(field.options) ? field.options.length : 0} אפשרויות)` : ''}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditField(index)}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeField(index)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {/* Field Dialog */}
      <Dialog open={showFieldDialog} onOpenChange={setShowFieldDialog}>
        <DialogContent dir="rtl" className="sm:max-w-[450px]" onPointerDownOutside={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{editingFieldIndex !== null ? 'עריכת שדה' : 'שדה חדש'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>שם השדה *</Label>
              <Input
                value={fieldForm.name}
                onChange={(e) => setFieldForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="לדוגמה: שם החברה"
                autoFocus
              />
            </div>
            <div>
              <Label>סוג ערך</Label>
              <Select value={fieldForm.type} onValueChange={(v) => setFieldForm(prev => ({ ...prev, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(ft => (
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
                  onChange={(e) => setFieldForm(prev => ({ ...prev, options: e.target.value }))}
                  placeholder="אפשרות 1, אפשרות 2, אפשרות 3"
                />
              </div>
            )}
            <div>
              <Label>טקסט עזר (Placeholder)</Label>
              <Input
                value={fieldForm.placeholder}
                onChange={(e) => setFieldForm(prev => ({ ...prev, placeholder: e.target.value }))}
                placeholder="טקסט שיופיע כשהשדה ריק"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="field_required"
                checked={fieldForm.required}
                onCheckedChange={(checked) => setFieldForm(prev => ({ ...prev, required: checked }))}
              />
              <Label htmlFor="field_required">שדה חובה</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowFieldDialog(false)}>ביטול</Button>
            <Button onClick={saveField} disabled={!fieldForm.name.trim()}>
              {editingFieldIndex !== null ? 'עדכן' : 'הוסף'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}