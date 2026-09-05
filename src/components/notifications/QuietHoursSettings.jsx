import React from "react";
import { Clock, Moon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

/**
 * הגדרות שעות שקט ושבת - עובד מול שדות האמת בסכמת User:
 * quiet_hours_start / quiet_hours_end (HH:mm), quiet_hours_enabled, respect_shabbat.
 */
export default function QuietHoursSettings({
  quietStart,
  quietEnd,
  quietEnabled,
  respectShabbat,
  onChange
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Moon className="h-4 w-4" />
          שעות שקט
        </div>
        <Switch
          checked={quietEnabled}
          onCheckedChange={(checked) => onChange('quiet_hours_enabled', checked)}
        />
      </div>
      <p className="text-xs text-gray-500">
        בשעות אלו לא יישלחו התראות. התראות שנוצרו יישלחו בסיום שעות השקט.
      </p>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label htmlFor="quiet-start" className="text-sm">משעה:</Label>
          <Input
            id="quiet-start"
            type="time"
            className="w-28"
            value={quietStart}
            disabled={!quietEnabled}
            onChange={(e) => onChange('quiet_hours_start', e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="quiet-end" className="text-sm">עד שעה:</Label>
          <Input
            id="quiet-end"
            type="time"
            className="w-28"
            value={quietEnd}
            disabled={!quietEnabled}
            onChange={(e) => onChange('quiet_hours_end', e.target.value)}
          />
        </div>
      </div>

      {quietEnabled && quietStart && quietEnd && (
        <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
          <Clock className="h-3 w-3 inline ml-1" />
          התראות יושהו בין השעות {quietStart} ל-{quietEnd} (שעון ישראל)
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
        <div>
          <p className="text-sm font-medium">לא לשלוח בשבת</p>
          <p className="text-xs text-gray-500">
            התראות שנוצרות בשבת יישלחו במוצאי שבת.
          </p>
        </div>
        <Switch
          checked={respectShabbat}
          onCheckedChange={(checked) => onChange('respect_shabbat', checked)}
        />
      </div>
    </div>
  );
}