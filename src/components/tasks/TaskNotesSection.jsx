import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Edit2, Trash2, Save, X, MessageSquare } from 'lucide-react';

/**
 * רכיב לניהול הערות בתוך משימה
 * - כל הערה: id, content, created_by_user_id/name, created_at, updated_at
 * - כפתור הוספה -> פותח textarea
 * - כל הערה ניתנת לעריכה ולמחיקה
 */
export default function TaskNotesSection({ notes = [], currentUser, onChange }) {
  const [isAdding, setIsAdding] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editText, setEditText] = useState('');

  const formatDate = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('he-IL', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  const handleAddNote = () => {
    const trimmed = newNoteText.trim();
    if (!trimmed) return;

    const newNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: trimmed,
      created_by_user_id: currentUser?.id || '',
      created_by_user_name: currentUser?.full_name || currentUser?.email || 'משתמש',
      created_at: new Date().toISOString(),
    };

    onChange([...(notes || []), newNote]);
    setNewNoteText('');
    setIsAdding(false);
  };

  const handleStartEdit = (note) => {
    setEditingNoteId(note.id);
    setEditText(note.content);
  };

  const handleSaveEdit = (noteId) => {
    const trimmed = editText.trim();
    if (!trimmed) return;

    const updated = (notes || []).map(n =>
      n.id === noteId
        ? { ...n, content: trimmed, updated_at: new Date().toISOString() }
        : n
    );
    onChange(updated);
    setEditingNoteId(null);
    setEditText('');
  };

  const handleDelete = (noteId) => {
    if (!window.confirm('למחוק הערה זו?')) return;
    onChange((notes || []).filter(n => n.id !== noteId));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <MessageSquare className="h-3.5 w-3.5" />
          <span>הערות ({(notes || []).length})</span>
        </div>
        {!isAdding && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setIsAdding(true)}
            className="h-7 text-xs"
          >
            <Plus className="h-3 w-3 ml-1" />
            הוסף הערה
          </Button>
        )}
      </div>

      {/* טופס הוספת הערה חדשה */}
      {isAdding && (
        <div className="space-y-2 p-2 bg-blue-50 rounded-md border border-blue-100">
          <Textarea
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            placeholder="הקלד הערה..."
            rows={2}
            className="text-sm"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { setIsAdding(false); setNewNoteText(''); }}
              className="h-7 text-xs"
            >
              ביטול
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleAddNote}
              disabled={!newNoteText.trim()}
              className="h-7 text-xs"
            >
              <Save className="h-3 w-3 ml-1" />
              שמור
            </Button>
          </div>
        </div>
      )}

      {/* רשימת הערות קיימות */}
      {(notes || []).length === 0 && !isAdding ? (
        <p className="text-xs text-gray-400 italic py-1">אין הערות עדיין</p>
      ) : (
        <div className="space-y-2">
          {(notes || []).map(note => (
            <div key={note.id} className="p-2 bg-gray-50 rounded-md border border-gray-200 group">
              {editingNoteId === note.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={2}
                    className="text-sm"
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => { setEditingNoteId(null); setEditText(''); }}
                      className="h-7 text-xs"
                    >
                      <X className="h-3 w-3 ml-1" />
                      ביטול
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleSaveEdit(note.id)}
                      disabled={!editText.trim()}
                      className="h-7 text-xs"
                    >
                      <Save className="h-3 w-3 ml-1" />
                      שמור
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                    {note.content}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-200">
                    <div className="text-xs text-gray-500">
                      <span className="font-medium">{note.created_by_user_name || 'משתמש'}</span>
                      <span className="mx-1">·</span>
                      <span>{formatDate(note.created_at)}</span>
                      {note.updated_at && note.updated_at !== note.created_at && (
                        <span className="mr-1 italic">(עודכן)</span>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleStartEdit(note)}
                        className="h-6 w-6 p-0"
                        title="עריכה"
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(note.id)}
                        className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                        title="מחיקה"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}