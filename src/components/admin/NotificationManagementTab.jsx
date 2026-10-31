import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useLocation } from "react-router-dom";
import { Bell, Plus, Info, MessageSquare, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

// Sub-components
import NotificationTemplatesOverview from "./notifications/NotificationTemplatesOverview";
import NotificationTemplateForm from "./notifications/NotificationTemplateForm";
import ManualTriggerDialog from "./notifications/ManualTriggerDialog";
import ManualSendersSection from "./notifications/ManualSendersSection";
import WhatsAppProviderStatus from "./notifications/WhatsAppProviderStatus";
import WhatsAppQueueSettings from "./notifications/WhatsAppQueueSettings";
import WhatsAppLiveButtonSettings from "./notifications/WhatsAppLiveButtonSettings";
import WhatsAppSupplierNoticeButtons from "./notifications/WhatsAppSupplierNoticeButtons";

/**
 * רכיב ניהול התראות מרכזי - מתאם בין כל תת-הקומפוננטות:
 * - NotificationTemplatesOverview: רשימת תבניות מקובצות
 * - NotificationTemplateForm: דיאלוג עריכה/יצירה (עם טאבים פנימיים)
 * - ManualTriggerDialog: שליחה ידנית של תבנית
 * - ManualSendersSection: שולחי Push ו-WhatsApp ידניים
 */
export default function NotificationManagementTab() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [manualTriggerTemplate, setManualTriggerTemplate] = useState(null);
  const [section, setSection] = useState(() => typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('whatsappQueue') === 'review'
      ? 'whatsapp' : 'templates');
  useEffect(() => {
    if (new URLSearchParams(location.search).get('whatsappQueue') === 'review') {
      setSection('whatsapp');
    }
  }, [location.search]);

  // Fetch templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['notificationTemplates'],
    queryFn: () => base44.entities.NotificationTemplate.list()
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (template) => {
      if (template.id) {
        return await base44.entities.NotificationTemplate.update(template.id, template);
      }
      return await base44.entities.NotificationTemplate.create(template);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationTemplates'] });
      setIsDialogOpen(false);
      setEditingTemplate(null);
      toast.success("נשמר בהצלחה", { description: "תבנית ההתראה עודכנה" });
    },
    onError: (error) => {
      toast.error("שגיאה", { description: error.message });
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.NotificationTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationTemplates'] });
      toast.success("נמחק", { description: "תבנית ההתראה נמחקה" });
    }
  });

  // Toggle active mutation
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => 
      base44.entities.NotificationTemplate.update(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationTemplates'] });
    }
  });

  const handleEdit = (template) => {
    setEditingTemplate({ ...template });
    setIsDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingTemplate({
      type: '',
      name: '',
      description: '',
      title_template: '',
      body_template: '',
      timing_value: null,
      timing_unit: 'days',
      reminder_interval_value: null,
      reminder_interval_unit: 'days',
      max_reminders: 3,
      is_active: true,
      target_audiences: ['supplier'],
      trigger_type: 'scheduled_check',
      entity_name: '',
      deep_link_base: '',
      deep_link_params_map: '',
      category: 'system',
      whatsapp_body_template: '',
      allowed_channels: ['push'],
      condition_logic: 'and',
      event_filter_condition: '[]'
    });
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (!editingTemplate.type || !editingTemplate.name || !editingTemplate.title_template) {
      toast.error("שגיאה", { description: "נא למלא את כל שדות החובה: קוד זיהוי, שם וכותרת" });
      return;
    }
    saveMutation.mutate(editingTemplate);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bell className="h-5 w-5" />
            ניהול התראות
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            סוגי התראות, כפתורים, WhatsApp ותזמונים — במקום אחד
          </p>
        </div>
        {section === "templates" && <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 ml-2" />
          תבנית חדשה
        </Button>}
      </div>

      {/* One clear place for all notification & WhatsApp controls. */}
      <Tabs value={section} onValueChange={setSection} className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto gap-1">
          <TabsTrigger value="templates" className="text-xs sm:text-sm">סוגי התראות</TabsTrigger>
          <TabsTrigger value="buttons" className="text-xs sm:text-sm">כפתורים בהודעות</TabsTrigger>
          <TabsTrigger value="whatsapp" className="text-xs sm:text-sm">חיבור ושליחת WhatsApp</TabsTrigger>
          <TabsTrigger value="stats" className="text-xs sm:text-sm">סטטיסטיקות</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4 mt-4">
      {/* הסבר על זיהוי קהל יעד */}
      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-sm">
          <strong>איך המערכת מזהה את הנמענים?</strong>
          <ul className="mt-2 list-disc mr-4 space-y-1">
            <li><strong>ספקים:</strong> המערכת מזהה את הספקים המשובצים לאירוע הרלוונטי לפי השיבוצים ב-EventService</li>
            <li><strong>לקוחות:</strong> המערכת מזהה את הלקוח לפי שדה parents באירוע או לפי המשתמש שיצר את האירוע</li>
            <li><strong>התראות על יתרות:</strong> נשלחות ללקוחות שיש להם אירועים עם יתרה פתוחה לאחר שהאירוע הושלם</li>
          </ul>
        </AlertDescription>
      </Alert>

      {/* שולחים ידניים */}
      <ManualSendersSection />

          <NotificationTemplatesOverview
            templates={templates}
            isLoading={templatesLoading}
            onEdit={handleEdit}
            onDelete={(id) => deleteMutation.mutate(id)}
            onToggleActive={(id, is_active) => toggleActiveMutation.mutate({ id, is_active })}
            onManualTrigger={setManualTriggerTemplate}
          />
        </TabsContent>

        <TabsContent value="buttons" className="space-y-4 mt-4">
          <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
            <CardHeader>
              <CardTitle className="flex gap-2 items-center text-lg">
                <MessageSquare className="h-5 w-5" />כפתורים בהודעות WhatsApp
              </CardTitle>
              <CardDescription>
                בוחרים מה יופיע בכל סוג הודעה ומה יקרה בלחיצה, בלי להתעסק בקישורים או בקוד.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4 space-y-2">
                <h3 className="font-semibold">שיבוץ חדש לספק</h3>
                <p className="text-sm text-gray-600">
                  אישור שיבוץ — מעדכן את השיבוץ במערכת; דחיית שיבוץ — מעדכנת דחייה;
                  פנייה למשרד — פותחת שיחת WhatsApp עם פרטי השיבוץ.
                  קישור ליומן הספק מצורף גם להודעה. אישור ודחייה מתוך Pulse ממשיכים לעבוד כרגיל.
                </p>
                <WhatsAppLiveButtonSettings active={true}/>
              </div>
              <WhatsAppSupplierNoticeButtons active={true}/>
              <p className="text-xs text-gray-600">
                הכפתורים האפשריים כרגע מותאמים להודעות לספקים שנשלחות בפרטי דרך Green API.
                כפתורים חדשים שמשנים מידע במערכת יופיעו לבחירה רק לאחר שתמומש עבורם פעולה מאובטחת.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whatsapp" className="space-y-4 mt-4">
          <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
            <CardHeader>
              <CardTitle className="flex gap-2 items-center text-lg">
                <Settings2 className="h-5 w-5" />WhatsApp — חיבור ושליחה
              </CardTitle>
              <CardDescription>
                בוחרים את ספק WhatsApp ומנהלים את שליחת ההודעות. כלים מתקדמים לתקלות מקופלים כברירת מחדל.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <WhatsAppProviderStatus />
              <WhatsAppQueueSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
            <CardHeader>
              <CardTitle>סטטיסטיקות התראות</CardTitle>
              <CardDescription>סקירת פעילות מערכת ההתראות</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-blue-600">{templates.length}</p>
                  <p className="text-sm text-gray-600">תבניות</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-green-600">
                    {templates.filter(t => t.is_active).length}
                  </p>
                  <p className="text-sm text-gray-600">פעילות</p>
                </div>
                <div className="p-4 bg-yellow-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-yellow-600">
                    {templates.filter(t => t.trigger_type === 'scheduled_check').length}
                  </p>
                  <p className="text-sm text-gray-600">מתוזמנות</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-purple-600">
                    {templates.filter(t => ['entity_create', 'entity_update'].includes(t.trigger_type)).length}
                  </p>
                  <p className="text-sm text-gray-600">מונחות אירועים</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* דיאלוג עריכה/יצירה */}
      <NotificationTemplateForm
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        template={editingTemplate}
        onChange={setEditingTemplate}
        onSave={handleSave}
        isSaving={saveMutation.isPending}
      />

      {/* דיאלוג שליחה ידנית */}
      <ManualTriggerDialog 
        open={!!manualTriggerTemplate} 
        onOpenChange={(open) => !open && setManualTriggerTemplate(null)}
        template={manualTriggerTemplate}
      />
    </div>
  );
}