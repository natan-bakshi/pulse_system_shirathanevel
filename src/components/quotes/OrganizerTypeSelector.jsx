import React, { useState, useCallback, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Dropdown selector for organizer type.
 * Used in EventForm and EventDetails.
 * Loads default type when value is empty.
 */
export default function OrganizerTypeSelector({ value, onChange, disabled, className = "" }) {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const queryClient = useQueryClient();

  const { data: organizerTypes = [], isLoading } = useQuery({
    queryKey: ['organizerTypes'],
    queryFn: () => base44.entities.QuoteOrganizerType.list(),
    staleTime: 5 * 60 * 1000,
  });

  const activeTypes = organizerTypes
    .filter(t => t.is_active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  // Set default type ONLY when value is strictly undefined/null (new event, not yet set).
  // Empty string '' means user explicitly cleared it or it's being edited - don't auto-set.
  const defaultAppliedRef = React.useRef(false);
  useEffect(() => {
    if ((value === undefined || value === null) && activeTypes.length > 0 && !defaultAppliedRef.current) {
      const defaultType = activeTypes.find(t => t.is_default) || activeTypes[0];
      if (defaultType) {
        defaultAppliedRef.current = true;
        onChange(defaultType.type_name);
      }
    }
  }, [value, activeTypes, onChange]);

  const handleCreate = useCallback(async () => {
    if (!newTypeName.trim()) return;
    setIsCreating(true);
    try {
      const maxOrder = organizerTypes.reduce((max, t) => Math.max(max, t.order || 0), 0);
      await base44.entities.QuoteOrganizerType.create({
        type_name: newTypeName.trim(),
        is_default: false,
        is_active: true,
        order: maxOrder + 1
      });
      queryClient.invalidateQueries({ queryKey: ['organizerTypes'] });
      onChange(newTypeName.trim());
      setNewTypeName("");
      setShowNewDialog(false);
    } catch (error) {
      console.error("Failed to create organizer type:", error);
      alert("שגיאה ביצירת סוג הזמנה");
    } finally {
      setIsCreating(false);
    }
  }, [newTypeName, organizerTypes, queryClient, onChange]);

  if (isLoading) return null;
  if (activeTypes.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Label className="text-sm font-medium whitespace-nowrap">סוג הזמנה:</Label>
      <Select
        value={value || ''}
        onValueChange={(v) => {
          if (v === '__new__') {
            setShowNewDialog(true);
          } else {
            onChange(v);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger className="flex-1 min-w-[140px]">
          <SelectValue placeholder="בחר סוג הזמנה..." />
        </SelectTrigger>
        <SelectContent>
          {activeTypes.map(type => (
            <SelectItem key={type.id} value={type.type_name}>
              <span className="flex items-center gap-2">
                {type.type_name}
                {type.is_default && <span className="text-xs text-amber-600">(ברירת מחדל)</span>}
              </span>
            </SelectItem>
          ))}
          <SelectItem value="__new__" className="text-blue-600 font-medium border-t mt-1 pt-1">
            + הוסף סוג הזמנה חדש
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Create New Dialog */}
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
                placeholder="לדוגמה: חברה, מוסד, וכו'"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>ביטול</Button>
            <Button onClick={handleCreate} disabled={!newTypeName.trim() || isCreating}>
              {isCreating && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              צור
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}