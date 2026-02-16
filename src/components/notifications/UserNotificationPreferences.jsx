import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Bell, Clock, Moon, Save, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import PushPermissionButton from "./PushPermissionButton";

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, '0')}:00`
}));

const CATEGORY_LABELS = {
  assignment: 'שיבוצים',
  event_reminder: 'תזכורות אירועים',
  payment: 'תשלומים',
  quote: 'הצעות מחיר',
  system: 'מערכת'
};

const AUDIENCE_LABELS = {
  supplier: 'ספק',
  client: 'לקוח',
  admin: 'מנהל',
  system_creator: 'יוצר המערכת'
};

export default function UserNotificationPreferences({ user, onClose }) {
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState({});
  const [quietStartHour, setQuietStartHour] = useState(null);
  const [quietEndHour, setQuietEndHour] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch notification templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['notificationTemplates'],
    queryFn: () => base44.entities.NotificationTemplate.filter({ is_active: true }),
    staleTime: 5 * 60 * 1000,
  });

  // Initialize preferences from user data
  useEffect(() => {
    if (user) {
      setPreferences(user.notification_preferences || {});
      setQuietStartHour(user.quiet_start_hour ?? 22);
      setQuietEndHour(user.quiet_end_hour ?? 8);
    }
  }, [user]);

  // Filter templates relevant to this user's type
  const relevantTemplates = templates.filter(template => {
    if (!template.target_audiences) return false;
    const userType = user?.user_type || 'client';
    return template.target_audiences.includes(userType) || 
           (user?.role === 'admin' && template.target_audiences.includes('admin'));
  });

  // Group templates by category
  const templatesByCategory = relevantTemplates.reduce((acc, template) => {
    const category = template.category || 'system';
    if (!acc[category]) acc[category] = [];
    acc[category].push(template);
    return acc;
  }, {});

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      await base44.auth.updateMe({
        notification_preferences: preferences,
        quiet_start_hour: quietStartHour,
        quiet_end_hour: quietEndHour
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setHasChanges(false);
      toast.success("הגדרות נשמרו", { description: "העדפות ההתראות שלך עודכנו בהצלחה" });
      if (onClose) onClose();
    },
    onError: (error) => {
      toast.error("שגיאה", { description: "לא ניתן לשמור את ההגדרות: " + error.message });
    }
  });

  // Handle preference change
  const handlePreferenceChange = (templateType, enabled) => {
    setPreferences(prev => ({
      ...prev,
      [templateType]: { enabled }
    }));
    setHasChanges(true);
  };

  // Handle quiet hours change
  const handleQuietHourChange = (type, value) => {
    const numValue = value === 'none' ? null : parseInt(value, 10);
    if (type === 'start') {
      setQuietStartHour(numValue);
    } else {
      setQuietEndHour(numValue);
    }
    setHasChanges(true);
  };

  // Check if a notification type is enabled
  const isEnabled = (templateType) => {
    const pref = preferences[templateType];
    if (pref === undefined) return true; // Default to enabled
    if (typeof pref === 'object') return pref.enabled !== false;
    return pref !== false;
  };

  if (templatesLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          הגדרות התראות
        </CardTitle>
        <CardDescription>
          התאם אילו התראות תרצה לקבל ומתי
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Push Permission Section */}
        <PushPermissionButton user={user} />



        {/* Quiet Hours Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Moon className="h-4 w-4" />
            שעות שקט
          </div>
          <p className="text-xs text-gray-500">
            בשעות אלו לא יישלחו התראות Push. התראות שנוצרו יישלחו בתחילת הפעילות הבאה.
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="quiet-start" className="text-sm">משעה:</Label>
              <Select 
                value={quietStartHour?.toString() ?? 'none'} 
                onValueChange={(v) => handleQuietHourChange('start', v)}
              >
                <SelectTrigger id="quiet-start" className="w-24">
                  <SelectValue placeholder="בחר" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">ללא</SelectItem>
                  {HOURS.map(h => (
                    <SelectItem key={h.value} value={h.value.toString()}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="quiet-end" className="text-sm">עד שעה:</Label>
              <Select 
                value={quietEndHour?.toString() ?? 'none'} 
                onValueChange={(v) => handleQuietHourChange('end', v)}
              >
                <SelectTrigger id="quiet-end" className="w-24">
                  <SelectValue placeholder="בחר" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">ללא</SelectItem>
                  {HOURS.map(h => (
                    <SelectItem key={h.value} value={h.value.toString()}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {quietStartHour !== null && quietEndHour !== null && (
            <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
              <Clock className="h-3 w-3 inline ml-1" />
              התראות Push יושהו בין השעות {quietStartHour.toString().padStart(2, '0')}:00 
              ל-{quietEndHour.toString().padStart(2, '0')}:00
            </p>
          )}
        </div>

        <Separator />

        {/* Notification Types Section */}
        <div className="space-y-4">
          <div className="text-sm font-medium">סוגי התראות</div>
          
          {Object.entries(templatesByCategory).map(([category, categoryTemplates]) => (
            <div key={category} className="space-y-3">
              <h4 className="text-sm font-medium text-gray-700">
                {CATEGORY_LABELS[category] || category}
              </h4>
              <div className="space-y-2 pr-4">
                {categoryTemplates.map(template => (
                  <div 
                    key={template.id} 
                    className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                  >
                    <div className="flex-1 min-w-0 pl-4">
                      <p className="text-sm font-medium">{template.name}</p>
                      {template.description && (
                        <p className="text-xs text-gray-500 truncate">
                          {template.description}
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={isEnabled(template.type)}
                      onCheckedChange={(checked) => handlePreferenceChange(template.type, checked)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Save Button */}
        <div className="flex justify-end gap-2 pt-4">
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              ביטול
            </Button>
          )}
          <Button 
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin ml-2" />
            ) : (
              <Save className="h-4 w-4 ml-2" />
            )}
            שמור הגדרות
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}