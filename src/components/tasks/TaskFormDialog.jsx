import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import AdminMultiSelect from './AdminMultiSelect';

/**
 * דיאלוג ליצירה/עריכה של משימה
 * - אם יש eventId - השדה משוייך לאירוע מראש (לא ניתן לבחור אירוע אחר)
 * - אם אין eventId - ניתן לבחור אירוע מתוך רשימה (לבחירה אופציונלית)
 */
export default function TaskFormDialog({
  open,
  onOpenChange,
  initialData = null,
  defaultEventId = null,
  events = [],
  admins = [],
  onSave,
  isSaving = false,
  lockEvent = false,
}) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    event_id: '',
    due_date: '',
    due_time: '',
    assignee_ids: [],
    priority: 'normal',
  });

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      // פירוק due_date ל-תאריך + שעה
      let dueDate = '';
      let dueTime = '';
      if (initialData.due_date) {
        const d = new Date(initialData.due_date);
        if (!isNaN(d.getTime())) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const mi = String(d.getMinutes()).padStart(2, '0');
          dueDate = `${yyyy}-${mm}-${dd}`;
          dueTime = `${hh}:${mi}`;
        }
      }
      setForm({
        title: initialData.title || '',
        description: initialData.description || '',
        event_id: initialData.event_id || '',
        due_date: dueDate,
        due_time: dueTime,
        assignee_ids: initialData.assignee_ids || [],
        priority: initialData.priority || 'normal',
      });
    } else {
      setForm({
        title: '',
        description: '',
        event_id: defaultEventId || '',
        due_date: '',
        due_time: '',
        assignee_ids: [],
        priority: 'normal',
      });
    }
  }, [open, initialData, defaultEventId]);

  const handleSubmit = () => {
    if (!form.title.trim()) {
      alert('יש להזין כותרת למשימה');
      return;
    }

    // הרכבת due_date מהתאריך והשעה
    let dueDateIso = null;
    if (form.due_date) {
      const time = form.due_time || '09:00';
      const d = new Date(`${form.due_date}T${time}:00`);
      if (!isNaN(d.getTime())) {
        dueDateIso = d.toISOString();
      }
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      event_id: form.event_id || null,
      due_date: dueDateIso,
      assignee_ids: form.assignee_ids || [],
      priority: form.priority || 'normal',
    };

    onSave(payload);
  };

  // רשימת אירועים ממוינת לפי תאריך - לבחירה
  const sortedEvents = [...events]
    .filter(e => e.status !== 'cancelled')
    .sort((a, b) => {
      const da = new Date(a.event_date || 0).getTime();
      const db = new Date(b.event_date || 0).getTime();
      return db - da;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{initialData ? 'עריכת משימה' : 'משימה חדשה'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* כותרת */}
          <div className="space-y-1.5">
            <Label htmlFor="task-title">כותרת המשימה *</Label>
            <Input
              id="task-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="למשל: לאשר תפריט עם הקייטרינג"
            />
          </div>

          {/* תיאור */}
          <div className="space-y-1.5">
            <Label htmlFor="task-desc">תיאור (אופציונלי)</Label>
            <Textarea
              id="task-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="פרטים נוספים על המשימה..."
              rows={3}
            />
          </div>

          {/* אירוע - אם זמין */}
          {!lockEvent && (
            <div className="space-y-1.5">
              <Label>אירוע משויך (אופציונלי)</Label>
              <Select
                value={form.event_id || 'none'}
                onValueChange={(v) => setForm({ ...form, event_id: v === 'none' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="ללא שיוך לאירוע" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="none">ללא שיוך לאירוע</SelectItem>
                  {sortedEvents.map(ev => (
                    <SelectItem key={ev.id} value={ev.id}>
                      {ev.event_name || ev.family_name} - {ev.event_date ? new Date(ev.event_date).toLocaleDateString('he-IL') : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* תאריך + שעת יעד */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-due-date">תאריך יעד</Label>
              <Input
                id="task-due-date"
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due-time">שעת יעד</Label>
              <Input
                id="task-due-time"
                type="time"
                value={form.due_time}
                onChange={(e) => setForm({ ...form, due_time: e.target.value })}
                disabled={!form.due_date}
              />
            </div>
          </div>

          {/* דחיפות */}
          <div className="space-y-1.5">
            <Label>דחיפות</Label>
            <Select
              value={form.priority}
              onValueChange={(v) => setForm({ ...form, priority: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">נמוכה</SelectItem>
                <SelectItem value="normal">רגילה</SelectItem>
                <SelectItem value="high">גבוהה</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* הקצאה למנהלים */}
          <div className="space-y-1.5">
            <Label>הקצאה למנהלים</Label>
            <AdminMultiSelect
              admins={admins}
              selectedIds={form.assignee_ids}
              onChange={(ids) => setForm({ ...form, assignee_ids: ids })}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            ביטול
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
            {initialData ? 'עדכן משימה' : 'צור משימה'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}