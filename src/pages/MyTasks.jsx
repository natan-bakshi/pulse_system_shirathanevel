import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Loader2, Search, ChevronDown, ChevronUp, ListChecks, AlertCircle } from 'lucide-react';
import TaskItem from '@/components/tasks/TaskItem';
import TaskFormDialog from '@/components/tasks/TaskFormDialog';
import useTaskActions from '@/components/tasks/useTaskActions';

/**
 * דף "המשימות שלי" - מוצג רק למנהלים.
 * - לשונית "עבורי": משימות שהוקצו אישית למשתמש הנוכחי
 * - לשונית "ללא הקצאה": משימות שאינן מוקצות לאף אחד (מוצגות לכולם)
 * - לשונית "מוקצות לאחרים": משימות שהוקצו למנהלים אחרים (לא לי)
 * - מיון וסינון חכמים
 */
export default function MyTasks() {
  const [activeTab, setActiveTab] = useState('mine');
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterEvent, setFilterEvent] = useState('all');
  const [sortBy, setSortBy] = useState('smart');
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);

  // קבלת המשתמש הנוכחי
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
  });

  // הגדרות מערכת - לבדיקה האם מערכת המשימות פעילה
  const { data: appSettings = [] } = useQuery({
    queryKey: ['appSettings'],
    queryFn: () => base44.entities.AppSettings.list(),
    staleTime: 10 * 60 * 1000,
  });
  const tasksSystemEnabled = useMemo(() => {
    const s = appSettings.find(x => x.setting_key === 'tasks_system_enabled');
    return !s || s.setting_value !== 'false';
  }, [appSettings]);

  const { createTask, updateTask, deleteTask, toggleComplete, updateNotes, isSaving } = useTaskActions(currentUser);

  // טעינת כל המשימות (RLS מבטיח שרק מנהלים מקבלים)
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => base44.entities.Task.list('-created_date', 500),
    enabled: !!currentUser && currentUser.role === 'admin' && tasksSystemEnabled,
    staleTime: 30 * 1000,
  });

  // טעינת מנהלים
  const { data: admins = [] } = useQuery({
    queryKey: ['admins'],
    queryFn: async () => {
      const all = await base44.entities.User.list();
      return (all || []).filter(u => u.role === 'admin');
    },
    enabled: !!currentUser && currentUser.role === 'admin',
    staleTime: 5 * 60 * 1000,
  });

  // טעינת אירועים (לסינון ולתצוגת שם)
  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => base44.entities.Event.list('-event_date', 500),
    enabled: !!currentUser && currentUser.role === 'admin',
    staleTime: 60 * 1000,
  });

  // האם המשתמש הנוכחי מנהל
  const isAdmin = currentUser?.role === 'admin';

  // סינון לפי לשונית פעילה
  const filteredByTab = useMemo(() => {
    if (!currentUser) return [];
    const myId = currentUser.id;

    return tasks.filter(t => {
      const assignees = t.assignee_ids || [];
      if (activeTab === 'mine') {
        return assignees.includes(myId);
      }
      if (activeTab === 'unassigned') {
        return assignees.length === 0;
      }
      if (activeTab === 'others') {
        return assignees.length > 0 && !assignees.includes(myId);
      }
      return true;
    });
  }, [tasks, activeTab, currentUser]);

  // החלת חיפוש וסינון
  const filteredTasks = useMemo(() => {
    let result = [...filteredByTab];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    }

    if (filterPriority !== 'all') {
      result = result.filter(t => (t.priority || 'normal') === filterPriority);
    }

    if (filterEvent !== 'all') {
      if (filterEvent === 'none') {
        result = result.filter(t => !t.event_id);
      } else {
        result = result.filter(t => t.event_id === filterEvent);
      }
    }

    return result;
  }, [filteredByTab, search, filterPriority, filterEvent]);

  // הפרדה בין פתוחות לשבוצעו + מיון
  const { openTasks, completedTasks } = useMemo(() => {
    const open = [];
    const done = [];
    for (const t of filteredTasks) {
      if (t.is_completed) done.push(t);
      else open.push(t);
    }

    const priorityOrder = { high: 0, normal: 1, low: 2 };
    const myId = currentUser?.id;

    const sortFn = (a, b) => {
      if (sortBy === 'smart') {
        // עבור הלשונית "עבורי" - בעדיפות לאלה המוקצות לי
        if (activeTab !== 'mine') {
          // הדגשת "עבורי" - אם המשימה מוקצית לי תקבל עדיפות
          const aMine = (a.assignee_ids || []).includes(myId);
          const bMine = (b.assignee_ids || []).includes(myId);
          if (aMine !== bMine) return aMine ? -1 : 1;
        }

        // 1. עבר תאריך יעד
        const aOver = a.due_date && new Date(a.due_date) < new Date();
        const bOver = b.due_date && new Date(b.due_date) < new Date();
        if (aOver !== bOver) return aOver ? -1 : 1;

        // 2. דחיפות
        const pa = priorityOrder[a.priority] ?? 1;
        const pb = priorityOrder[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;

        // 3. תאריך יעד
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return da - db;
      }

      if (sortBy === 'due_date') {
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return da - db;
      }

      if (sortBy === 'priority') {
        const pa = priorityOrder[a.priority] ?? 1;
        const pb = priorityOrder[b.priority] ?? 1;
        return pa - pb;
      }

      if (sortBy === 'created') {
        return new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime();
      }

      return 0;
    };

    open.sort(sortFn);
    done.sort((a, b) => {
      const da = a.completion_date ? new Date(a.completion_date).getTime() : 0;
      const db = b.completion_date ? new Date(b.completion_date).getTime() : 0;
      return db - da;
    });

    return { openTasks: open, completedTasks: done };
  }, [filteredTasks, sortBy, activeTab, currentUser]);

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

  // ספירה לכל לשונית
  const counts = useMemo(() => {
    if (!currentUser) return { mine: 0, unassigned: 0, others: 0 };
    const myId = currentUser.id;
    let mine = 0, unassigned = 0, others = 0;
    for (const t of tasks) {
      if (t.is_completed) continue;
      const a = t.assignee_ids || [];
      if (a.includes(myId)) mine++;
      else if (a.length === 0) unassigned++;
      else others++;
    }
    return { mine, unassigned, others };
  }, [tasks, currentUser]);

  // הצג מסך שגיאה למי שאינו מנהל (אחרי כל ה-Hooks)
  if (currentUser && !isAdmin) {
    return (
      <div className="p-6 text-center">
        <Card className="bg-white/95 backdrop-blur-sm max-w-md mx-auto">
          <CardContent className="p-8">
            <AlertCircle className="h-12 w-12 mx-auto mb-3 text-red-600" />
            <h2 className="text-xl font-bold mb-2">אין הרשאה</h2>
            <p className="text-gray-600">דף זה זמין למנהלים בלבד.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // מערכת המשימות כבויה
  if (currentUser && isAdmin && !tasksSystemEnabled) {
    return (
      <div className="p-6 text-center">
        <Card className="bg-white/95 backdrop-blur-sm max-w-md mx-auto">
          <CardContent className="p-8">
            <AlertCircle className="h-12 w-12 mx-auto mb-3 text-amber-600" />
            <h2 className="text-xl font-bold mb-2">מערכת המשימות מושבתת</h2>
            <p className="text-gray-600">ניתן להפעיל אותה דרך דף ההגדרות.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
            <ListChecks className="h-7 w-7" />
            המשימות שלי
          </h1>
          <p className="text-white/80 text-sm mt-1">ניהול כל המשימות שלך מכל האירועים</p>
        </div>
        <Button onClick={handleOpenNew} className="bg-red-800 hover:bg-red-700 text-white w-full sm:w-auto">
          <Plus className="h-4 w-4 ml-1" />
          משימה חדשה
        </Button>
      </div>

      {/* פילטרים */}
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardContent className="p-3 sm:p-4 space-y-3">
          {/* חיפוש */}
          <div className="relative">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="חיפוש משימה..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>

          {/* מיון וסינון - גריד */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
                <SelectValue placeholder="מיון" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="smart">מיון חכם</SelectItem>
                <SelectItem value="due_date">לפי תאריך יעד</SelectItem>
                <SelectItem value="priority">לפי דחיפות</SelectItem>
                <SelectItem value="created">לפי תאריך יצירה</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger>
                <SelectValue placeholder="דחיפות" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הדחיפויות</SelectItem>
                <SelectItem value="high">גבוהה</SelectItem>
                <SelectItem value="normal">רגילה</SelectItem>
                <SelectItem value="low">נמוכה</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterEvent} onValueChange={setFilterEvent}>
              <SelectTrigger>
                <SelectValue placeholder="אירוע" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="all">כל האירועים</SelectItem>
                <SelectItem value="none">ללא שיוך לאירוע</SelectItem>
                {events.map(ev => (
                  <SelectItem key={ev.id} value={ev.id}>
                    {ev.event_name || ev.family_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* לשוניות משנה */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-3 w-full bg-white/80 backdrop-blur-sm">
          <TabsTrigger value="mine" className="text-xs sm:text-sm">
            עבורי {counts.mine > 0 && <span className="mr-1 text-amber-700 font-bold">({counts.mine})</span>}
          </TabsTrigger>
          <TabsTrigger value="unassigned" className="text-xs sm:text-sm">
            ללא הקצאה {counts.unassigned > 0 && <span className="mr-1">({counts.unassigned})</span>}
          </TabsTrigger>
          <TabsTrigger value="others" className="text-xs sm:text-sm">
            מוקצות לאחרים {counts.others > 0 && <span className="mr-1">({counts.others})</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
            <CardContent className="p-3 sm:p-4 space-y-3">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <>
                  {openTasks.length === 0 && completedTasks.length === 0 ? (
                    <div className="text-center py-10 text-gray-500">
                      <ListChecks className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">אין משימות בלשונית זו</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {openTasks.map(task => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          currentUser={currentUser}
                          admins={admins}
                          events={events}
                          showEvent={true}
                          highlightForCurrentUser={
                            activeTab !== 'mine' && (task.assignee_ids || []).includes(currentUser?.id)
                          }
                          onToggleComplete={toggleComplete}
                          onEdit={handleOpenEdit}
                          onDelete={deleteTask}
                          onUpdateNotes={updateNotes}
                        />
                      ))}

                      {openTasks.length === 0 && (
                        <p className="text-center text-sm text-gray-400 py-3">
                          אין משימות פתוחות בלשונית זו
                        </p>
                      )}
                    </div>
                  )}

                  {/* משימות שבוצעו */}
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
                              events={events}
                              showEvent={true}
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog יצירה/עריכה */}
      <TaskFormDialog
        open={showForm}
        onOpenChange={(o) => { setShowForm(o); if (!o) setEditingTask(null); }}
        initialData={editingTask}
        defaultEventId={null}
        events={events}
        admins={admins}
        onSave={handleSave}
        isSaving={isSaving}
        lockEvent={false}
      />
    </div>
  );
}