import React, { useState, useEffect, useCallback, useMemo } from "react";
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Save, Plus, Trash2, Loader2, Edit, UploadCloud } from "lucide-react";

const quillModules = {
  toolbar: [
    [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    [{ 'align': [] }],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'font': [] }],
    [{ 'script': 'sub'}, { 'script': 'super' }],
    [{ 'indent': '-1'}, { 'indent': '+1' }],
    [{ 'direction': 'rtl' }],
    ['link', 'image'],
    ['clean']
  ],
  clipboard: {
    matchVisual: false,
  }
};

const quillFormats = [
  'header', 'font', 'size',
  'bold', 'italic', 'underline', 'strike', 'blockquote',
  'list', 'bullet', 'indent',
  'link', 'image', 'color', 'background', 'align', 'script', 'direction'
];

function TemplateEditor({ template, onSave, onCancel, concepts, isSaving }) {
    const [content, setContent] = useState(template.content);
    const [identifier, setIdentifier] = useState(template.identifier);
    const [customConcept, setCustomConcept] = useState('');
    const [fontSize, setFontSize] = useState(template.font_size || '15');
    const [lineHeight, setLineHeight] = useState(template.line_height || '1.6');

    useEffect(() => {
        setContent(template.content);
        setIdentifier(template.identifier);
        setCustomConcept('');
        setFontSize(template.font_size || '15');
        setLineHeight(template.line_height || '1.6');
    }, [template]);

    const handleInternalSave = useCallback(() => {
        const finalIdentifier = customConcept || identifier;
        onSave({ 
            ...template, 
            content, 
            identifier: finalIdentifier,
            font_size: fontSize,
            line_height: lineHeight
        });
    }, [customConcept, identifier, content, fontSize, lineHeight, template, onSave]);

    return (
      <Card className="mt-4 bg-white/95">
        <CardHeader>
          <CardTitle>{template.id ? `עריכת תבנית: ${template.identifier}` : 'תבנית פתיח חדשה'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>מזהה (שם קונספט)</Label>
            {template.template_type === 'concept_intro' ? (
                <div className="space-y-2">
                    <Select value={identifier} onValueChange={(value) => {
                        setIdentifier(value);
                        setCustomConcept('');
                    }} disabled={isSaving}>
                        <SelectTrigger><SelectValue placeholder="בחר קונספט"/></SelectTrigger>
                        <SelectContent>
                            {concepts.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <div className="text-xs text-gray-500">או הכנס שם קונספט חדש:</div>
                    <Input
                        value={customConcept}
                        onChange={(e) => {
                            setCustomConcept(e.target.value);
                            setIdentifier('');
                        }}
                        placeholder="שם קונספט חדש..."
                        disabled={isSaving}
                    />
                    </div>
                    ) : (
                    <Input value={identifier} disabled />
                    )}
                    </div>

                    {template.template_type === 'concept_intro' && (
                    <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>גודל פונט (px)</Label>
                      <Input 
                          type="number" 
                          value={fontSize} 
                          onChange={(e) => setFontSize(e.target.value)} 
                          disabled={isSaving} 
                      />
                    </div>
                    <div>
                      <Label>מרווח שורות</Label>
                      <Input 
                          type="number" 
                          step="0.1" 
                          value={lineHeight} 
                          onChange={(e) => setLineHeight(e.target.value)} 
                          disabled={isSaving} 
                      />
                    </div>
                    </div>
                    )}

                    <div>
                    <Label>תוכן</Label>
            <ReactQuill 
                theme="snow" 
                value={content} 
                onChange={setContent}
                modules={quillModules}
                formats={quillFormats}
                style={{ direction: 'rtl' }}
                className="bg-white"
                readOnly={isSaving}
            />
          </div>

        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>ביטול</Button>
          <Button onClick={handleInternalSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
            שמור תבנית
          </Button>
        </CardFooter>
      </Card>
    );
}

function QuoteSettings({ isSaving, setIsSaving }) {
    const [isUploading, setIsUploading] = useState(false);
    const queryClient = useQueryClient();

    // React Query for app settings
    const { data: appSettings = [] } = useQuery({
        queryKey: ['appSettings'],
        queryFn: () => base44.entities.AppSettings.list(),
        staleTime: 10 * 60 * 1000,
        cacheTime: 30 * 60 * 1000
    });

    // Memoize settings map
    const settings = useMemo(() => {
        const settingsMap = appSettings.reduce((acc, item) => {
            acc[item.setting_key] = item.setting_value;
            return acc;
        }, {});

        return {
            quote_body_font_size: settingsMap.quote_body_font_size || '15',
            quote_title_font_size: settingsMap.quote_title_font_size || '16',
            quote_line_height: settingsMap.quote_line_height || '1.6',
            quote_background_image: settingsMap.quote_background_image || '',
            quote_intro_line_height: settingsMap.quote_intro_line_height || '1.6',
            quote_summary_line_height: settingsMap.quote_summary_line_height || '1.6',
            
            // New Settings
            quote_margin_top_mm: settingsMap.quote_margin_top_mm || '0',
            quote_margin_bottom_mm: settingsMap.quote_margin_bottom_mm || '0',
            quote_margin_left_mm: settingsMap.quote_margin_left_mm || '0',
            quote_margin_right_mm: settingsMap.quote_margin_right_mm || '0',
            
            quote_hide_logo: settingsMap.quote_hide_logo === 'true',
            quote_text_color: settingsMap.quote_text_color || '#333333',
            
            quote_event_details_font_size: settingsMap.quote_event_details_font_size || '15',
            quote_event_details_line_height: settingsMap.quote_event_details_line_height || '1.6',
            
            // quote_intro_font_size removed - now per template
            quote_summary_font_size: settingsMap.quote_summary_font_size || '15',

            // Footer settings
            quote_show_footer: settingsMap.quote_show_footer === 'true',
            quote_footer_text: settingsMap.quote_footer_text || '',
            };
            }, [appSettings]);

    const [localSettings, setLocalSettings] = useState(settings);

    useEffect(() => {
        setLocalSettings(settings);
    }, [settings]);

    const handleSettingChange = useCallback((key, value) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleFileUpload = useCallback(async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        setIsUploading(true);
        try {
            const response = await base44.integrations.Core.UploadFile({ file });
            if (response?.file_url) {
                setLocalSettings(prev => ({ ...prev, quote_background_image: response.file_url }));
            }
        } catch (error) {
            console.error("Failed to upload image:", error);
            alert("שגיאה בהעלאת התמונה");
        } finally {
            setIsUploading(false);
        }
    }, []);

    const handleSaveSettings = useCallback(async () => {
        setIsSaving(true);
        try {
            const currentSettingsList = await base44.entities.AppSettings.list();
            const currentSettingsMap = currentSettingsList.reduce((acc, s) => {
                acc[s.setting_key] = s;
                return acc;
            }, {});

            const updatePromises = Object.keys(localSettings).map(async (key) => {
                // Convert value to string as AppSettings.setting_value expects a string
                const value = localSettings[key] !== null && localSettings[key] !== undefined ? String(localSettings[key]) : '';
                const existingSetting = currentSettingsMap[key];

                if (existingSetting) {
                    if (existingSetting.setting_value !== value) {
                        return base44.entities.AppSettings.update(existingSetting.id, { setting_value: value });
                    }
                } else {
                    return base44.entities.AppSettings.create({
                        setting_key: key,
                        setting_value: value,
                        setting_type: 'string',
                        description: `Quote setting: ${key}`
                    });
                }
                return Promise.resolve();
            });

            await Promise.all(updatePromises);
            
            // Invalidate cache to refresh settings across the app
            queryClient.invalidateQueries({ queryKey: ['appSettings'] });
            
            alert("ההגדרות נשמרו בהצלחה");
        } catch (error) {
            console.error("Failed to save quote settings:", error);
            alert("שגיאה בשמירת ההגדרות");
        } finally {
            setIsSaving(false);
        }
    }, [localSettings, queryClient, setIsSaving]);
    
    return (
        <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
            <CardHeader>
                <CardTitle>הגדרות הצעת מחיר</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 max-h-[70vh] overflow-y-auto">
                
                {/* General Settings */}
                <div className="space-y-4 border p-4 rounded-lg bg-gray-50/50">
                    <h3 className="font-bold text-lg text-gray-800 border-b pb-2">הגדרות כלליות</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="quote_hide_logo"
                                checked={localSettings.quote_hide_logo}
                                onChange={(e) => handleSettingChange('quote_hide_logo', e.target.checked)}
                                className="h-4 w-4"
                            />
                            <Label htmlFor="quote_hide_logo">הסתר לוגו</Label>
                        </div>
                        <div>
                            <Label htmlFor="quote_text_color">צבע טקסט ראשי</Label>
                            <div className="flex gap-2">
                                <Input
                                    type="color"
                                    value={localSettings.quote_text_color}
                                    onChange={(e) => handleSettingChange('quote_text_color', e.target.value)}
                                    className="w-12 h-10 p-1"
                                />
                                <Input
                                    id="quote_text_color"
                                    value={localSettings.quote_text_color}
                                    onChange={(e) => handleSettingChange('quote_text_color', e.target.value)}
                                    placeholder="#333333"
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <Label>תמונת רקע</Label>
                        <div className="mt-2 flex items-center gap-4">
                            <Input
                                value={localSettings.quote_background_image}
                                onChange={(e) => handleSettingChange('quote_background_image', e.target.value)}
                                placeholder="הדבק URL או העלה קובץ"
                            />
                            <Input
                                type="file"
                                accept="image/*"
                                onChange={handleFileUpload}
                                disabled={isUploading}
                                className="hidden"
                                id="background-upload"
                            />
                            <Label htmlFor="background-upload" className="cursor-pointer">
                                <Button asChild variant="outline" disabled={isUploading}>
                                    <span>
                                        {isUploading ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <UploadCloud className="h-4 w-4 ml-2" />}
                                        העלה
                                    </span>
                                </Button>
                            </Label>
                        </div>
                        {localSettings.quote_background_image && (
                            <img src={localSettings.quote_background_image} alt="רקע" className="h-32 w-auto mt-2 rounded-lg object-cover border" />
                        )}
                    </div>
                </div>

                {/* Margins */}
                <div className="space-y-4 border p-4 rounded-lg bg-gray-50/50">
                    <h3 className="font-bold text-lg text-gray-800 border-b pb-2">שוליים (מילימטרים)</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <Label>עליון</Label>
                            <Input type="number" value={localSettings.quote_margin_top_mm} onChange={(e) => handleSettingChange('quote_margin_top_mm', e.target.value)} />
                        </div>
                        <div>
                            <Label>תחתון</Label>
                            <Input type="number" value={localSettings.quote_margin_bottom_mm} onChange={(e) => handleSettingChange('quote_margin_bottom_mm', e.target.value)} />
                        </div>
                        <div>
                            <Label>ימין</Label>
                            <Input type="number" value={localSettings.quote_margin_right_mm} onChange={(e) => handleSettingChange('quote_margin_right_mm', e.target.value)} />
                        </div>
                        <div>
                            <Label>שמאל</Label>
                            <Input type="number" value={localSettings.quote_margin_left_mm} onChange={(e) => handleSettingChange('quote_margin_left_mm', e.target.value)} />
                        </div>
                    </div>
                </div>

                {/* Typography & Spacing - Grouped by Section */}
                <div className="space-y-4 border p-4 rounded-lg bg-gray-50/50">
                    <h3 className="font-bold text-lg text-gray-800 border-b pb-2">טיפוגרפיה וריווח לפי מקטעים</h3>
                    
                    {/* General Body */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b pb-4">
                        <div className="md:col-span-1 font-semibold text-gray-700 flex items-center">טקסט כללי (גוף השירותים)</div>
                        <div>
                            <Label>גודל פונט (px)</Label>
                            <Input type="number" value={localSettings.quote_body_font_size} onChange={(e) => handleSettingChange('quote_body_font_size', e.target.value)} />
                        </div>
                        <div>
                            <Label>מרווח שורות</Label>
                            <Input type="number" step="0.1" value={localSettings.quote_line_height} onChange={(e) => handleSettingChange('quote_line_height', e.target.value)} />
                        </div>
                    </div>

                    {/* Titles */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b pb-4">
                        <div className="md:col-span-1 font-semibold text-gray-700 flex items-center">כותרות</div>
                        <div>
                            <Label>גודל פונט (px)</Label>
                            <Input type="number" value={localSettings.quote_title_font_size} onChange={(e) => handleSettingChange('quote_title_font_size', e.target.value)} />
                        </div>
                        <div className="text-xs text-gray-400 flex items-center">משפיע על כותרות הסעיפים ושמות החבילות</div>
                    </div>

                    {/* Event Details */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b pb-4">
                        <div className="md:col-span-1 font-semibold text-gray-700 flex items-center">פרטי המשפחה והאירוע</div>
                        <div>
                            <Label>גודל פונט (px)</Label>
                            <Input type="number" value={localSettings.quote_event_details_font_size} onChange={(e) => handleSettingChange('quote_event_details_font_size', e.target.value)} />
                        </div>
                        <div>
                            <Label>מרווח שורות</Label>
                            <Input type="number" step="0.1" value={localSettings.quote_event_details_line_height} onChange={(e) => handleSettingChange('quote_event_details_line_height', e.target.value)} />
                        </div>
                    </div>

                    {/* Intro */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b pb-4">
                        <div className="md:col-span-1 font-semibold text-gray-700 flex items-center">פתיח (קונספט)</div>
                        <div className="md:col-span-2 flex items-center text-sm text-gray-500 italic">
                            הגדרות גודל פונט ומרווח שורות עבור הפתיח נמצאות כעת בתוך עריכת כל פתיח בנפרד (בלשונית פתיחים).
                        </div>
                    </div>

                    {/* Summary Table */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="md:col-span-1 font-semibold text-gray-700 flex items-center">סיכום כספי ותנאי תשלום</div>
                            <div>
                                <Label>גודל פונט (px)</Label>
                                <Input type="number" value={localSettings.quote_summary_font_size} onChange={(e) => handleSettingChange('quote_summary_font_size', e.target.value)} />
                            </div>
                            <div>
                                <Label>מרווח שורות</Label>
                                <Input type="number" step="0.1" value={localSettings.quote_summary_line_height} onChange={(e) => handleSettingChange('quote_summary_line_height', e.target.value)} />
                            </div>
                        </div>
                    </div>

                    {/* Footer Settings */}
                    <div className="space-y-4 border p-4 rounded-lg bg-gray-50/50">
                        <h3 className="font-bold text-lg text-gray-800 border-b pb-2">כותרת תחתונה (Footer)</h3>
                        <div className="flex items-center gap-2 mb-4">
                            <input
                                type="checkbox"
                                id="quote_show_footer"
                                checked={localSettings.quote_show_footer}
                                onChange={(e) => handleSettingChange('quote_show_footer', e.target.checked)}
                                className="h-4 w-4"
                            />
                            <Label htmlFor="quote_show_footer">הצג כותרת תחתונה</Label>
                        </div>

                        {localSettings.quote_show_footer && (
                            <div>
                                <Label>טקסט כותרת תחתונה</Label>
                                <Input 
                                    value={localSettings.quote_footer_text} 
                                    onChange={(e) => handleSettingChange('quote_footer_text', e.target.value)} 
                                    placeholder="טקסט חופשי..."
                                />
                            </div>
                        )}
                    </div>

            </CardContent>
            <CardFooter>
                <Button onClick={handleSaveSettings} disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                    שמור הגדרות
                </Button>
            </CardFooter>
        </Card>
    );
}

export default function QuoteTemplateManagement() {
    const [editingTemplate, setEditingTemplate] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const queryClient = useQueryClient();

    // React Query for templates
    const { data: templates = [], isLoading: loading } = useQuery({
        queryKey: ['quoteTemplates'],
        queryFn: () => base44.entities.QuoteTemplate.list(),
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000
    });

    // React Query for events (to extract concepts)
    const { data: events = [] } = useQuery({
        queryKey: ['events'],
        queryFn: () => base44.entities.Event.list(),
        staleTime: 2 * 60 * 1000,
        cacheTime: 5 * 60 * 1000
    });

    // Memoize unique concepts
    const concepts = useMemo(() => {
        return [...new Set(events.map(e => e.concept).filter(Boolean))];
    }, [events]);

    const handleSave = useCallback(async (templateData) => {
        setIsSaving(true);
        try {
            if (templateData.id) {
                await base44.entities.QuoteTemplate.update(templateData.id, templateData);
            } else {
                await base44.entities.QuoteTemplate.create(templateData);
            }
            setEditingTemplate(null);
            
            // Invalidate cache to refresh templates
            queryClient.invalidateQueries({ queryKey: ['quoteTemplates'] });
        } catch (error) {
            console.error("Failed to save template:", error);
            alert("שגיאה בשמירת התבנית");
        } finally {
            setIsSaving(false);
        }
    }, [queryClient]);

    const handleDelete = useCallback(async (templateId) => {
        if (confirm("האם אתה בטוח שברצונך למחוק תבנית זו?")) {
            try {
                await base44.entities.QuoteTemplate.delete(templateId);
                
                // Invalidate cache to refresh templates
                queryClient.invalidateQueries({ queryKey: ['quoteTemplates'] });
            } catch (error) {
                console.error("Failed to delete template:", error);
                alert("שגיאה במחיקת התבנית");
            }
        }
    }, [queryClient]);

    const conceptIntroTemplates = useMemo(() => 
        templates.filter(t => t.template_type === 'concept_intro'),
        [templates]
    );

    const paymentTermsTemplates = useMemo(() => 
        templates.filter(t => t.template_type === 'payment_terms'),
        [templates]
    );

    if (loading) {
        return (
            <div className="flex justify-center items-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-white">ניהול תבניות הצעות מחיר</h1>
            </div>

            <Tabs defaultValue="settings" className="space-y-6">
                <TabsList className="bg-white/95 backdrop-blur-sm shadow-xl">
                    <TabsTrigger value="settings">הגדרות הצעה</TabsTrigger>
                    <TabsTrigger value="intro">פתיחים</TabsTrigger>
                    <TabsTrigger value="payment">תנאי תשלום</TabsTrigger>
                </TabsList>

                <TabsContent value="settings">
                    <QuoteSettings isSaving={isSaving} setIsSaving={setIsSaving} />
                </TabsContent>

                <TabsContent value="intro" className="space-y-6">
                    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                        <CardHeader>
                            <div className="flex justify-between items-center">
                                <CardTitle>תבניות פתיח לקונספטים</CardTitle>
                                <Button onClick={() => setEditingTemplate({ template_type: 'concept_intro', identifier: '', content: '' })}>
                                    <Plus className="h-4 w-4 ml-2" />
                                    פתיח חדש
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {conceptIntroTemplates.map(template => (
                                    <div key={template.id} className="flex items-center justify-between p-4 border rounded-lg">
                                        <div>
                                            <h3 className="font-medium">{template.identifier}</h3>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button variant="outline" size="sm" onClick={() => setEditingTemplate(template)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => handleDelete(template.id)} className="text-red-600">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                {conceptIntroTemplates.length === 0 && (
                                    <p className="text-center text-gray-500 py-4">אין פתיחים מוגדרים</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {editingTemplate && editingTemplate.template_type === 'concept_intro' && (
                        <TemplateEditor
                            template={editingTemplate}
                            onSave={handleSave}
                            onCancel={() => setEditingTemplate(null)}
                            concepts={concepts}
                            isSaving={isSaving}
                        />
                    )}
                </TabsContent>

                <TabsContent value="payment" className="space-y-6">
                    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                        <CardHeader>
                            <div className="flex justify-between items-center">
                                <CardTitle>תנאי תשלום</CardTitle>
                                {paymentTermsTemplates.length === 0 && (
                                    <Button onClick={() => setEditingTemplate({ template_type: 'payment_terms', identifier: 'default', content: '' })}>
                                        <Plus className="h-4 w-4 ml-2" />
                                        צור תנאי תשלום
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {paymentTermsTemplates.map(template => (
                                    <div key={template.id} className="flex items-center justify-between p-4 border rounded-lg">
                                        <div>
                                            <h3 className="font-medium">תנאי תשלום</h3>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button variant="outline" size="sm" onClick={() => setEditingTemplate(template)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => handleDelete(template.id)} className="text-red-600">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                {paymentTermsTemplates.length === 0 && (
                                    <p className="text-center text-gray-500 py-4">אין תנאי תשלום מוגדרים</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {editingTemplate && editingTemplate.template_type === 'payment_terms' && (
                        <TemplateEditor
                            template={editingTemplate}
                            onSave={handleSave}
                            onCancel={() => setEditingTemplate(null)}
                            concepts={concepts}
                            isSaving={isSaving}
                        />
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}