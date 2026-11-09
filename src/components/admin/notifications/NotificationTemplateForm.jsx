import React, { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { createNotification } from "@/functions/createNotification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Send, FileText, MessageSquare, Clock, Filter, Link2, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import BasicInfoTab from "./form/BasicInfoTab";
import ContentTab from "./form/ContentTab";
import TriggerTimingTab from "./form/TriggerTimingTab";
import ConditionsTargetTab from "./form/ConditionsTargetTab";
import AdvancedLinksTab from "./form/AdvancedLinksTab";
import WhatsAppTemplateButtonsTab from './WhatsAppTemplateButtonsTab';
import {useLanguage} from '@/i18n/LanguageProvider';

// טופס עריכה/יצירה של תבנית התראה - מאורגן בטאבים
export default function NotificationTemplateForm({ 
  open, 
  onOpenChange, 
  template, 
  onChange, 
  onSave,
  isSaving,
  initialTab='basic'
}) {
  const {t: uiTranslate}=useLanguage();
  const [activeTab, setActiveTab] = useState('basic');
  const [sendingTest, setSendingTest] = useState(false);
  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [buttonsOpened,setButtonsOpened]=useState(false);
  const [savingButtons,setSavingButtons]=useState(false);
  const buttonsRef=useRef(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  // איפוס לטאב הראשון בכל פתיחה
  useEffect(() => {
    if(open){
      setActiveTab(initialTab);
      setButtonsOpened(initialTab==='buttons');
    }
  }, [open,initialTab,template?.id]);
  const changeTab=(tab)=>{
    setActiveTab(tab);
    if(tab==='buttons')setButtonsOpened(true);
  };
  const changeOpen=(next)=>{
    if(!next&&buttonsRef.current?.hasPendingChanges()&&
      !window.confirm('יש שינויי כפתורים שלא נשמרו. לסגור בלי לשמור אותם?'))return;
    onOpenChange(next);
  };
  const saveForm=async()=>{
    // Keep the existing required-field validation BEFORE the separate
    // per-template buttons CAS, avoiding partially saved invalid templates.
    if(!template?.type||!template?.name||!template?.title_template){
      toast.error('נא למלא תחילה קוד זיהוי, שם וכותרת לתבנית');
      setActiveTab('basic');
      return;
    }
    if(buttonsRef.current?.hasPendingChanges()){
      setSavingButtons(true);
      try{
        const saved=await buttonsRef.current.save();
        if(!saved){setActiveTab('buttons');return;}
      }finally{setSavingButtons(false);}
    }
    onSave();
  };

  // שליחת התראת בדיקה לעצמי
  const handleSendTestNotification = async () => {
    if (!currentUser || !template) return;
    
    setSendingTest(true);
    try {
      let testTitle = template.title_template || 'התראת בדיקה';
      let testMessage = template.body_template || 'זוהי התראת בדיקה';
      
      const testVariables = {
        event_name: 'אירוע לדוגמה',
        family_name: 'חתונת חברה',
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
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template.id ? 'עריכת תבנית התראה' : 'יצירת תבנית התראה חדשה'}
          </DialogTitle>
          <DialogDescription>
            {uiTranslate("הגדר את פרטי התבנית, התזמון, התנאים וקהלי היעד")}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={changeTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 h-auto">
            <TabsTrigger value="basic" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{uiTranslate("פרטים כלליים")}</span>
              <span className="sm:hidden">{uiTranslate("כללי")}</span>
            </TabsTrigger>
            <TabsTrigger value="content" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{uiTranslate("תוכן ההתראה")}</span>
              <span className="sm:hidden">{uiTranslate("תוכן")}</span>
            </TabsTrigger>
            <TabsTrigger value="trigger" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <Clock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{uiTranslate("מתי לשלוח?")}</span>
              <span className="sm:hidden">{uiTranslate("מתי")}</span>
            </TabsTrigger>
            <TabsTrigger value="conditions" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <Filter className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{uiTranslate("תנאים וקהלים")}</span>
              <span className="sm:hidden">{uiTranslate("תנאים")}</span>
            </TabsTrigger>
            <TabsTrigger value="advanced" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <Link2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{uiTranslate("קישורים")}</span>
              <span className="sm:hidden">{uiTranslate("לינקים")}</span>
            </TabsTrigger>
            <TabsTrigger value="buttons" className="text-xs sm:text-sm flex items-center gap-1 py-2">
              <MousePointerClick className="h-3.5 w-3.5" />
              <span>{uiTranslate("כפתורים")}</span>
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
          <TabsContent value="buttons" forceMount
            className="mt-4 data-[state=inactive]:hidden">
            {buttonsOpened&&<WhatsAppTemplateButtonsTab
              ref={buttonsRef} template={template}/>}
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col sm:flex-row gap-2 border-t pt-4">
          <div className="flex flex-col sm:flex-row gap-2 items-center border p-2 rounded-md bg-gray-50">
            <Input 
              placeholder={uiTranslate("מספר לבדיקת WhatsApp")} 
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
              {uiTranslate("שלח בדיקה")}
            </Button>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={() => changeOpen(false)}>
              {uiTranslate("ביטול")}
            </Button>
            <Button onClick={saveForm} disabled={isSaving||savingButtons}>
              {isSaving||savingButtons ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <Save className="h-4 w-4 ml-2" />
              )}
              {uiTranslate("שמור")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}