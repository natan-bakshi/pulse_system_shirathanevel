import { useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Hook עם פעולות CRUD על משימות.
 * - יוצר עם invalidate על מפתחות שונים: ['tasks'] ו-['tasks', eventId]
 * - מחזיר פונקציות שמסתמכות על React Query mutations
 */
export default function useTaskActions(currentUser) {
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (payload) => base44.entities.Task.create(payload),
    onSuccess: invalidateAll,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Task.update(id, data),
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Task.delete(id),
    onSuccess: invalidateAll,
  });

  const createTask = useCallback(async (payload) => {
    return await createMutation.mutateAsync(payload);
  }, [createMutation]);

  const updateTask = useCallback(async (id, data) => {
    return await updateMutation.mutateAsync({ id, data });
  }, [updateMutation]);

  const deleteTask = useCallback(async (task) => {
    if (!window.confirm(`למחוק את המשימה "${task.title}"?`)) return false;
    await deleteMutation.mutateAsync(task.id);
    return true;
  }, [deleteMutation]);

  const toggleComplete = useCallback(async (task) => {
    const newCompleted = !task.is_completed;
    const updates = {
      is_completed: newCompleted,
    };
    if (newCompleted) {
      updates.completion_date = new Date().toISOString();
      updates.completed_by_user_id = currentUser?.id || '';
      updates.completed_by_user_name = currentUser?.full_name || currentUser?.email || '';
    } else {
      updates.completion_date = null;
      updates.completed_by_user_id = null;
      updates.completed_by_user_name = null;
    }
    await updateMutation.mutateAsync({ id: task.id, data: updates });
  }, [updateMutation, currentUser]);

  const updateNotes = useCallback(async (task, newNotes) => {
    await updateMutation.mutateAsync({ id: task.id, data: { notes: newNotes } });
  }, [updateMutation]);

  return {
    createTask,
    updateTask,
    deleteTask,
    toggleComplete,
    updateNotes,
    isSaving: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
  };
}