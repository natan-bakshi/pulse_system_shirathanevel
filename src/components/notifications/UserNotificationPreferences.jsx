import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Bell, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import PushPermissionButton from "./PushPermissionButton";
import QuietHoursSettings from "./QuietHoursSettings";

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
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [quietEnabled, setQuietEnabled] = useState(true);
  const [respectShabbat, setRespectShabbat] = useState(true);
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
      setQuietStart(user.quiet_hours_start || '22:00');
      setQuietEnd(user.quiet_hours_end || '08:00');
      setQuietEnabled(user.quiet_hours_enabled !== false);
      setRespectShabbat(user.respect_shabbat !== false);
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
        quiet_hours_start: quietStart,
        quiet_hours_end: quietEnd,
        quiet_hours_enabled: quietEnabled,
        respect_shabbat: respectShabbat
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

  // Handle quiet hours / shabbat change
  const handleQuietSettingChange = (field, value) => {
    if (field === 'quiet_hours_start') setQuietStart(value);
    else if (field === 'quiet_hours_end') setQuietEnd(value);
    else if (field === 'quiet_hours_enabled') setQuietEnabled(value);
    else if (field === 'respect_shabbat') setRespectShabbat(value);
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
        <QuietHoursSettings
          quietStart={quietStart}
          quietEnd={quietEnd}
          quietEnabled={quietEnabled}
          respectShabbat={respectShabbat}
          onChange={handleQuietSettingChange}
        />

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