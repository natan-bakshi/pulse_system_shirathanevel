import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Users } from "lucide-react";
import FieldLabel from "../FieldLabel";

/**
 * בורר מנהלים שיקבלו את ההתראה.
 * אם לא נבחרו מנהלים - כל המנהלים מקבלים (ברירת המחדל הקיימת).
 * אם נבחרו ספציפיים - רק הם יקבלו.
 */
export default function AdminRecipientsSelector({ template, onChange }) {
  const { data: admins = [], isLoading } = useQuery({
    queryKey: ['adminUsersForTemplate'],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role === 'admin');
    },
    staleTime: 5 * 60 * 1000
  });

  const selectedIds = Array.isArray(template.admin_recipient_ids) ? template.admin_recipient_ids : [];

  const toggleAdmin = (adminId) => {
    const isSelected = selectedIds.includes(adminId);
    const newIds = isSelected
      ? selectedIds.filter(id => id !== adminId)
      : [...selectedIds, adminId];
    onChange({ ...template, admin_recipient_ids: newIds });
  };

  const clearAll = () => {
    onChange({ ...template, admin_recipient_ids: [] });
  };

  // הצגה רק אם admin/system_creator נכלל בקהלי היעד
  const audiences = template.target_audiences || [];
  const isRelevant = audiences.includes('admin') || audiences.includes('system_creator');
  if (!isRelevant) return null;

  return (
    <div className="border rounded-lg p-3 bg-blue-50/50 mt-3">
      <div className="flex items-center justify-between mb-2">
        <FieldLabel
          label="אילו מנהלים יקבלו?"
          tooltip="אם לא נבחרו מנהלים - כל המנהלים יקבלו את ההתראה. אם נבחרו ספציפיים - רק הם יקבלו."
        />
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-blue-600 hover:underline"
          >
            נקה בחירה (כל המנהלים יקבלו)
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          טוען רשימת מנהלים...
        </div>
      ) : admins.length === 0 ? (
        <div className="text-sm text-gray-500 italic flex items-center gap-2">
          <Users className="h-4 w-4" />
          לא נמצאו מנהלים במערכת
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-600 mb-2">
            {selectedIds.length === 0
              ? '⚠️ לא נבחרו מנהלים - כל המנהלים יקבלו את ההתראה'
              : `נבחרו ${selectedIds.length} מנהלים מתוך ${admins.length}`}
          </p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {admins.map(admin => (
              <label
                key={admin.id}
                className="flex items-center gap-2 p-1.5 rounded hover:bg-white cursor-pointer text-sm"
              >
                <Checkbox
                  checked={selectedIds.includes(admin.id)}
                  onCheckedChange={() => toggleAdmin(admin.id)}
                />
                <span className="font-medium">{admin.full_name || admin.email}</span>
                <span className="text-xs text-gray-500">{admin.email}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}