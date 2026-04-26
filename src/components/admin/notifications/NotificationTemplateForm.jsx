import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { createNotification } from "@/functions/createNotification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Send, FileText, MessageSquare, Clock, Filter, Link2 } from "lucide-react";
import { toast } from "sonner";
import BasicInfoTab from "./form/BasicInfoTab";
import ContentTab from "./form/ContentTab";
import TriggerTimingTab from "./form/TriggerTimingTab";
import ConditionsTargetTab from "./form/ConditionsTargetTab";
import AdvancedLinksTab from "./form/AdvancedLinksTab";

// טופס עריכה/יצירה של תבנית התראה - מאורגן בטאבים
export default function NotificationTemplateForm({ 
  open, 
  onOpenChange, 
  template, 
  onChange, 
  onSave, 
  isSaving 
}) {
  const [activeTab, setActiveTab] = useState('basic');
  const [sendingTest, setSendingTest] = useState(false);
  const [testPhoneNumber, setTestPhoneNumber] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  // איפוס לטאב הראשון בכל פתיחה
  useEffect(() => {
    if (open) setActiveTab('basic');
  }, [open]);

  // שליחת התראת בדיקה לעצמי
  const handleSendTestNotification = async () => {
    if (!currentUser || !template) return;
    
    setSendingTest(true);
    try {
      let testTitle = template.title_template || 'התראת בדיקה';
      let testMessage = template.body_template || 'זוהי התראת בדיקה';
      
      const testVariables = {
        event_name: 'אירוע לדוגמה',
        family_name: 'ישראלי',
        event_date: '15/03/2025',
        event_time: '19:00',
        event_location: 'אולמי הזהב',
        supplier_name: 'ספק לדוגמה',
        service_name: 'צילום',
        balance: '5,000',
        days_open: '7',
        min_suppliers: '2',
        current_suppliers: '1',
        event_id: 'test-123'
      };
      
      Object.entries(testVariables).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        testTitle = testTitle.replace(regex, value);
        testMessage = testMessage.replace(regex, value);
      });
      
      const response = await createNotification({
        target_user_id: currentUser.id,
        target_user_email: currentUser.email,
        title: `[בדיקה] ${testTitle}`,
        message: testMessage,
        link: '',
        template_type: template.type || 'TEST',
        send_push: true,
        send_whatsapp: !!testPhoneNumber,
        target_phone: testPhoneNumber,
        base_url: window.location.origin,
        check_quiet_hours: false
      });
      
      if (response.data?.success) {
        toast.success("נשלח בהצלחה!", { 
          description: response.data?.push?.sent 
            ? "התראה נשלחה - בדוק את ההתראות שלך ואת ה-Push" 
            : "התראה פנימית נוצרה (Push לא נשלח)"
        });
      } else {
        toast.error("שגיאה בשליחה", { 
          description: response.data?.error || "לא ניתן לשלוח התראת בדיקה"
        });
      }
    } catch (error) {
      console.error('Test notification error:', error);
      toast.error("שגיאה", { 
        description: error.message || "לא ניתן לשלוח התראת בדיקה"
      });
    } finally {
      setSendingTest(false);
    }
  };

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template.id ? 'עריכת תבנית התראה' : 'יצירת תבנית התראה חדשה'}
          </DialogTitle>
          <DialogDescription>
            הגדר את פרטי התבנית, התזמון, התנאים וקהלי היעד
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 h-auto">
            <TabsTrigger value="basic" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">פרטים כלליים</span>
              <span className="sm:hidden">כללי</span>
            </TabsTrigger>
            <TabsTrigger value="content" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">תוכן ההתראה</span>
              <span className="sm:hidden">תוכן</span>
            </TabsTrigger>
            <TabsTrigger value="trigger" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <Clock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">מתי לשלוח?</span>
              <span className="sm:hidden">מתי</span>
            </TabsTrigger>
            <TabsTrigger value="conditions" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <Filter className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">תנאים וקהלים</span>
              <span className="sm:hidden">תנאים</span>
            </TabsTrigger>
            <TabsTrigger value="advanced" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <Link2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">קישורים</span>
              <span className="sm:hidden">לינקים</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="mt-4">
            <BasicInfoTab template={template} onChange={onChange} />
          </TabsContent>
          <TabsContent value="content" className="mt-4">
            <ContentTab template={template} onChange={onChange} />
          </TabsContent>
          <TabsContent value="trigger" className="mt-4">
            <TriggerTimingTab template={template} onChange={onChange} />
          </TabsContent>
          <TabsContent value="conditions" className="mt-4">
            <ConditionsTargetTab template={template} onChange={onChange} />
          </TabsContent>
          <TabsContent value="advanced" className="mt-4">
            <AdvancedLinksTab template={template} onChange={onChange} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col sm:flex-row gap-2 border-t pt-4">
          <div className="flex flex-col sm:flex-row gap-2 items-center border p-2 rounded-md bg-gray-50">
            <Input 
              placeholder="מספר לבדיקת WhatsApp" 
              value={testPhoneNumber}
              onChange={(e) => setTestPhoneNumber(e.target.value)}
              className="h-9 w-full sm:w-44 text-sm"
              dir="ltr"
            />
            <Button 
              variant="secondary" 
              onClick={handleSendTestNotification} 
              disabled={sendingTest || !template?.title_template}
              className="w-full sm:w-auto h-9"
            >
              {sendingTest ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <Send className="h-4 w-4 ml-2" />
              )}
              שלח בדיקה
            </Button>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
            <Button onClick={onSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <Save className="h-4 w-4 ml-2" />
              )}
              שמור
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}