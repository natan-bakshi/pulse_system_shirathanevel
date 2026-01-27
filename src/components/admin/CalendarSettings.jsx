import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Settings, Save } from "lucide-react";
import { AppSettings } from "@/entities/AppSettings";

const EVENT_STATUS_OPTIONS = [
  { value: "quote", label: "הצעת מחיר" },
  { value: "confirmed", label: "אירוע סגור" },
  { value: "in_progress", label: "אירוע תפור" },
  { value: "completed", label: "אירוע עבר" },
  { value: "cancelled", label: "אירוע בוטל" }
];

const DEFAULT_VISIBLE_STATUSES = ["confirmed", "in_progress"];

export default function CalendarSettings({ onSettingsChange, onClose }) {
  const [visibleStatuses, setVisibleStatuses] = useState(DEFAULT_VISIBLE_STATUSES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await AppSettings.filter({ setting_key: 'calendar_visible_statuses' });
      if (settings.length > 0) {
        const savedStatuses = JSON.parse(settings[0].setting_value);
        setVisibleStatuses(savedStatuses);
      } else {
        setVisibleStatuses(DEFAULT_VISIBLE_STATUSES);
      }
    } catch (error) {
      console.error("Failed to load calendar settings:", error);
      setVisibleStatuses(DEFAULT_VISIBLE_STATUSES);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusToggle = (statusValue, checked) => {
    let newStatuses = [...visibleStatuses];
    if (checked) {
      newStatuses.push(statusValue);
    } else {
      newStatuses = newStatuses.filter(s => s !== statusValue);
    }
    setVisibleStatuses(newStatuses);
  };

  const saveSettings = async () => {
    try {
      const existing = await AppSettings.filter({ setting_key: 'calendar_visible_statuses' });
      const settingValue = JSON.stringify(visibleStatuses);
      
      if (existing.length > 0) {
        await AppSettings.update(existing[0].id, { setting_value: settingValue });
      } else {
        await AppSettings.create({
          setting_key: 'calendar_visible_statuses',
          setting_value: settingValue,
          setting_type: 'array',
          description: 'סטטוסי אירועים שיוצגו בדשבורד'
        });
      }
      
      onSettingsChange(visibleStatuses);
      if (onClose) onClose();
    } catch (error) {
      console.error("Failed to save calendar settings:", error);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          הגדרות דשבורד
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Label>בחר אילו סטטוסי אירועים יוצגו בדשבורד ובלוח השנה:</Label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {EVENT_STATUS_OPTIONS.map(option => (
              <div key={option.value} className="flex items-center space-x-2 space-x-reverse">
                <Checkbox
                  checked={visibleStatuses.includes(option.value)}
                  onCheckedChange={(checked) => handleStatusToggle(option.value, checked)}
                />
                <Label className="text-sm">{option.label}</Label>
              </div>
            ))}
          </div>
          <Button onClick={saveSettings} className="w-full">
            <Save className="h-4 w-4 ml-2" />
            שמור הגדרות
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}