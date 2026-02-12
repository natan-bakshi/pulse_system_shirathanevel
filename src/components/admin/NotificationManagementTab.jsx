import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { createNotification } from "@/functions/createNotification";
import { 
  Bell, Plus, Pencil, Trash2, Save, Loader2, 
  AlertCircle, Clock, ChevronDown, ChevronUp, HelpCircle, Copy, Info, Send
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import ManualPushSender from "./ManualPushSender";
import ManualWhatsAppSender from "./ManualWhatsAppSender";

// סוגי טריגרים עם תיאורים מפורטים
const TRIGGER_TYPES = {
  entity_create: {
    label: 'יצירת רשומה חדשה',
    description: 'נשלחת כאשר נוצרת רשומה חדשה (למשל: שיבוץ ספק חדש לאירוע)',
    example: 'שיבוץ ספק לאירוע'
  },
  entity_update: {
    label: 'עדכון רשומה',
    description: 'נשלחת כאשר רשומה קיימת מתעדכנת (למשל: שינוי פרטי אירוע)',
    example: 'שינוי מיקום אירוע'
  },
  supplier_assignment_create: {
    label: 'שיבוץ חדש לספק',
    description: 'נשלחת כאשר ספק משובץ לשירות באירוע',
    example: 'שיבוץ צלם לאירוע'
  },
  supplier_assignment_delete: {
    label: 'ביטול שיבוץ ספק',
    description: 'נשלחת כאשר ספק מוסר משירות באירוע',
    example: 'ביטול שיבוץ צלם'
  },
  scheduled_check: {
    label: 'בדיקה מתוזמנת',
    description: 'נשלחת לפי תזמון שנקבע מראש (למשל: תזכורת 7 ימים לפני האירוע)',
    example: 'תזכורת לפני אירוע'
  },
  custom_trigger: {
    label: 'טריגר מותאם אישית',
    description: 'טריגר המופעל ידנית או ע"י קוד חיצוני',
    example: 'אירוע חיצוני'
  }
};

const TIMING_UNITS = {
  minutes: 'דקות',
  hours: 'שעות',
  days: 'ימים',
  weeks: 'שבועות',
  months: 'חודשים'
};

const CATEGORIES = {
  assignment: 'שיבוצים',
  event_reminder: 'תזכורות אירועים',
  payment: 'תשלומים',
  quote: 'הצעות מחיר',
  system: 'מערכת'
};

// קהלי יעד עם תיאורים
const AUDIENCES = {
  supplier: {
    label: 'ספקים',
    description: 'ספקים המשובצים לאירוע הרלוונטי'
  },
  client: {
    label: 'לקוחות', 
    description: 'הלקוח שהאירוע שייך לו'
  },
  admin: {
    label: 'מנהלים',
    description: 'כל המשתמשים עם הרשאת מנהל'
  },
  system_creator: {
    label: 'יוצר המערכת',
    description: 'המנהל הראשי של המערכת בלבד'
  }
};

const AVAILABLE_VARIABLES = {
  // אירוע
  event_name: { description: 'שם האירוע', example: 'חתונה של משפחת כהן' },
  event_date: { description: 'תאריך האירוע', example: '15/03/2024' },
  event_time: { description: 'שעת האירוע', example: '19:00' },
  event_location: { description: 'מיקום האירוע', example: 'אולמי הגן' },
  event_type: { description: 'סוג אירוע', example: 'חתונה' },
  guest_count: { description: 'מספר אורחים', example: '300' },
  city: { description: 'עיר', example: 'תל אביב' },
  event_id: { description: 'מזהה האירוע', example: 'evt_123' },
  
  // משפחה / לקוח
  family_name: { description: 'שם משפחה', example: 'כהן' },
  child_name: { description: 'שם הילד/ה', example: 'נועה' },
  client_name: { description: 'שם הלקוח (הורה ראשי)', example: 'משה כהן' },
  client_phone: { description: 'טלפון הלקוח', example: '050-1234567' },
  client_email: { description: 'אימייל הלקוח', example: 'moshe@example.com' },
  
  // ספק ושיבוץ
  supplier_name: { description: 'שם הספק', example: 'דיג׳יי אלי' },
  supplier_phone: { description: 'טלפון הספק', example: '052-9876543' },
  supplier_email: { description: 'אימייל הספק', example: 'eli@dj.com' },
  service_name: { description: 'שם השירות', example: 'תקליטן' },
  assignment_status: { description: 'סטטוס שיבוץ', example: 'אושר' },
  
  // פיננסי
  balance: { description: 'יתרה לתשלום (מחושב)', example: '5,000' },
  total_price: { description: 'מחיר כולל לאירוע', example: '15,000' },
  total_paid: { description: 'סה״כ שולם', example: '10,000' },
  discount_amount: { description: 'גובה הנחה', example: '500' },
  quote_total: { description: 'סה״כ הצעת מחיר', example: '15,500' },
  
  // מערכת
  user_name: { description: 'שם המשתמש המקבל', example: 'ישראל ישראלי' },
  admin_name: { description: 'שם המנהל', example: 'מנהל ראשי' },
  days_open: { description: 'ימים מאז פתיחת האירוע', example: '14' },
  min_suppliers: { description: 'מינימום ספקים נדרש', example: '5' },
  current_suppliers: { description: 'מספר ספקים נוכחי', example: '3' },
  
  // קישורים
  event_link: { description: 'קישור לאירוע', example: 'https://...' },
  payment_link: { description: 'קישור לתשלום', example: 'https://...' },
  supplier_link: { description: 'קישור לפורטל ספקים', example: 'https://...' }
};

// הגדרת שדות זמינים לתנאים - מורחב משמעותית
const CONDITION_FIELDS = {
  // --- שדות בסיסיים של אירוע ---
  status: { 
    label: 'סטטוס אירוע', 
    type: 'select', 
    options: [
      { value: 'quote', label: 'הצעת מחיר' },
      { value: 'confirmed', label: 'מאושר' },
      { value: 'in_progress', label: 'בביצוע' },
      { value: 'completed', label: 'הושלם' },
      { value: 'cancelled', label: 'בוטל' }
    ]
  },
  event_type: { 
    label: 'סוג אירוע', 
    type: 'select', 
    options: [
      { value: 'bar_mitzvah', label: 'בר מצווה' },
      { value: 'bat_mitzvah', label: 'בת מצווה' },
      { value: 'wedding', label: 'חתונה' },
      { value: 'other', label: 'אחר' }
    ]
  },
  location: { label: 'מיקום האירוע', type: 'text', description: 'שם האולם או המקום' },
  concept: { label: 'קונספט', type: 'text', description: 'קונספט האירוע' },
  city: { label: 'עיר', type: 'text' },
  guest_count: { label: 'מספר אורחים', type: 'number' },
  family_name: { label: 'שם משפחה', type: 'text' },
  child_name: { label: 'שם הילד/ה', type: 'text' },
  notes: { label: 'הערות לאירוע', type: 'text' },
  
  // --- שדות פיננסיים (מחושבים) ---
  total_price: { label: 'מחיר כולל', type: 'number' },
  total_paid: { label: 'סה"כ שולם', type: 'number' },
  balance: { label: 'יתרה לתשלום', type: 'number', description: 'חוב פתוח' },
  payment_percentage: { label: 'אחוז שולם', type: 'number', description: '0 עד 100' },
  is_fully_paid: { 
    label: 'האם שולם במלואו?', 
    type: 'select', 
    options: [
      { value: 'true', label: 'כן' },
      { value: 'false', label: 'לא' }
    ] 
  },
  discount_amount: { label: 'סכום הנחה', type: 'number' },
  is_all_inclusive: { 
    label: 'האם הכל כלול?', 
    type: 'select', 
    options: [
      { value: 'true', label: 'כן' },
      { value: 'false', label: 'לא' }
    ] 
  },

  // --- שדות ספקים ושיבוצים ---
  supplier_count: { label: 'מספר ספקים משובצים', type: 'number' },
  has_missing_suppliers: { 
    label: 'האם חסרים ספקים?', 
    type: 'select', 
    options: [
      { value: 'true', label: 'כן' },
      { value: 'false', label: 'לא' }
    ] 
  },
  assignment_status: {
    label: 'סטטוס שיבוץ (כלשהו)',
    type: 'select',
    options: [
      { value: 'pending', label: 'ממתין לאישור' },
      { value: 'approved', label: 'אושר ע״י ספק' },
      { value: 'rejected', label: 'נדחה ע״י ספק' },
      { value: 'signed', label: 'נחתם חוזה' }
    ]
  },

  // --- שדות תזמון ותאריכים ---
  days_until_event: { label: 'ימים עד האירוע', type: 'number', description: 'חיובי = עתיד, שלילי = עבר' },
  creation_date_age: { label: 'ימים מאז יצירת האירוע', type: 'number' },
  event_month: { 
    label: 'חודש האירוע', 
    type: 'select',
    options: [
      { value: '1', label: 'ינואר' }, { value: '2', label: 'פברואר' }, { value: '3', label: 'מרץ' },
      { value: '4', label: 'אפריל' }, { value: '5', label: 'מאי' }, { value: '6', label: 'יוני' },
      { value: '7', label: 'יולי' }, { value: '8', label: 'אוגוסט' }, { value: '9', label: 'ספטמבר' },
      { value: '10', label: 'אוקטובר' }, { value: '11', label: 'נובמבר' }, { value: '12', label: 'דצמבר' }
    ]
  },
  is_weekend: { 
    label: 'האם סופ"ש?', 
    type: 'select', 
    options: [
      { value: 'true', label: 'כן (שישי/שבת)' },
      { value: 'false', label: 'לא (אמצ"ש)' }
    ] 
  },

  // --- פרטי לקוח ---
  client_email: { label: 'אימייל לקוח', type: 'text' },
  client_phone: { label: 'טלפון לקוח', type: 'text' }
};

const OPERATORS = {
  equals: 'שווה ל-',
  not_equals: 'שונה מ-',
  greater_than: 'גדול מ-',
  less_than: 'קטן מ-',
  contains: 'מכיל',
  is_empty: 'ריק',
  is_not_empty: 'לא ריק',
  changed: 'השתנה (Changed)'
};

// הגדרת דפים לפי הרשאות
const PAGES_BY_ROLE = {
  admin: [
    { value: 'AdminDashboard', label: 'דשבורד מנהל' },
    { value: 'EventManagement', label: 'ניהול אירועים' },
    { value: 'EventManagement?tab=board', label: 'לוח אירועים' },
    { value: 'ClientManagement', label: 'ניהול לקוחות' },
    { value: 'SupplierManagement', label: 'ניהול ספקים' },
    { value: 'ServiceManagement', label: 'ניהול שירותים' },
    { value: 'QuoteTemplateManagement', label: 'תבניות הצעת מחיר' },
    { value: 'UserManagement', label: 'ניהול משתמשים' }
  ],
  client: [
    { value: 'ClientDashboard', label: 'האירועים שלי' },
    { value: 'EventDetails', label: 'פרטי אירוע' },
    { value: 'EventDetails?tab=payments', label: 'תשלומים' },
    { value: 'ClientGallery', label: 'גלריה' }
  ],
  supplier: [
    { value: 'SupplierDashboard', label: 'האירועים שלי' },
    { value: 'EventDetails', label: 'פרטי אירוע (מוגבל)' }
  ],
  system_creator: [
    { value: 'SettingsPage', label: 'הגדרות מערכת' }
  ]
};

// רכיב עזר להצגת תיאור עם טולטיפ
function FieldLabel({ label, tooltip, required }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className={required ? "after:content-['*'] after:text-red-500 after:mr-0.5" : ""}>
        {label}
      </Label>
      {tooltip && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-gray-400 hover:text-gray-600">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-right">
              <p className="text-sm">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

export default function NotificationManagementTab() {
  const queryClient = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('templates');
  const [expandedHelp, setExpandedHelp] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testPhoneNumber, setTestPhoneNumber] = useState('');

  // Get current user for test sending
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

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
      } else {
        return await base44.entities.NotificationTemplate.create(template);
      }
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

  // Group templates by category
  const templatesByCategory = templates.reduce((acc, t) => {
    const cat = t.category || 'system';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

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
      event_filter_condition: '[]' // Initialize as empty array string
    });
    setIsDialogOpen(true);
  };

  // Helper to parse conditions safely
  const getConditions = (template) => {
    try {
      if (!template.event_filter_condition) return [];
      const parsed = JSON.parse(template.event_filter_condition);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  // Helper to update conditions
  const updateConditions = (newConditions) => {
    setEditingTemplate({
      ...editingTemplate,
      event_filter_condition: JSON.stringify(newConditions)
    });
  };

  // Get relevant pages based on selected audiences
  const getRelevantPages = () => {
    if (!editingTemplate?.target_audiences) return [];
    
    const audiences = editingTemplate.target_audiences;
    const pages = new Set();
    const result = [];

    // Always include System Creator pages if that role is targeted (though usually specific)
    if (audiences.includes('system_creator')) {
      PAGES_BY_ROLE.system_creator.forEach(p => {
        if (!pages.has(p.value)) {
          pages.add(p.value);
          result.push({ ...p, role: 'יוצר המערכת' });
        }
      });
    }

    if (audiences.includes('admin')) {
      PAGES_BY_ROLE.admin.forEach(p => {
        if (!pages.has(p.value)) {
          pages.add(p.value);
          result.push({ ...p, role: 'מנהל' });
        }
      });
    }

    if (audiences.includes('client')) {
      PAGES_BY_ROLE.client.forEach(p => {
        if (!pages.has(p.value)) {
          pages.add(p.value);
          result.push({ ...p, role: 'לקוח' });
        }
      });
    }

    if (audiences.includes('supplier')) {
      PAGES_BY_ROLE.supplier.forEach(p => {
        if (!pages.has(p.value)) {
          pages.add(p.value);
          result.push({ ...p, role: 'ספק' });
        }
      });
    }

    return result;
  };

  const handleSave = () => {
    if (!editingTemplate.type || !editingTemplate.name || !editingTemplate.title_template) {
      toast.error("שגיאה", { description: "נא למלא את כל השדות החובה" });
      return;
    }
    saveMutation.mutate(editingTemplate);
  };

  // שליחת התראת בדיקה לעצמי
  const handleSendTestNotification = async () => {
    if (!currentUser || !editingTemplate) return;
    
    setSendingTest(true);
    try {
      // החלפת משתנים בערכי דוגמה
      let testTitle = editingTemplate.title_template || 'התראת בדיקה';
      let testMessage = editingTemplate.body_template || 'זוהי התראת בדיקה';
      
      // החלפת משתנים נפוצים בדוגמאות
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
        template_type: editingTemplate.type || 'TEST',
        send_push: true,
        send_whatsapp: !!testPhoneNumber, // Send WhatsApp only if phone provided
        target_phone: testPhoneNumber, // Override phone with test number
        base_url: window.location.origin, // Pass current origin for absolute links
        check_quiet_hours: false // לא לבדוק שעות שקט לבדיקה
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

  const copyVariable = (variable) => {
    navigator.clipboard.writeText(`{{${variable}}}`);
    toast.success("הועתק", { description: `{{${variable}}} הועתק ללוח` });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bell className="h-5 w-5" />
            ניהול התראות
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            הגדרת תבניות התראות, תזמונים וקהלי יעד
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 ml-2" />
          תבנית חדשה
        </Button>
      </div>

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

      {/* Help Section */}
      <Collapsible open={expandedHelp} onOpenChange={setExpandedHelp}>
        <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <HelpCircle className="h-4 w-4" />
                  מדריך שימוש במשתנים
                </CardTitle>
                {expandedHelp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <p className="text-sm text-gray-600 mb-4">
                ניתן להשתמש במשתנים בתוך תבניות ההתראות. המשתנים יוחלפו אוטומטית בערכים האמיתיים בעת שליחת ההתראה.
                לחץ על משתנה כדי להעתיק אותו.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(AVAILABLE_VARIABLES).map(([key, info]) => (
                  <TooltipProvider key={key}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => copyVariable(key)}
                          className="flex items-center gap-2 p-2 bg-gray-100 rounded text-sm hover:bg-gray-200 transition-colors text-right"
                        >
                          <Copy className="h-3 w-3 shrink-0" />
                          <span className="font-mono text-xs">{`{{${key}}}`}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="font-medium">{info.description}</p>
                        <p className="text-xs text-gray-400">דוגמה: {info.example}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Manual Sender Tools */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ManualPushSender />
        <ManualWhatsAppSender />
      </div>

      {/* Templates List */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="templates">תבניות התראה</TabsTrigger>
          <TabsTrigger value="stats">סטטיסטיקות</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4">
          {templatesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
              <CardContent className="py-8 text-center text-gray-500">
                <Bell className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>אין תבניות התראה. לחץ על "תבנית חדשה" ליצירת תבנית ראשונה.</p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(templatesByCategory).map(([category, categoryTemplates]) => (
              <Card key={category} className="bg-white/95 backdrop-blur-sm shadow-xl">
                <CardHeader className="py-3">
                  <CardTitle className="text-base">
                    {CATEGORIES[category] || category}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {categoryTemplates.map((template) => (
                      <div 
                        key={template.id}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          template.is_active ? 'bg-white' : 'bg-gray-50 opacity-60'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{template.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {TRIGGER_TYPES[template.trigger_type]?.label || template.trigger_type}
                            </Badge>
                            {template.target_audiences?.map(a => (
                              <Badge key={a} variant="secondary" className="text-xs">
                                {AUDIENCES[a]?.label || a}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-sm text-gray-500 truncate mt-1">
                            {template.description || template.body_template}
                          </p>
                          {template.timing_value && (
                            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {template.timing_value} {TIMING_UNITS[template.timing_unit]} לפני
                              {template.reminder_interval_value && (
                                <span> | תזכורת כל {template.reminder_interval_value} {TIMING_UNITS[template.reminder_interval_unit]}</span>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mr-4">
                          <Switch
                            checked={template.is_active}
                            onCheckedChange={(checked) => 
                              toggleActiveMutation.mutate({ id: template.id, is_active: checked })
                            }
                          />
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(template)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => {
                              if (confirm('האם למחוק את תבנית ההתראה?')) {
                                deleteMutation.mutate(template.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="stats">
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

      {/* Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate?.id ? 'עריכת תבנית התראה' : 'יצירת תבנית התראה חדשה'}
            </DialogTitle>
            <DialogDescription>
              הגדר את פרטי התבנית, התזמון וקהל היעד
            </DialogDescription>
          </DialogHeader>

          {editingTemplate && (
            <div className="space-y-4">
              {/* פרטים בסיסיים */}
              <div className="p-3 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-sm text-gray-700 mb-3">פרטים בסיסיים</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel 
                      label="קוד זיהוי" 
                      tooltip="קוד ייחודי לזיהוי התבנית במערכת. יכול להכיל רק אותיות גדולות באנגלית וקו תחתון. למשל: SUPPLIER_NEW_ASSIGNMENT"
                      required
                    />
                    <Input
                      value={editingTemplate.type}
                      onChange={(e) => setEditingTemplate({
                        ...editingTemplate, 
                        type: e.target.value.toUpperCase().replace(/[^A-Z_]/g, '')
                      })}
                      placeholder="SUPPLIER_NEW_ASSIGNMENT"
                      className="font-mono text-sm mt-1"
                    />
                  </div>
                  <div>
                    <FieldLabel 
                      label="שם התבנית" 
                      tooltip="שם ידידותי שיעזור לך לזהות את התבנית ברשימה"
                      required
                    />
                    <Input
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({...editingTemplate, name: e.target.value})}
                      placeholder="שיבוץ חדש לספק"
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <FieldLabel 
                    label="תיאור" 
                    tooltip="תיאור פנימי לשימושך - לא יוצג למשתמשים"
                  />
                  <Input
                    value={editingTemplate.description || ''}
                    onChange={(e) => setEditingTemplate({...editingTemplate, description: e.target.value})}
                    placeholder="תיאור התבנית לשימוש פנימי"
                    className="mt-1"
                  />
                </div>
              </div>

              {/* תוכן ההתראה */}
              <div className="p-3 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-sm text-gray-700 mb-3">תוכן ההתראה</h3>
                <div>
                  <FieldLabel 
                    label="כותרת ההתראה" 
                    tooltip="הכותרת שתופיע בהתראה. ניתן להשתמש במשתנים כמו {{event_name}}"
                    required
                  />
                  <Input
                    value={editingTemplate.title_template}
                    onChange={(e) => setEditingTemplate({...editingTemplate, title_template: e.target.value})}
                    placeholder="שיבוץ חדש לאירוע {{event_name}}"
                    className="mt-1"
                  />
                </div>

                <div className="mt-3">
                  <FieldLabel 
                    label="תוכן ההודעה (Push/In-App)" 
                    tooltip="גוף ההודעה המלא. ניתן להשתמש במשתנים כמו {{supplier_name}}, {{event_date}}"
                    required
                  />
                  <Textarea
                    value={editingTemplate.body_template}
                    onChange={(e) => setEditingTemplate({...editingTemplate, body_template: e.target.value})}
                    placeholder="שלום {{supplier_name}}, שובצת לאירוע {{event_name}}..."
                    rows={3}
                    className="mt-1"
                  />
                </div>

                <div className="mt-3 border-t pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FieldLabel 
                      label="הודעת וואטסאפ" 
                      tooltip="תוכן ההודעה שתשלח בוואטסאפ (אם פעיל)"
                    />
                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                      WhatsApp
                    </Badge>
                  </div>
                  <Textarea
                    value={editingTemplate.whatsapp_body_template || ''}
                    onChange={(e) => setEditingTemplate({...editingTemplate, whatsapp_body_template: e.target.value})}
                    placeholder="היי {{supplier_name}}, יש עדכון לגבי האירוע..."
                    rows={3}
                    className="mt-1 border-green-200 focus-visible:ring-green-500"
                  />
                </div>
                
                <div className="mt-3">
                  <FieldLabel 
                    label="ערוצי שליחה מותרים" 
                    tooltip="באילו ערוצים מותר לשלוח התראה זו"
                  />
                  <div className="flex gap-4 mt-2">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <Switch
                        id="channel-push"
                        checked={editingTemplate.allowed_channels?.includes('push')}
                        onCheckedChange={(checked) => {
                          const channels = new Set(editingTemplate.allowed_channels || []);
                          if (checked) channels.add('push');
                          else channels.delete('push');
                          setEditingTemplate({...editingTemplate, allowed_channels: Array.from(channels)});
                        }}
                      />
                      <Label htmlFor="channel-push">Push / אפליקציה</Label>
                    </div>
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <Switch
                        id="channel-whatsapp"
                        checked={editingTemplate.allowed_channels?.includes('whatsapp')}
                        onCheckedChange={(checked) => {
                          const channels = new Set(editingTemplate.allowed_channels || []);
                          if (checked) channels.add('whatsapp');
                          else channels.delete('whatsapp');
                          setEditingTemplate({...editingTemplate, allowed_channels: Array.from(channels)});
                        }}
                      />
                      <Label htmlFor="channel-whatsapp">WhatsApp</Label>
                    </div>
                  </div>
                </div>
              </div>

              {/* הגדרות טריגר */}
              <div className="p-3 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-sm text-gray-700 mb-3">מתי לשלוח?</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel 
                      label="קטגוריה" 
                      tooltip="קטגוריה לסיווג התבנית - משמשת לארגון וסינון"
                    />
                    <Select 
                      value={editingTemplate.category || 'system'} 
                      onValueChange={(v) => setEditingTemplate({...editingTemplate, category: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(CATEGORIES).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel 
                      label="סוג טריגר" 
                      tooltip="מה יגרום לשליחת ההתראה"
                    />
                    <Select 
                      value={editingTemplate.trigger_type} 
                      onValueChange={(v) => setEditingTemplate({...editingTemplate, trigger_type: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TRIGGER_TYPES).map(([value, info]) => (
                          <SelectItem key={value} value={value}>
                            <div className="text-right">
                              <div>{info.label}</div>
                              <div className="text-xs text-gray-500">{info.example}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* הסבר על הטריגר הנבחר */}
                {editingTemplate.trigger_type && TRIGGER_TYPES[editingTemplate.trigger_type] && (
                  <Alert className="mt-3 bg-blue-50 border-blue-100">
                    <Info className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-700 text-sm">
                      {TRIGGER_TYPES[editingTemplate.trigger_type].description}
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {/* קהל יעד */}
              <div className="p-3 bg-gray-50 rounded-lg">
                <FieldLabel 
                  label="למי לשלוח?" 
                  tooltip="בחר את קהלי היעד שיקבלו את ההתראה הזו"
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  {Object.entries(AUDIENCES).map(([value, info]) => (
                    <TooltipProvider key={value}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant={editingTemplate.target_audiences?.includes(value) ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                              const audiences = editingTemplate.target_audiences || [];
                              if (audiences.includes(value)) {
                                setEditingTemplate({
                                  ...editingTemplate,
                                  target_audiences: audiences.filter(a => a !== value)
                                });
                              } else {
                                setEditingTemplate({
                                  ...editingTemplate,
                                  target_audiences: [...audiences, value]
                                });
                              }
                            }}
                          >
                            {info.label}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-sm">{info.description}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </div>
              </div>

              {/* הגדרות תזמון - רק לטריגר מתוזמן */}
              {editingTemplate.trigger_type === 'scheduled_check' && (
                <div className="p-3 bg-gray-50 rounded-lg">
                  <h3 className="font-medium text-sm text-gray-700 mb-3">הגדרות תזמון</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <FieldLabel 
                        label="כמה זמן לפני האירוע" 
                        tooltip="כמה זמן לפני האירוע לשלוח את ההתראה הראשונה"
                      />
                      <Input
                        type="number"
                        value={editingTemplate.timing_value || ''}
                        onChange={(e) => setEditingTemplate({
                          ...editingTemplate, 
                          timing_value: e.target.value ? parseInt(e.target.value) : null
                        })}
                        placeholder="7"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <FieldLabel label="יחידת זמן" />
                      <Select 
                        value={editingTemplate.timing_unit || 'days'} 
                        onValueChange={(v) => setEditingTemplate({...editingTemplate, timing_unit: v})}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(TIMING_UNITS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <FieldLabel 
                        label="מתי?" 
                        tooltip="לפני, אחרי או בזמן האירוע/היעד"
                      />
                      <Select 
                        value={editingTemplate.timing_direction || 'before'} 
                        onValueChange={(v) => setEditingTemplate({...editingTemplate, timing_direction: v})}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="בחר זמן" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="before">לפני</SelectItem>
                          <SelectItem value="after">אחרי</SelectItem>
                          <SelectItem value="during">ביום ה</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <FieldLabel 
                        label="ביחס ל..." 
                        tooltip="נקודת הייחוס לחישוב הזמן"
                      />
                      <Select 
                        value={editingTemplate.timing_reference || 'event_date'} 
                        onValueChange={(v) => setEditingTemplate({...editingTemplate, timing_reference: v})}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="בחר ייחוס" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="event_date">תאריך האירוע</SelectItem>
                          <SelectItem value="event_end_time">סיום האירוע</SelectItem>
                          <SelectItem value="payment_due_date">מועד תשלום</SelectItem>
                          <SelectItem value="assignment_date">מועד שיבוץ</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <FieldLabel 
                        label="תזכורת חוזרת כל" 
                        tooltip="כל כמה זמן לשלוח תזכורת חוזרת (השאר ריק לביטול תזכורות חוזרות)"
                      />
                      <Input
                        type="number"
                        value={editingTemplate.reminder_interval_value || ''}
                        onChange={(e) => setEditingTemplate({
                          ...editingTemplate, 
                          reminder_interval_value: e.target.value ? parseInt(e.target.value) : null
                        })}
                        placeholder="24"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <FieldLabel label="יחידת זמן לתזכורת" />
                      <Select 
                        value={editingTemplate.reminder_interval_unit || 'hours'} 
                        onValueChange={(v) => setEditingTemplate({...editingTemplate, reminder_interval_unit: v})}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hours">שעות</SelectItem>
                          <SelectItem value="days">ימים</SelectItem>
                          <SelectItem value="weeks">שבועות</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {/* תנאים נוספים - זמין לכל הטריגרים */}
              <div className="p-3 bg-gray-50 rounded-lg mt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <h4 className="font-medium text-sm text-gray-700">תנאים נוספים</h4>
                    <div className="flex bg-gray-100 rounded p-0.5">
                      <button
                        type="button"
                        onClick={() => setEditingTemplate({...editingTemplate, condition_logic: 'and'})}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          (editingTemplate.condition_logic || 'and') === 'and' 
                            ? 'bg-white shadow text-blue-600 font-medium' 
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        גם (AND)
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTemplate({...editingTemplate, condition_logic: 'or'})}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          editingTemplate.condition_logic === 'or' 
                            ? 'bg-white shadow text-blue-600 font-medium' 
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        או (OR)
                      </button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-blue-600 hover:bg-blue-50"
                    onClick={() => {
                      const current = getConditions(editingTemplate);
                      updateConditions([...current, { field: 'status', operator: 'equals', value: '' }]);
                    }}
                  >
                    <Plus className="h-3 w-3 ml-1" />
                    הוסף תנאי
                  </Button>
                </div>
                
                <div className="space-y-2">
                  {getConditions(editingTemplate).length === 0 && (
                    <p className="text-xs text-gray-400 italic">לא הוגדרו תנאים נוספים</p>
                  )}
                  
                  {getConditions(editingTemplate).map((condition, idx) => (
                    <div key={idx} className="flex gap-2 items-start bg-white p-2 rounded border">
                      <div className="grid grid-cols-3 gap-2 flex-1">
                        {/* Field Selector (Editable) */}
                        <div className="relative">
                          <Input
                            list={`fields-list-${idx}`}
                            className="h-8 text-xs pr-2"
                            placeholder="שדה"
                            value={condition.field}
                            onChange={(e) => {
                              const newConds = [...getConditions(editingTemplate)];
                              newConds[idx] = { ...newConds[idx], field: e.target.value }; // Don't reset value aggressively to allow typing
                              updateConditions(newConds);
                            }}
                          />
                          <datalist id={`fields-list-${idx}`}>
                            {Object.entries(CONDITION_FIELDS).map(([key, info]) => (
                              <option key={key} value={key}>{info.label}</option>
                            ))}
                          </datalist>
                        </div>

                        {/* Operator Selector */}
                        <Select
                          value={condition.operator}
                          onValueChange={(v) => {
                            const newConds = [...getConditions(editingTemplate)];
                            newConds[idx] = { ...newConds[idx], operator: v };
                            updateConditions(newConds);
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(OPERATORS).map(([op, label]) => (
                              <SelectItem key={op} value={op}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Value Input */}
                        {CONDITION_FIELDS[condition.field]?.type === 'select' ? (
                          <Select
                            value={condition.value}
                            onValueChange={(v) => {
                              const newConds = [...getConditions(editingTemplate)];
                              newConds[idx] = { ...newConds[idx], value: v };
                              updateConditions(newConds);
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="בחר ערך" />
                            </SelectTrigger>
                            <SelectContent>
                              {CONDITION_FIELDS[condition.field].options.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type={CONDITION_FIELDS[condition.field]?.type === 'number' ? 'number' : 'text'}
                            placeholder={CONDITION_FIELDS[condition.field]?.description || 'ערך'}
                            className="h-8 text-xs"
                            value={condition.value}
                            disabled={condition.operator === 'changed'}
                            onChange={(e) => {
                              const newConds = [...getConditions(editingTemplate)];
                              newConds[idx] = { ...newConds[idx], value: e.target.value };
                              updateConditions(newConds);
                            }}
                          />
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:bg-red-50 shrink-0"
                        onClick={() => {
                          const newConds = getConditions(editingTemplate).filter((_, i) => i !== idx);
                          updateConditions(newConds);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* הגדרות מתקדמות */}
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between text-gray-600">
                    <span>הגדרות מתקדמות</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-3 bg-gray-50 rounded-lg mt-2 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <FieldLabel 
                          label="סוג קישור חכם" 
                          tooltip="יוצר באופן אוטומטי קישור ישיר לדף הרלוונטי (למשל: לאירוע הספציפי שהפעיל את ההתראה). מומלץ להשתמש בזה כדי לחסוך הגדרת פרמטרים ידנית."
                        />
                        <Select 
                          value={editingTemplate.dynamic_url_type || 'none'} 
                          onValueChange={(v) => setEditingTemplate({...editingTemplate, dynamic_url_type: v})}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="בחר סוג קישור" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">ללא / ידני</SelectItem>
                            <SelectItem value="event_page">כרטיסיית אירוע</SelectItem>
                            <SelectItem value="payment_page">דף תשלומים</SelectItem>
                            <SelectItem value="assignment_page">דף שיבוצים/ספק</SelectItem>
                            <SelectItem value="calendar_page">לוח אירועים</SelectItem>
                            <SelectItem value="settings_page">הגדרות</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      {(!editingTemplate.dynamic_url_type || editingTemplate.dynamic_url_type === 'none') && (
                      <div>
                        <FieldLabel 
                          label="דף יעד ידני" 
                          tooltip="בחר דף מתוך הדפים הזמינים לקהל היעד הנבחר"
                        />
                        <div className="text-xs text-gray-500 mb-1">
                          הדפים מוצגים בהתאם לקהלי היעד שנבחרו ({editingTemplate.target_audiences?.map(a => AUDIENCES[a]?.label).join(', ')})
                        </div>
                        <Select 
                          value={editingTemplate.deep_link_base || ''} 
                          onValueChange={(v) => setEditingTemplate({...editingTemplate, deep_link_base: v})}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="בחר דף" />
                          </SelectTrigger>
                          <SelectContent>
                            {getRelevantPages().map((page, i) => (
                              <SelectItem key={`${page.value}-${i}`} value={page.value}>
                                <span className="flex justify-between w-full gap-2">
                                  <span>{page.label}</span>
                                  <span className="text-gray-400 text-[10px]">{page.role}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      )}
                      <div>
                        <FieldLabel 
                          label="פרמטרים" 
                          tooltip='פרמטרים להעברה לדף היעד בפורמט JSON. למשל: {"id": "{{event_id}}"}'
                        />
                        <Input
                          value={editingTemplate.deep_link_params_map || ''}
                          onChange={(e) => setEditingTemplate({...editingTemplate, deep_link_params_map: e.target.value})}
                          placeholder='{"id": "{{event_id}}"}'
                          className="font-mono text-sm mt-1"
                        />
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* מצב פעיל */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Switch
                  checked={editingTemplate.is_active}
                  onCheckedChange={(checked) => setEditingTemplate({...editingTemplate, is_active: checked})}
                />
                <div>
                  <Label>התראה פעילה</Label>
                  <p className="text-xs text-gray-500">כבה כדי להשבית זמנית את ההתראה מבלי למחוק אותה</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex flex-col sm:flex-row gap-2 items-center border p-2 rounded-md bg-gray-50">
              <Input 
                placeholder="מספר טלפון לבדיקת WhatsApp" 
                value={testPhoneNumber}
                onChange={(e) => setTestPhoneNumber(e.target.value)}
                className="h-9 w-full sm:w-48 text-sm"
                dir="ltr"
              />
              <Button 
                variant="secondary" 
                onClick={handleSendTestNotification} 
                disabled={sendingTest || !editingTemplate?.title_template}
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
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                ביטול
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? (
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
    </div>
  );
}