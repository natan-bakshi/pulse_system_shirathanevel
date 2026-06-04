import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Edit, Trash2, Loader2, Star, GripVertical } from "lucide-react";
import OrganizerTypeEditor from "./OrganizerTypeEditor";

export default function OrganizerTypesTab() {
  const [editingType, setEditingType] = useState(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const { data: organizerTypes = [], isLoading } = useQuery({
    queryKey: ['organizerTypes'],
    queryFn: () => base44.entities.QuoteOrganizerType.list(),
    staleTime: 5 * 60 * 1000,
  });

  const sortedTypes = [...organizerTypes]
    .filter(t => t.is_active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const handleCreateType = useCallback(async () => {
    if (!newTypeName.trim()) return;
    setIsSaving(true);
    try {
      const maxOrder = organizerTypes.reduce((max, t) => Math.max(max, t.order || 0), 0);
      const created = await base44.entities.QuoteOrganizerType.create({
        type_name: newTypeName.trim(),
        is_default: organizerTypes.length === 0,
        is_active: true,
        order: maxOrder + 1
      });
      setNewTypeName("");
      setShowNewDialog(false);
      queryClient.invalidateQueries({ queryKey: ['organizerTypes'] });
      // Open editor for the new type
      setEditingType(created);
    } catch (error) {
      console.error("Failed to create organizer type:", error);
      alert("שגיאה ביצירת סוג הזמנה");
    } finally {
      setIsSaving(false);
    }
  }, [newTypeName, organizerTypes, queryClient]);

  const handleSetDefault = useCallback(async (typeId) => {
    setIsSaving(true);
    try {
      // Remove default from all
      const currentDefault = organizerTypes.find(t => t.is_default);
      if (currentDefault && currentDefault.id !== typeId) {
        await base44.entities.QuoteOrganizerType.update(currentDefault.id, { is_default: false });
      }
      await base44.entities.QuoteOrganizerType.update(typeId, { is_default: true });
      queryClient.invalidateQueries({ queryKey: ['organizerTypes'] });
    } catch (error) {
      console.error("Failed to set default:", error);
    } finally {
      setIsSaving(false);
    }
  }, [organizerTypes, queryClient]);

  const handleDelete = useCallback(async (typeId) => {
    const type = organizerTypes.find(t => t.id === typeId);
    if (type?.is_default) {
      alert("לא ניתן למחוק את סוג ההזמנה שמוגדר כברירת מחדל");
      return;
    }
    if (!confirm(`האם למחוק את סוג ההזמנה "${type?.type_name}"?`)) return;
    try {
      await base44.entities.QuoteOrganizerType.update(typeId, { is_active: false });
      queryClient.invalidateQueries({ queryKey: ['organizerTypes'] });
    } catch (error) {
      console.error("Failed to delete type:", error);
    }
  }, [organizerTypes, queryClient]);

  const handleSaveType = useCallback(async (updatedType) => {
    setIsSaving(true);
    try {
      await base44.entities.QuoteOrganizerType.update(updatedType.id, updatedType);
      queryClient.invalidateQueries({ queryKey: ['organizerTypes'] });
      setEditingType(null);
    } catch (error) {
      console.error("Failed to save type:", error);
      alert("שגיאה בשמירת סוג ההזמנה");
    } finally {
      setIsSaving(false);
    }
  }, [queryClient]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  // If editing a type, show the editor
  if (editingType) {
    return (
      <OrganizerTypeEditor
        type={editingType}
        onSave={handleSaveType}
        onCancel={() => setEditingType(null)}
        isSaving={isSaving}
      />
    );
  }

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>סוגי הזמנות</CardTitle>
          <Button onClick={() => setShowNewDialog(true)} size="sm">
            <Plus className="h-4 w-4 ml-2" />
            הוסף סוג הזמנה
          </Button>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          הגדרת סוגי הזמנות שונים עם שדות, כותרות ובלוקים מותאמים אישית להצעות מחיר.
          סוג ללא הגדרות ישתמש בברירת המחדל הקיימת.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {sortedTypes.length === 0 && (
          <p className="text-center text-gray-500 py-4">אין סוגי הזמנות מוגדרים</p>
        )}

        {sortedTypes.map(type => {
          const fieldsCount = (() => {
            try { return JSON.parse(type.event_fields || '[]').length; } catch { return 0; }
          })();
          const blocksCount = (() => {
            try { return JSON.parse(type.quote_blocks || '[]').length; } catch { return 0; }
          })();

          return (
            <div key={type.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{type.type_name}</span>
                    {type.is_default && (
                      <Badge className="bg-amber-100 text-amber-800 text-xs">ברירת מחדל</Badge>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {fieldsCount > 0 ? `${fieldsCount} שדות` : 'שדות ברירת מחדל'}
                    {' · '}
                    {blocksCount > 0 ? `${blocksCount} בלוקים` : 'בלוקים ברירת מחדל'}
                    {type.quote_main_title_template ? ' · כותרת מותאמת' : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!type.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSetDefault(type.id)}
                    disabled={isSaving}
                    title="הגדר כברירת מחדל"
                    className="text-amber-600 hover:text-amber-700"
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingType(type)}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                {!type.is_default && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(type.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>

      {/* Dialog for creating new type */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent dir="rtl" className="sm:max-w-[400px]" onPointerDownOutside={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>סוג הזמנה חדש</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>שם סוג ההזמנה</Label>
              <Input
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="לדוגמה: מוסד, חברה, וכו'"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateType()}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>ביטול</Button>
            <Button onClick={handleCreateType} disabled={!newTypeName.trim() || isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              צור סוג הזמנה
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}