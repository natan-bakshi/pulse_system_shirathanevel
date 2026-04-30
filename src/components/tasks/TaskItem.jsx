import React, { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChevronDown, ChevronUp, Edit2, Trash2, AlertCircle, Calendar as CalendarIcon,
  Users, User as UserIcon, Clock
} from 'lucide-react';
import TaskNotesSection from './TaskNotesSection';

const PRIORITY_LABELS = {
  high: { label: 'גבוהה', cls: 'bg-red-100 text-red-800 border-red-200' },
  normal: { label: 'רגילה', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
  low: { label: 'נמוכה', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
};

/**
 * מציג פריט משימה בודד
 * - תיבת סימון לסיום
 * - הצגה מקוצרת + הרחבה לפרטים והערות
 * - כפתורי עריכה ומחיקה
 * - הדגשה כאשר תאריך היעד עבר
 * - צבע אפור בהיר עבור משימות שבוצעו
 */
export default function TaskItem({
  task,
  currentUser,
  admins = [],
  events = [],
  showEvent = true,
  highlightForCurrentUser = false,
  onToggleComplete,
  onEdit,
  onDelete,
  onUpdateNotes,
}) {
  const [expanded, setExpanded] = useState(false);

  const isCompleted = !!task.is_completed;
  const isOverdue = !isCompleted && task.due_date && new Date(task.due_date) < new Date();

  const formatDateTime = (iso) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      const datePart = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const hasTime = !(hh === '00' && mm === '00');
      return hasTime ? `${datePart} ${hh}:${mm}` : datePart;
    } catch { return null; }
  };

  const dueDateStr = formatDateTime(task.due_date);
  const completionStr = formatDateTime(task.completion_date);
  const createdStr = formatDateTime(task.created_date);

  // הצגת מי הוקצה
  const assigneeNames = (task.assignee_ids || [])
    .map(id => admins.find(a => a.id === id))
    .filter(Boolean)
    .map(a => a.full_name || a.email);

  // אירוע משויך - לתצוגה
  const linkedEvent = task.event_id ? events.find(e => e.id === task.event_id) : null;

  const priorityCfg = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.normal;

  // צבעי טקסט - משימה שהושלמה תהיה אפורה בהירה
  const titleColor = isCompleted ? 'text-gray-400 line-through' : (isOverdue ? 'text-red-700 font-semibold' : 'text-gray-900');
  const metaColor = isCompleted ? 'text-gray-300' : 'text-gray-600';

  // עטיפה רקע
  const containerCls = [
    'p-3 rounded-lg border transition-all',
    isCompleted
      ? 'bg-gray-50/60 border-gray-200'
      : isOverdue
        ? 'bg-red-50/70 border-red-200'
        : highlightForCurrentUser
          ? 'bg-amber-50/70 border-amber-300'
          : 'bg-white border-gray-200 hover:border-gray-300'
  ].join(' ');

  return (
    <div className={containerCls}>
      <div className="flex items-start gap-2.5">
        {/* תיבת סימון */}
        <div className="pt-0.5 shrink-0">
          <Checkbox
            checked={isCompleted}
            onCheckedChange={() => onToggleComplete && onToggleComplete(task)}
            className="h-5 w-5"
            aria-label={isCompleted ? 'בטל סימון בוצע' : 'סמן כבוצע'}
          />
        </div>

        {/* תוכן עיקרי */}
        <div className="flex-1 min-w-0">
          {/* כותרת + פעולות */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className={`text-sm sm:text-base font-medium break-words ${titleColor}`}>
                {task.title}
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setExpanded(!expanded)}
                className="h-7 w-7 p-0"
                aria-label={expanded ? 'סגור פרטים' : 'הרחב פרטים'}
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onEdit && onEdit(task)}
                className="h-7 w-7 p-0"
                aria-label="ערוך משימה"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onDelete && onDelete(task)}
                className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                aria-label="מחק משימה"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* מטה-דאטה תמציתי - תאריך, הקצאה, דחיפות */}
          <div className={`flex flex-wrap items-center gap-1.5 mt-1.5 text-xs ${metaColor}`}>
            {dueDateStr && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                isOverdue && !isCompleted ? 'bg-red-100 text-red-800 font-medium' : 'bg-gray-100'
              }`}>
                {isOverdue && !isCompleted ? <AlertCircle className="h-3 w-3" /> : <CalendarIcon className="h-3 w-3" />}
                <span>{dueDateStr}</span>
              </span>
            )}

            {assigneeNames.length === 0 ? (
              <Badge variant="outline" className="text-xs h-5 px-1.5 gap-1">
                <Users className="h-3 w-3" />
                לכל המנהלים
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs h-5 px-1.5 gap-1">
                <UserIcon className="h-3 w-3" />
                {assigneeNames.length === 1
                  ? assigneeNames[0]
                  : `${assigneeNames[0]} +${assigneeNames.length - 1}`}
              </Badge>
            )}

            {task.priority && task.priority !== 'normal' && (
              <Badge className={`text-xs h-5 px-1.5 ${priorityCfg.cls}`}>
                {priorityCfg.label}
              </Badge>
            )}

            {showEvent && linkedEvent && (
              <Badge variant="secondary" className="text-xs h-5 px-1.5 max-w-[200px] truncate">
                {linkedEvent.event_name || linkedEvent.family_name}
              </Badge>
            )}

            {highlightForCurrentUser && !isCompleted && (
              <Badge className="text-xs h-5 px-1.5 bg-amber-200 text-amber-900 border-amber-300">
                עבורי
              </Badge>
            )}
          </div>

          {/* תוכן מורחב */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
              {task.description && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">תיאור</div>
                  <p className={`text-sm whitespace-pre-wrap break-words ${isCompleted ? 'text-gray-400' : 'text-gray-800'}`}>
                    {task.description}
                  </p>
                </div>
              )}

              {assigneeNames.length > 1 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">הוקצו</div>
                  <div className="flex flex-wrap gap-1">
                    {assigneeNames.map((name, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{name}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  נוצר ב-{createdStr || '—'}
                </span>
                {task.created_by && (
                  <span>על ידי: <span className="font-medium">{task.created_by}</span></span>
                )}
                {isCompleted && completionStr && (
                  <span className="text-green-700">בוצע ב-{completionStr}{task.completed_by_user_name ? ` ע״י ${task.completed_by_user_name}` : ''}</span>
                )}
              </div>

              <TaskNotesSection
                notes={task.notes || []}
                currentUser={currentUser}
                onChange={(newNotes) => onUpdateNotes && onUpdateNotes(task, newNotes)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}