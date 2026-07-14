import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Search, Users, X, ChevronDown } from 'lucide-react';

/**
 * רכיב בחירת מנהלים - בחירה מרובה
 * מקבל רשימה של מנהלים (admins) ומחזיר את ה-IDs שנבחרו
 */
export default function AdminMultiSelect({ admins = [], selectedIds = [], onChange, placeholder = "בחר מנהלים..." }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredAdmins = useMemo(() => {
    if (!search) return admins;
    const s = search.toLowerCase();
    return admins.filter(a =>
      (a.full_name || '').toLowerCase().includes(s) ||
      (a.email || '').toLowerCase().includes(s)
    );
  }, [admins, search]);

  const selectedAdmins = useMemo(() => {
    return admins.filter(a => selectedIds.includes(a.id));
  }, [admins, selectedIds]);

  const toggleAdmin = (adminId) => {
    if (selectedIds.includes(adminId)) {
      onChange(selectedIds.filter(id => id !== adminId));
    } else {
      onChange([...selectedIds, adminId]);
    }
    setSearch("");
  };

  const removeAdmin = (e, adminId) => {
    e.stopPropagation();
    onChange(selectedIds.filter(id => id !== adminId));
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between text-right h-auto min-h-[40px] py-2"
          >
            <div className="flex flex-wrap gap-1 items-center flex-1 min-w-0">
              {selectedAdmins.length === 0 ? (
                <span className="text-gray-500 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {placeholder}
                </span>
              ) : (
                selectedAdmins.map(admin => (
                  <Badge key={admin.id} variant="secondary" className="gap-1 max-w-full">
                    <span className="truncate">{admin.full_name || admin.email}</span>
                    <X
                      className="h-3 w-3 cursor-pointer hover:text-red-600 shrink-0"
                      onClick={(e) => removeAdmin(e, admin.id)}
                    />
                  </Badge>
                ))
              )}
            </div>
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start" dir="rtl">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute right-2 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="חיפוש מנהל..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-8 h-9"
              />
            </div>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {filteredAdmins.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">לא נמצאו מנהלים</div>
            ) : (
              filteredAdmins.map(admin => (
                <div
                  key={admin.id}
                  className="flex items-center gap-2 p-2 hover:bg-gray-100 cursor-pointer"
                  onClick={() => toggleAdmin(admin.id)}
                >
                  <Checkbox
                    checked={selectedIds.includes(admin.id)}
                    onCheckedChange={() => toggleAdmin(admin.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{admin.full_name || 'ללא שם'}</div>
                    <div className="text-xs text-gray-500 truncate">{admin.email}</div>
                  </div>
                </div>
              ))
            )}
          </div>
          {selectedIds.length > 0 && (
            <div className="p-2 border-t flex justify-between items-center">
              <span className="text-xs text-gray-500">{selectedIds.length} נבחרו</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange([])}
                className="text-xs h-7"
              >
                נקה
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <p className="text-xs text-gray-500">
        ללא בחירה - המשימה תופיע לכל המנהלים
      </p>
    </div>
  );
}