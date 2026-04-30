import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Loader2, ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import TaskItem from './TaskItem';
import TaskFormDialog from './TaskFormDialog';
import useTaskActions from './useTaskActions';

/**
 * לשונית "משימות לביצוע" בכרטיסיית האירוע.
 * - טוענת משימות לפי event_id
 * - מאפשרת יצירה, עריכה, מחיקה וסימון בוצע
 * - מציגה משימות פתוחות + רשימה מתקפלת של משימות שבוצעו
 */
export default function EventTasksTab({ eventId, currentUser }) {
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const { createTask, updateTask, deleteTask, toggleComplete, updateNotes, isSaving } = useTaskActions(currentUser);

  // טעינת משימות לאירוע
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', 'event', eventId],
    queryFn: () => base44.entities.Task.filter({ event_id: eventId }),
    enabled: !!eventId,
    staleTime: 30 * 1000,
  });

  // טעינת מנהלים (לבחירת הקצאה ולהצגת שמות)
  const { data: admins = [] } = useQuery({
    queryKey: ['admins'],
    queryFn: async () => {
      const all = await base44.entities.User.list();
      return (all || []).filter(u => u.role === 'admin');
    },
    staleTime: 5 * 60 * 1000,
  });

  // הפרדה בין משימות פתוחות למשימות שבוצעו + מיון
  const { openTasks, completedTasks } = useMemo(() => {
    const open = [];
    const done = [];
    for (const t of tasks) {
      if (t.is_completed) done.push(t);
      else open.push(t);
    }

    const priorityOrder = { high: 0, normal: 1, low: 2 };
    open.sort((a, b) => {
      // קודם משימות שעבר תאריכן (overdue), אחר כך לפי דחיפות, אחר כך לפי תאריך יעד
      const aOver = a.due_date && new Date(a.due_date) < new Date();
      const bOver = b.due_date && new Date(b.due_date) < new Date();
      if (aOver !== bOver) return aOver ? -1 : 1;

      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;

      const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return da - db;
    });

    done.sort((a, b) => {
      const da = a.completion_date ? new Date(a.completion_date).getTime() : 0;
      const db = b.completion_date ? new Date(b.completion_date).getTime() : 0;
      return db - da;
    });

    return { openTasks: open, completedTasks: done };
  }, [tasks]);

  const handleOpenNew = () => {
    setEditingTask(null);
    setShowForm(true);
  };

  const handleOpenEdit = (task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const handleSave = async (payload) => {
    try {
      if (editingTask) {
        await updateTask(editingTask.id, payload);
      } else {
        await createTask(payload);
      }
      setShowForm(false);
      setEditingTask(null);
    } catch (err) {
      console.error('Failed to save task', err);
      alert('שגיאה בשמירת המשימה');
    }
  };

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardContent className="p-4 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-red-800" />
            <h3 className="text-lg font-semibold">משימות לביצוע</h3>
          </div>
          <Button onClick={handleOpenNew} className="bg-red-800 hover:bg-red-700 text-white">
            <Plus className="h-4 w-4 ml-1" />
            משימה חדשה
          </Button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        )}

        {/* רשימת משימות פתוחות */}
        {!isLoading && (
          <>
            {openTasks.length === 0 && completedTasks.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <ListChecks className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">אין משימות עדיין</p>
                <p className="text-xs mt-1">לחץ על "משימה חדשה" כדי להוסיף</p>
              </div>
            ) : (
              <div className="space-y-2">
                {openTasks.map(task => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    currentUser={currentUser}
                    admins={admins}
                    showEvent={false}
                    onToggleComplete={toggleComplete}
                    onEdit={handleOpenEdit}
                    onDelete={deleteTask}
                    onUpdateNotes={updateNotes}
                  />
                ))}

                {openTasks.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-3">
                    אין משימות פתוחות. כל הכבוד! 🎉
                  </p>
                )}
              </div>
            )}

            {/* רשימת משימות שבוצעו - מתקפלת */}
            {completedTasks.length > 0 && (
              <div className="pt-2 border-t border-gray-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="w-full justify-between text-sm text-gray-600 hover:text-gray-900"
                >
                  <span>משימות שבוצעו ({completedTasks.length})</span>
                  {showCompleted ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>

                {showCompleted && (
                  <div className="space-y-2 mt-2">
                    {completedTasks.map(task => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        currentUser={currentUser}
                        admins={admins}
                        showEvent={false}
                        onToggleComplete={toggleComplete}
                        onEdit={handleOpenEdit}
                        onDelete={deleteTask}
                        onUpdateNotes={updateNotes}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Dialog יצירה/עריכה */}
        <TaskFormDialog
          open={showForm}
          onOpenChange={(o) => { setShowForm(o); if (!o) setEditingTask(null); }}
          initialData={editingTask}
          defaultEventId={eventId}
          events={[]}
          admins={admins}
          onSave={handleSave}
          isSaving={isSaving}
          lockEvent={true}
        />
      </CardContent>
    </Card>
  );
}