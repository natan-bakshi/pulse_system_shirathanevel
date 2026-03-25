import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Image, UploadCloud, Loader2, Save, Building, Lock, Calculator, FileText, LayoutGrid, HardDrive, Bell, Calendar, Plus, Trash2, Mail } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BackupManager from "@/components/backup/BackupManager";
import NotificationManagementTab from "@/components/admin/NotificationManagementTab";

const settingKeys = [
    'background_image_url', 
    'background_image_dark_url',
    'company_name', 
    'company_logo_url', 
    'vat_rate',
    'usd_ils_exchange_rate',
    'quote_body_font_size',
    'quote_title_font_size',
    'show_events_board_tab',
    'quote_html_desktop_margin_top',
    'quote_html_desktop_margin_bottom',
    'quote_html_desktop_margin_left',
    'quote_html_desktop_margin_right',
    'quote_html_mobile_margin_top',
    'quote_html_mobile_margin_bottom',
    'quote_html_mobile_margin_left',
    'quote_html_mobile_margin_right',
    'google_calendar_sync_enabled',
    'google_calendar_admin_sync_enabled',
    'google_calendar_supplier_sync_enabled',
    'google_calendar_admin_emails'
    ];

function AdminCalendarEmails({ value, onChange }) {
    const emails = value ? value.split(',').map(e => e.trim()).filter(Boolean) : [];
    const [newEmail, setNewEmail] = React.useState('');

    const addEmail = () => {
        const email = newEmail.trim().toLowerCase();
        if (!email) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            alert('כתובת מייל לא תקינה');
            return;
        }
        if (emails.includes(email)) {
            alert('כתובת המייל כבר קיימת ברשימה');
            return;
        }
        onChange([...emails, email].join(','));
        setNewEmail('');
    };

    const removeEmail = (emailToRemove) => {
        onChange(emails.filter(e => e !== emailToRemove).join(','));
    };

    return (
        <div className="space-y-3 pb-4 border-b">
            <div>
                <Label className="flex items-center gap-1.5">
                    <Mail className="h-4 w-4" />
                    כתובות מייל של מנהלים לסנכרון
                </Label>
                <p className="text-xs text-gray-500 mt-1">הוסף את כתובות ה-Gmail של המנהלים שאליהם יסונכרנו האירועים. כל מנהל צריך גם לחבר את יומן Google דרך דף הגדרות המשתמש.</p>
            </div>
            
            <div className="flex gap-2">
                <Input 
                    value={newEmail} 
                    onChange={e => setNewEmail(e.target.value)} 
                    placeholder="example@gmail.com"
                    className="dir-ltr text-left flex-1"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
                />
                <Button type="button" variant="outline" size="sm" onClick={addEmail}>
                    <Plus className="h-4 w-4 ml-1" />
                    הוסף
                </Button>
            </div>

            {emails.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {emails.map(email => (
                        <Badge key={email} variant="secondary" className="flex items-center gap-1 py-1.5 px-3 text-sm">
                            <span className="dir-ltr">{email}</span>
                            <button 
                                type="button" 
                                onClick={() => removeEmail(email)} 
                                className="mr-1 text-gray-500 hover:text-red-600 transition-colors"
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">לא נוספו כתובות מייל. אם הרשימה ריקה, כל מנהל שחיבר יומן Google יקבל סנכרון.</p>
            )}
        </div>
    );
}

export default function SettingsPage() {
    const [isCreator, setIsCreator] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [activeTab, setActiveTab] = useState('general');
    const [settings, setSettings] = useState({
        background_image_url: "",
        background_image_dark_url: "",
        company_name: "",
        company_logo_url: "",
        vat_rate: "18",
        usd_ils_exchange_rate: "3.6",
        quote_body_font_size: "15",
        quote_title_font_size: "16",
        show_events_board_tab: "false",
        quote_html_desktop_margin_top: "20",
        quote_html_desktop_margin_bottom: "20",
        quote_html_desktop_margin_left: "20",
        quote_html_desktop_margin_right: "20",
        quote_html_mobile_margin_top: "8",
        quote_html_mobile_margin_bottom: "8",
        quote_html_mobile_margin_left: "6",
        quote_html_mobile_margin_right: "6",
        google_calendar_sync_enabled: "false",
        google_calendar_admin_sync_enabled: "false",
        google_calendar_supplier_sync_enabled: "false",
        google_calendar_admin_emails: ""
        });
    const queryClient = useQueryClient();
    const location = useLocation();

    // React Query for current user
    const { data: user, isLoading: userLoading } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => base44.auth.me(),
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000
    });

    // React Query for app settings - always fetch if user is logged in
    const { data: appSettings = [], isLoading: settingsLoading } = useQuery({
        queryKey: ['appSettings'],
        queryFn: () => base44.entities.AppSettings.list(),
        enabled: !!user,
        staleTime: 10 * 60 * 1000,
        cacheTime: 30 * 60 * 1000
    });

    const loading = userLoading || settingsLoading;

    // System creator email - hardcoded for security
    const SYSTEM_CREATOR_EMAIL = 'natib8000@gmail.com';
    
    // Check if current user is the system creator
    useEffect(() => {
        if (user) {
            setIsCreator(user.email === SYSTEM_CREATOR_EMAIL);
        }
    }, [user]);

    // Handle URL tab parameter
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tab = params.get('tab');
        if (tab && ['general', 'notifications', 'backup'].includes(tab)) {
            setActiveTab(tab);
        }
    }, [location.search]);

    // Populate settings from query data
    useEffect(() => {
        if (isCreator && appSettings.length > 0) {
            const settingsMap = appSettings.reduce((acc, setting) => {
                if (settingKeys.includes(setting.setting_key)) {
                    acc[setting.setting_key] = setting.setting_value;
                }
                return acc;
            }, {});
            
            if (!settingsMap.vat_rate) {
                settingsMap.vat_rate = "18";
            }
            if (!settingsMap.quote_body_font_size) {
                settingsMap.quote_body_font_size = "15";
            }
            if (!settingsMap.quote_title_font_size) {
                settingsMap.quote_title_font_size = "16";
            }
            
            setSettings(prev => ({ ...prev, ...settingsMap }));
        }
    }, [isCreator, appSettings]);

    const handleFileChange = useCallback(async (e, key) => {
        const file = e.target.files[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const response = await base44.integrations.Core.UploadFile({ file });
            if (response?.file_url) {
                setSettings(prev => ({ ...prev, [key]: response.file_url }));
                alert("התמונה עודכנה. התצוגה המקדימה תתעדכן לאחר שמירה.");
            }
        } catch (error) {
            console.error("Failed to upload file:", error);
            alert("שגיאה בהעלאת התמונה.");
        } finally {
            setIsUploading(false);
        }
    }, []);

    const handleSettingChange = useCallback((key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleSaveSettings = useCallback(async () => {
        setIsSaving(true);
        try {
            const existingSettings = await base44.entities.AppSettings.list();
            const promises = settingKeys.map(key => {
                const existing = existingSettings.find(s => s.setting_key === key);
                const value = settings[key] || "";
                if (existing) {
                    if (existing.setting_value !== value) {
                        return base44.entities.AppSettings.update(existing.id, { setting_value: value });
                    }
                } else if (value) {
                    return base44.entities.AppSettings.create({ setting_key: key, setting_value: value });
                }
                return Promise.resolve();
            });
            await Promise.all(promises);
            
            // Invalidate app settings cache to refresh across the app
            queryClient.invalidateQueries({ queryKey: ['appSettings'] });
            
            alert("ההגדרות נשמרו בהצלחה!");
        } catch (error) {
            console.error("Failed to save settings:", error);
            alert("שגיאה בשמירת ההגדרות.");
        } finally {
            setIsSaving(false);
        }
    }, [settings, queryClient]);

    if (loading) {
        return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>;
    }

    if (!isCreator) {
        return (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center text-white">
            <Lock className="h-16 w-16 mb-4" />
            <h1 className="text-2xl font-bold">הגישה נדחתה</h1>
            <p>רק יוצר המערכת הראשי או מנהל מורשה לגשת לדף ההגדרות.</p>
          </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-white">הגדרות מערכת</h1>
                {activeTab === 'general' && (
                    <Button onClick={handleSaveSettings} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                        שמור הגדרות
                    </Button>
                )}
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="general">הגדרות כלליות</TabsTrigger>
                    <TabsTrigger value="notifications" className="flex items-center gap-1">
                        <Bell className="h-4 w-4" />
                        ניהול התראות
                    </TabsTrigger>
                    <TabsTrigger value="backup">גיבוי ושחזור</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-6 mt-6">
                    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                        <CardHeader><CardTitle className="flex items-center gap-2"><Building className="h-5 w-5" />פרטים כלליים</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="company_name">שם החברה</Label>
                                <Input id="company_name" value={settings.company_name} onChange={e => handleSettingChange('company_name', e.target.value)} />
                            </div>
                            <div>
                                <Label htmlFor="logo-upload">לוגו (URL או העלאה)</Label>
                                <div className="mt-2 flex items-center gap-4">
                                    <Input id="company_logo_url" value={settings.company_logo_url} onChange={e => handleSettingChange('company_logo_url', e.target.value)} placeholder="הדבק URL או העלה קובץ" />
                                    <Input id="logo-upload" type="file" accept="image/*" onChange={e => handleFileChange(e, 'company_logo_url')} disabled={isUploading} className="hidden" />
                                    <Label htmlFor="logo-upload" className="cursor-pointer">
                                        {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
                                    </Label>
                                </div>
                                {settings.company_logo_url && <img src={settings.company_logo_url} alt="לוגו" className="h-16 w-auto mt-2 rounded border" />}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                        <CardHeader><CardTitle className="flex items-center gap-2"><Image className="h-5 w-5" />הגדרות תצוגה</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="bg-upload">תמונת רקע - מצב בהיר</Label>
                                <div className="mt-2 flex items-center gap-4">
                                    <Input id="background_image_url" value={settings.background_image_url} onChange={e => handleSettingChange('background_image_url', e.target.value)} placeholder="הדבק URL או העלה קובץ" />
                                     <Input id="bg-upload" type="file" accept="image/*" onChange={e => handleFileChange(e, 'background_image_url')} disabled={isUploading} className="hidden" />
                                     <Label htmlFor="bg-upload" className="cursor-pointer">
                                        {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
                                    </Label>
                                </div>
                                {settings.background_image_url && <img src={settings.background_image_url} alt="רקע בהיר" className="h-32 w-auto mt-2 rounded-lg object-cover border" />}
                            </div>
                            <div>
                                <Label htmlFor="bg-dark-upload">תמונת רקע - מצב כהה</Label>
                                <div className="mt-2 flex items-center gap-4">
                                    <Input id="background_image_dark_url" value={settings.background_image_dark_url} onChange={e => handleSettingChange('background_image_dark_url', e.target.value)} placeholder="הדבק URL או העלה קובץ" />
                                     <Input id="bg-dark-upload" type="file" accept="image/*" onChange={e => handleFileChange(e, 'background_image_dark_url')} disabled={isUploading} className="hidden" />
                                     <Label htmlFor="bg-dark-upload" className="cursor-pointer">
                                        {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
                                    </Label>
                                </div>
                                {settings.background_image_dark_url && <img src={settings.background_image_dark_url} alt="רקע כהה" className="h-32 w-auto mt-2 rounded-lg object-cover border" />}
                                <p className="text-xs text-gray-500 mt-1">אם לא תוגדר תמונה למצב כהה, תשמש תמונת הרקע של מצב בהיר</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                        <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" />הגדרות פיננסיות</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="vat_rate">אחוז מע"מ (%)</Label>
                                <Input 
                                    id="vat_rate" 
                                    type="number" 
                                    min="0" 
                                    max="100" 
                                    step="0.01"
                                    value={settings.vat_rate} 
                                    onChange={e => handleSettingChange('vat_rate', e.target.value)} 
                                    placeholder="18"
                                />
                                <p className="text-xs text-gray-500 mt-1">אחוז המע"מ שישמש בכל חישובי המערכת (ברירת מחדל: 18%)</p>
                            </div>
                            <div>
                                <Label htmlFor="usd_ils_exchange_rate">שער חליפין דולר/שקל</Label>
                                <Input 
                                    id="usd_ils_exchange_rate" 
                                    type="number" 
                                    min="0" 
                                    step="0.01"
                                    value={settings.usd_ils_exchange_rate} 
                                    onChange={e => handleSettingChange('usd_ils_exchange_rate', e.target.value)} 
                                    placeholder="3.6"
                                />
                                <p className="text-xs text-gray-500 mt-1">שער המרה דולר לשקל. משמש לחישוב מחירים באירועים עם מטבעות מעורבים</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />הגדרות הצעת מחיר</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="quote_body_font_size">גודל פונט גוף הטקסט (px)</Label>
                                <Input 
                                    id="quote_body_font_size" 
                                    type="number" 
                                    min="8" 
                                    max="72" 
                                    step="1"
                                    value={settings.quote_body_font_size} 
                                    onChange={e => handleSettingChange('quote_body_font_size', e.target.value)} 
                                    placeholder="15"
                                />
                                <p className="text-xs text-gray-500 mt-1">גודל הפונט של תוכן ההצעה (ברירת מחדל: 15px, מומלץ: 8-72)</p>
                            </div>
                            <div>
                                <Label htmlFor="quote_title_font_size">גודל פונט כותרות (px)</Label>
                                <Input 
                                    id="quote_title_font_size" 
                                    type="number" 
                                    min="8" 
                                    max="72" 
                                    step="1"
                                    value={settings.quote_title_font_size} 
                                    onChange={e => handleSettingChange('quote_title_font_size', e.target.value)} 
                                    placeholder="16"
                                />
                                <p className="text-xs text-gray-500 mt-1">גודל הפונט של כותרות בהצעה (ברירת מחדל: 16px, מומלץ: 8-72)</p>
                            </div>

                            <div className="border-t pt-4 mt-4">
                                <h3 className="text-sm font-semibold mb-3">שוליים - תצוגת מחשב (mm)</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="quote_html_desktop_margin_top">למעלה</Label>
                                        <Input id="quote_html_desktop_margin_top" type="number" min="0" max="100" step="1" value={settings.quote_html_desktop_margin_top} onChange={e => handleSettingChange('quote_html_desktop_margin_top', e.target.value)} placeholder="20" />
                                    </div>
                                    <div>
                                        <Label htmlFor="quote_html_desktop_margin_bottom">למטה</Label>
                                        <Input id="quote_html_desktop_margin_bottom" type="number" min="0" max="100" step="1" value={settings.quote_html_desktop_margin_bottom} onChange={e => handleSettingChange('quote_html_desktop_margin_bottom', e.target.value)} placeholder="20" />
                                    </div>
                                    <div>
                                        <Label htmlFor="quote_html_desktop_margin_right">ימין</Label>
                                        <Input id="quote_html_desktop_margin_right" type="number" min="0" max="100" step="1" value={settings.quote_html_desktop_margin_right} onChange={e => handleSettingChange('quote_html_desktop_margin_right', e.target.value)} placeholder="20" />
                                    </div>
                                    <div>
                                        <Label htmlFor="quote_html_desktop_margin_left">שמאל</Label>
                                        <Input id="quote_html_desktop_margin_left" type="number" min="0" max="100" step="1" value={settings.quote_html_desktop_margin_left} onChange={e => handleSettingChange('quote_html_desktop_margin_left', e.target.value)} placeholder="20" />
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">שוליים לתצוגת הצעת מחיר ב-HTML במחשב (ברירת מחדל: 20mm לכל צד)</p>
                            </div>

                            <div className="border-t pt-4 mt-4">
                                <h3 className="text-sm font-semibold mb-3">שוליים - תצוגת מובייל (mm)</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="quote_html_mobile_margin_top">למעלה</Label>
                                        <Input id="quote_html_mobile_margin_top" type="number" min="0" max="100" step="1" value={settings.quote_html_mobile_margin_top} onChange={e => handleSettingChange('quote_html_mobile_margin_top', e.target.value)} placeholder="8" />
                                    </div>
                                    <div>
                                        <Label htmlFor="quote_html_mobile_margin_bottom">למטה</Label>
                                        <Input id="quote_html_mobile_margin_bottom" type="number" min="0" max="100" step="1" value={settings.quote_html_mobile_margin_bottom} onChange={e => handleSettingChange('quote_html_mobile_margin_bottom', e.target.value)} placeholder="8" />
                                    </div>
                                    <div>
                                        <Label htmlFor="quote_html_mobile_margin_right">ימין</Label>
                                        <Input id="quote_html_mobile_margin_right" type="number" min="0" max="100" step="1" value={settings.quote_html_mobile_margin_right} onChange={e => handleSettingChange('quote_html_mobile_margin_right', e.target.value)} placeholder="6" />
                                    </div>
                                    <div>
                                        <Label htmlFor="quote_html_mobile_margin_left">שמאל</Label>
                                        <Input id="quote_html_mobile_margin_left" type="number" min="0" max="100" step="1" value={settings.quote_html_mobile_margin_left} onChange={e => handleSettingChange('quote_html_mobile_margin_left', e.target.value)} placeholder="6" />
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">שוליים לתצוגת הצעת מחיר ב-HTML במובייל (ברירת מחדל: 8mm למעלה/למטה, 6mm לצדדים)</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                        <CardHeader><CardTitle className="flex items-center gap-2"><LayoutGrid className="h-5 w-5" />הגדרות ממשק</CardTitle></CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between pb-4 border-b">
                                <div>
                                    <Label htmlFor="show_events_board_tab">הצגת לשונית לוח אירועים</Label>
                                    <p className="text-xs text-gray-500 mt-1">הפעל תצוגת לוח שיבוצים טבלאי בעמוד ניהול אירועים</p>
                                </div>
                                <Switch 
                                    id="show_events_board_tab"
                                    checked={settings.show_events_board_tab === "true"}
                                    onCheckedChange={(checked) => handleSettingChange('show_events_board_tab', checked ? "true" : "false")}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                        <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" />סנכרון Google Calendar</CardTitle></CardHeader>
                        <CardContent className="space-y-6">
                            {/* Toggle מנהלים */}
                            <div className="flex items-center justify-between pb-4 border-b">
                                <div>
                                    <Label htmlFor="google_calendar_admin_sync_enabled">סנכרון למנהלים</Label>
                                    <p className="text-xs text-gray-500 mt-1">כאשר מופעל, אירועים יסונכרנו אוטומטית ליומני Google של המנהלים</p>
                                </div>
                                <Switch 
                                    id="google_calendar_admin_sync_enabled"
                                    checked={settings.google_calendar_admin_sync_enabled === "true"}
                                    onCheckedChange={(checked) => handleSettingChange('google_calendar_admin_sync_enabled', checked ? "true" : "false")}
                                />
                            </div>

                            {/* Toggle ספקים */}
                            <div className="flex items-center justify-between pb-4 border-b">
                                <div>
                                    <Label htmlFor="google_calendar_supplier_sync_enabled">סנכרון לספקים</Label>
                                    <p className="text-xs text-gray-500 mt-1">כאשר מופעל, אירועים יסונכרנו ליומני Google של ספקים מאושרים</p>
                                </div>
                                <Switch 
                                    id="google_calendar_supplier_sync_enabled"
                                    checked={settings.google_calendar_supplier_sync_enabled === "true"}
                                    onCheckedChange={(checked) => handleSettingChange('google_calendar_supplier_sync_enabled', checked ? "true" : "false")}
                                />
                            </div>

                            {/* רשימת מיילים של מנהלים */}
                            {settings.google_calendar_admin_sync_enabled === "true" && (
                                <AdminCalendarEmails 
                                    value={settings.google_calendar_admin_emails} 
                                    onChange={(val) => handleSettingChange('google_calendar_admin_emails', val)} 
                                />
                            )}

                            <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800 space-y-2">
                                <p className="font-medium">איך זה עובד?</p>
                                <ul className="list-disc mr-5 space-y-1 text-xs">
                                    <li>מנהלים: הוסף כתובות Gmail למעלה. כל מנהל צריך לחבר את יומן Google שלו דרך דף הגדרות המשתמש</li>
                                    <li>ספקים: כל ספק צריך לחבר את יומן Google שלו דרך דף הגדרות המשתמש</li>
                                    <li>אירועים יסונכרנו אוטומטית בעת יצירה/עדכון/מחיקה</li>
                                    <li>שיבוץ ספק מאושר יוסיף אירוע ליומן שלו, ביטול ימחק אותו</li>
                                </ul>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="notifications" className="mt-6">
                    <NotificationManagementTab />
                </TabsContent>

                <TabsContent value="backup" className="mt-6">
                    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                        <CardHeader><CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5" />גיבוי ושחזור</CardTitle></CardHeader>
                        <CardContent>
                            <BackupManager />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}