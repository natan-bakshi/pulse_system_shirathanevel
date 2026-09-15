import React, { useState } from "react";
import { SYSTEM_EVENT_FIELDS, SYSTEM_FIELDS_BY_KEY, makeSystemField, systemKey } from "@/lib/eventFields";
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

const EXTRA_SYSTEM_TYPES = [{ value:'concept', label:'בחירת קונספט' }, { value:'contacts', label:'אנשי קשר' }, { value:'schedule', label:'לוח זמנים' }];
const FIELD_TYPE_LABELS = [...FIELD_TYPES,...EXTRA_SYSTEM_TYPES].reduce((acc, ft) => { acc[ft.value] = ft.label; return acc; }, {});

export default function OrganizerFieldsEditor({ fields, onChange }) {
  const [showFieldDialog, setShowFieldDialog] = useState(false);
  const [showSystemDialog, setShowSystemDialog] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [search, setSearch] = useState('');
  const existingKeys = new Set(fields.map(systemKey).filter(Boolean));
  const availableFields = SYSTEM_EVENT_FIELDS.filter(f => !existingKeys.has(f.key));
  const visibleFields = SYSTEM_EVENT_FIELDS.filter(f => f.name.includes(search.trim()) || f.key.includes(search.trim()));
  const addSystemFields = () => {
    const added = availableFields.filter(f => selectedKeys.includes(f.key)).map((f, index) => makeSystemField(f.key, { order: fields.length + index }));
    onChange([...fields, ...added]);
    setShowSystemDialog(false);
    setSelectedKeys([]);
  };
  const [editingFieldIndex, setEditingFieldIndex] = useState(null);
  const editingSystemKey = editingFieldIndex !== null ? systemKey(fields[editingFieldIndex]) : null;
  const [fieldForm, setFieldForm] = useState({ id: '', name: '', type: 'text', required: false, placeholder: '', options: '', category: 'event_details' });

  const openNewField = () => {
    setEditingFieldIndex(null);
    setFieldForm({ id: '', name: '', type: 'text', required: false, placeholder: '', options: '', category: 'event_details' });
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
      options: Array.isArray(f.options) ? f.options.join(', ') : (f.options || ''),
      category: f.category || 'event_details'
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
      category: fieldForm.category,
      order: editingFieldIndex !== null ? fields[editingFieldIndex].order : fields.length
    };

    if (editingFieldIndex !== null) {
      const updated = [...fields];
      updated[editingFieldIndex] = editingSystemKey ? makeSystemField(editingSystemKey, { ...updated[editingFieldIndex], ...newField }) : { ...updated[editingFieldIndex], ...newField, source: "custom" };
      onChange(updated);
    } else {
      onChange([...fields, { ...newField, source: "custom" }]);
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
          <h4 className="font-semibold text-sm">שדות האירוע ({fields.length})</h4>
          <p className="text-xs text-gray-500">בחר שדות מערכת מחוברים או הוסף מידע מותאם. שינוי כותרת אינו משנה את חיבור השדה.</p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => { setSelectedKeys([]); setSearch(''); setShowSystemDialog(true); }}><Plus className="h-4 w-4 ml-1" />הוסף שדות מערכת</Button>
        <Button type="button" size="sm" variant="outline" onClick={openNewField}>
          <Plus className="h-4 w-4 ml-1" />
          הוסף שדה מותאם
        </Button>
        </div>
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
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5 flex-wrap">
                <span>{systemKey(field) ? 'שדה מערכת' : 'שדה מותאם'} · {FIELD_TYPE_LABELS[field.type] || field.type}</span>
                {systemKey(field) && <Badge variant="outline" className="text-[10px]" dir="ltr">{systemKey(field)}</Badge>}
                {field.type === 'select' && field.options ? <span>({Array.isArray(field.options) ? field.options.length : 0} אפשרויות)</span> : null}
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${field.category === 'organizer_details' ? 'border-purple-300 text-purple-600' : 'border-blue-300 text-blue-600'}`}>
                  {field.category === 'organizer_details' ? 'פרטי מזמין/ה' : 'פרטי אירוע'}
                </Badge>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditField(index)}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeField(index)} disabled={!!SYSTEM_FIELDS_BY_KEY[systemKey(field)]?.required} title={SYSTEM_FIELDS_BY_KEY[systemKey(field)]?.required ? "שדה חובה של האירוע" : "הסר מהתצוגה (המידע נשמר)"}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={showSystemDialog} onOpenChange={setShowSystemDialog}>
        <DialogContent dir="rtl" className="sm:max-w-[650px] max-h-[85vh] flex flex-col" onPointerDownOutside={e => e.stopPropagation()}>
          <DialogHeader><DialogTitle>הוספת שדות מערכת</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-500">בחר כמה שדות להוסיף. אפשר לשנות את הכותרת שלהם לאחר ההוספה.</p>
          <Input aria-label="חיפוש שדות מערכת" placeholder="חפש שדה..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="flex gap-2 items-center flex-wrap">
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectedKeys(availableFields.map(f => f.key))}>בחר הכל</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectedKeys([])}>נקה בחירה</Button>
            <span className="text-sm text-gray-500">נבחרו {selectedKeys.length} שדות</span>
          </div>
          <div className="overflow-y-auto min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-2 py-1">
            {visibleFields.map(field => {
              const added = existingKeys.has(field.key);
              return <label key={field.key} className={`flex gap-3 items-start rounded-lg border p-3 ${added ? 'bg-gray-50 text-gray-400' : 'cursor-pointer hover:bg-blue-50'}`}>
                <Checkbox aria-label={field.name} checked={added || selectedKeys.includes(field.key)} disabled={added} onCheckedChange={checked => setSelectedKeys(prev => checked ? [...prev, field.key] : prev.filter(k => k !== field.key))} />
                <span><span className="block text-sm font-medium">{field.name}</span><span className="block text-xs text-gray-500">{added ? 'כבר נוסף' : ['contacts','schedule','financial','services'].includes(field.category) ? 'במקטע הקיים בכרטיסיית האירוע' : field.category === 'organizer_details' ? 'פרטי המזמין' : 'פרטי האירוע'}</span></span>
              </label>;
            })}
            {!visibleFields.length && <p className="text-sm text-gray-500 p-4">לא נמצאו שדות</p>}
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={() => setShowSystemDialog(false)}>ביטול</Button>
            <Button type="button" disabled={!selectedKeys.length} onClick={addSystemFields}>הוסף {selectedKeys.length || ''} שדות</Button>
          </div>
        </DialogContent>
      </Dialog>
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
              <Select disabled={!!editingSystemKey} value={fieldForm.type} onValueChange={(v) => setFieldForm(prev => ({ ...prev, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...FIELD_TYPES,...(editingSystemKey ? EXTRA_SYSTEM_TYPES : [])].map(ft => (
                    <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {fieldForm.type === 'select' && !editingSystemKey && (
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
            <div>
              <Label>מיקום השדה</Label>
              <Select disabled={!!editingSystemKey} value={fieldForm.category} onValueChange={(v) => setFieldForm(prev => ({ ...prev, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="event_details">פרטי האירוע</SelectItem>
                  <SelectItem value="organizer_details">פרטי המזמין/ה</SelectItem>
                  {editingSystemKey && <><SelectItem value="contacts">אנשי קשר</SelectItem><SelectItem value="schedule">לוח זמנים</SelectItem><SelectItem value="financial">סיכום כספי</SelectItem><SelectItem value="services">שירותים</SelectItem></>}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="field_required"
                disabled={!!SYSTEM_FIELDS_BY_KEY[editingSystemKey]?.required}
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
