import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Image, UploadCloud, Loader2, Save, Building, MessageSquare, Lock, Calculator, FileText, LayoutGrid } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

const settingKeys = [
    'background_image_url', 
    'company_name', 
    'company_logo_url', 
    'supplier_reminder_template',
    'client_reminder_template',
    'vat_rate',
    'quote_body_font_size',
    'quote_title_font_size',
    'show_events_board_tab'
    ];

export default function SettingsPage() {
    const [isCreator, setIsCreator] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [settings, setSettings] = useState({
        background_image_url: "",
        company_name: "",
        company_logo_url: "",
        supplier_reminder_template: "",
        client_reminder_template: "",
        vat_rate: "18",
        quote_body_font_size: "15",
        quote_title_font_size: "16",
        show_events_board_tab: "false"
        });
    const queryClient = useQueryClient();

    // React Query for current user
    const { data: user, isLoading: userLoading } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => base44.auth.me(),
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000
    });

    // React Query for all users (to check creator)
    const { data: allUsers = [], isLoading: usersLoading } = useQuery({
        queryKey: ['allUsers'],
        queryFn: () => base44.entities.User.filter({ role: 'admin' }, 'created_date', 1),
        enabled: !!user,
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000
    });

    // React Query for app settings
    const { data: appSettings = [], isLoading: settingsLoading } = useQuery({
        queryKey: ['appSettings'],
        queryFn: () => base44.entities.AppSettings.list(),
        enabled: isCreator,
        staleTime: 10 * 60 * 1000,
        cacheTime: 30 * 60 * 1000
    });

    // React Query for services (to get categories)
    const { data: allServices = [] } = useQuery({
        queryKey: ['services'],
        queryFn: () => base44.entities.Service.list(),
        enabled: isCreator,
        staleTime: 5 * 60 * 1000
    });

    const loading = userLoading || usersLoading || settingsLoading;

    // Check if current user is creator
    useEffect(() => {
        if (user && allUsers.length > 0) {
            setIsCreator(allUsers[0].id === user.id);
        }
    }, [user, allUsers]);

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
            <p>רק יוצר המערכת הראשי מורשה לגשת לדף ההגדרות.</p>
          </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-white">הגדרות מערכת</h1>
                <Button onClick={handleSaveSettings} disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                    שמור הגדרות
                </Button>
            </div>
            
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
                        <Label htmlFor="bg-upload">תמונת רקע</Label>
                        <div className="mt-2 flex items-center gap-4">
                            <Input id="background_image_url" value={settings.background_image_url} onChange={e => handleSettingChange('background_image_url', e.target.value)} placeholder="הדבק URL או העלה קובץ" />
                             <Input id="bg-upload" type="file" accept="image/*" onChange={e => handleFileChange(e, 'background_image_url')} disabled={isUploading} className="hidden" />
                             <Label htmlFor="bg-upload" className="cursor-pointer">
                                {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
                            </Label>
                        </div>
                        {settings.background_image_url && <img src={settings.background_image_url} alt="רקע" className="h-32 w-auto mt-2 rounded-lg object-cover border" />}
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
                <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />תבניות הודעות</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label htmlFor="client_reminder_template">תזכורת ללקוח</Label>
                        <Textarea id="client_reminder_template" rows={4} value={settings.client_reminder_template} onChange={e => handleSettingChange('client_reminder_template', e.target.value)} placeholder="שלום {שם_לקוח}, תזכורת לגבי אירוע {שם_אירוע} בתאריך {תאריך_אירוע}..." />
                    </div>
                    <div>
                        <Label htmlFor="supplier_reminder_template">תזכורת לספק</Label>
                        <Textarea id="supplier_reminder_template" rows={4} value={settings.supplier_reminder_template} onChange={e => handleSettingChange('supplier_reminder_template', e.target.value)} placeholder="שלום {שם_ספק}, תזכורת לגבי אירוע {שם_אירוע} בתאריך {תאריך_אירוע}..." />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}