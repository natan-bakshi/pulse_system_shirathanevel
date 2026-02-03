import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { 
  Bell, Plus, Pencil, Trash2, Save, X, Loader2, 
  AlertCircle, Info, Clock, Users, Zap, RefreshCw,
  ChevronDown, ChevronUp, HelpCircle, Copy
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
import { toast } from "@/components/ui/use-toast";

const TRIGGER_TYPES = {
  entity_create: 'יצירת רשומה',
  entity_update: 'עדכון רשומה',
  scheduled_check: 'בדיקה מתוזמנת',
  manual: 'ידני'
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

const AUDIENCES = {
  supplier: 'ספקים',
  client: 'לקוחות',
  admin: 'מנהלים',
  system_creator: 'יוצר המערכת'
};

const AVAILABLE_VARIABLES = {
  event_name: { description: 'שם האירוע', example: 'חתונה של משפחת כהן' },
  family_name: { description: 'שם המשפחה', example: 'כהן' },
  event_date: { description: 'תאריך האירוע', example: '15/03/2024' },
  event_time: { description: 'שעת האירוע', example: '19:00' },
  event_location: { description: 'מיקום האירוע', example: 'אולמי הגן' },
  supplier_name: { description: 'שם הספק', example: 'סטודיו צילום' },
  service_name: { description: 'שם השירות', example: 'צילום' },
  balance: { description: 'יתרה לתשלום', example: '5,000' },
  days_open: { description: 'מספר ימים פתוח', example: '14' },
  min_suppliers: { description: 'מספר ספקים נדרש', example: '2' },
  current_suppliers: { description: 'מספר ספקים משובצים', example: '1' },
  event_id: { description: 'מזהה האירוע', example: 'abc123' }
};

const DEEP_LINK_PAGES = [
  'SupplierDashboard',
  'ClientDashboard',
  'AdminDashboard',
  'EventDetails',
  'EventManagement'
];

export default function NotificationSettings() {
  const queryClient = useQueryClient();
  const [isCreator, setIsCreator] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('templates');
  const [expandedHelp, setExpandedHelp] = useState(false);

  // Check if user is system creator
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser
  });

  // Verify system creator
  useEffect(() => {
    if (currentUser && allUsers.length > 0) {
      const admins = allUsers.filter(u => u.role === 'admin');
      const sortedAdmins = admins.sort((a, b) => 
        new Date(a.created_date) - new Date(b.created_date)
      );
      const creator = sortedAdmins[0];
      setIsCreator(creator?.id === currentUser.id || creator?.email === currentUser.email);
    }
  }, [currentUser, allUsers]);

  // Fetch templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['notificationTemplates'],
    queryFn: () => base44.entities.NotificationTemplate.list(),
    enabled: isCreator
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
      toast({ title: "נשמר בהצלחה", description: "תבנית ההתראה עודכנה" });
    },
    onError: (error) => {
      toast({ title: "שגיאה", description: error.message, variant: "destructive" });
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.NotificationTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationTemplates'] });
      toast({ title: "נמחק", description: "תבנית ההתראה נמחקה" });
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

  // Loading state
  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Access denied
  if (!isCreator) {
    return (
      <div className="max-w-2xl mx-auto mt-10">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            אין לך הרשאה לצפות בדף זה. רק יוצר המערכת יכול לנהל את הגדרות ההתראות.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

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
      category: 'system'
    });
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (!editingTemplate.type || !editingTemplate.name || !editingTemplate.title_template) {
      toast({ title: "שגיאה", description: "נא למלא את כל השדות החובה", variant: "destructive" });
      return;
    }
    saveMutation.mutate(editingTemplate);
  };

  const copyVariable = (variable) => {
    navigator.clipboard.writeText(`{{${variable}}}`);
    toast({ title: "הועתק", description: `{{${variable}}} הועתק ללוח` });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6" />
            ניהול התראות
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            הגדרת תבניות התראות, תזמונים וקהלי יעד
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 ml-2" />
          תבנית חדשה
        </Button>
      </div>

      {/* Help Section */}
      <Collapsible open={expandedHelp} onOpenChange={setExpandedHelp}>
        <Card>
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
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                <Bell className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>אין תבניות התראה. לחץ על "תבנית חדשה" ליצירת תבנית ראשונה.</p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(templatesByCategory).map(([category, categoryTemplates]) => (
              <Card key={category}>
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
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{template.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {TRIGGER_TYPES[template.trigger_type]}
                            </Badge>
                            {template.target_audiences?.map(a => (
                              <Badge key={a} variant="secondary" className="text-xs">
                                {AUDIENCES[a]}
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
          <Card>
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="type">קוד זיהוי (type) *</Label>
                  <Input
                    id="type"
                    value={editingTemplate.type}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate, 
                      type: e.target.value.toUpperCase().replace(/[^A-Z_]/g, '')
                    })}
                    placeholder="SUPPLIER_NEW_ASSIGNMENT"
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="name">שם התבנית *</Label>
                  <Input
                    id="name"
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({...editingTemplate, name: e.target.value})}
                    placeholder="שיבוץ חדש לספק"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="description">תיאור</Label>
                <Input
                  id="description"
                  value={editingTemplate.description || ''}
                  onChange={(e) => setEditingTemplate({...editingTemplate, description: e.target.value})}
                  placeholder="תיאור התבנית למנהל"
                />
              </div>

              <Separator />

              <div>
                <Label htmlFor="title_template">כותרת ההתראה *</Label>
                <Input
                  id="title_template"
                  value={editingTemplate.title_template}
                  onChange={(e) => setEditingTemplate({...editingTemplate, title_template: e.target.value})}
                  placeholder="שיבוץ חדש לאירוע {{event_name}}"
                />
              </div>

              <div>
                <Label htmlFor="body_template">תוכן ההודעה *</Label>
                <Textarea
                  id="body_template"
                  value={editingTemplate.body_template}
                  onChange={(e) => setEditingTemplate({...editingTemplate, body_template: e.target.value})}
                  placeholder="שלום {{supplier_name}}, שובצת לאירוע {{event_name}}..."
                  rows={3}
                />
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="category">קטגוריה</Label>
                  <Select 
                    value={editingTemplate.category || 'system'} 
                    onValueChange={(v) => setEditingTemplate({...editingTemplate, category: v})}
                  >
                    <SelectTrigger>
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
                  <Label htmlFor="trigger_type">סוג טריגר</Label>
                  <Select 
                    value={editingTemplate.trigger_type} 
                    onValueChange={(v) => setEditingTemplate({...editingTemplate, trigger_type: v})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TRIGGER_TYPES).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>קהל יעד</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {Object.entries(AUDIENCES).map(([value, label]) => (
                    <Button
                      key={value}
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
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>תזמון (לפני)</Label>
                  <Input
                    type="number"
                    value={editingTemplate.timing_value || ''}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate, 
                      timing_value: e.target.value ? parseInt(e.target.value) : null
                    })}
                    placeholder="7"
                  />
                </div>
                <div>
                  <Label>יחידה</Label>
                  <Select 
                    value={editingTemplate.timing_unit || 'days'} 
                    onValueChange={(v) => setEditingTemplate({...editingTemplate, timing_unit: v})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TIMING_UNITS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>מקסימום תזכורות</Label>
                  <Input
                    type="number"
                    value={editingTemplate.max_reminders || ''}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate, 
                      max_reminders: e.target.value ? parseInt(e.target.value) : 3
                    })}
                    placeholder="3"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>תזכורת חוזרת כל</Label>
                  <Input
                    type="number"
                    value={editingTemplate.reminder_interval_value || ''}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate, 
                      reminder_interval_value: e.target.value ? parseInt(e.target.value) : null
                    })}
                    placeholder="24"
                  />
                </div>
                <div>
                  <Label>יחידת תזכורת</Label>
                  <Select 
                    value={editingTemplate.reminder_interval_unit || 'hours'} 
                    onValueChange={(v) => setEditingTemplate({...editingTemplate, reminder_interval_unit: v})}
                  >
                    <SelectTrigger>
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

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>דף יעד (Deep Link)</Label>
                  <Select 
                    value={editingTemplate.deep_link_base || ''} 
                    onValueChange={(v) => setEditingTemplate({...editingTemplate, deep_link_base: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="בחר דף" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEEP_LINK_PAGES.map((page) => (
                        <SelectItem key={page} value={page}>{page}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>פרמטרים (JSON)</Label>
                  <Input
                    value={editingTemplate.deep_link_params_map || ''}
                    onChange={(e) => setEditingTemplate({...editingTemplate, deep_link_params_map: e.target.value})}
                    placeholder='{"id": "{{event_id}}"}'
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={editingTemplate.is_active}
                  onCheckedChange={(checked) => setEditingTemplate({...editingTemplate, is_active: checked})}
                />
                <Label>התראה פעילה</Label>
              </div>
            </div>
          )}

          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}