import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Bell } from "lucide-react";
import NotificationTemplateCard from "./NotificationTemplateCard";
import { CATEGORIES } from "./constants";

// סקירה כללית של כל התבניות - מקובצות לפי קטגוריה
export default function NotificationTemplatesOverview({ 
  templates, 
  isLoading, 
  onEdit, 
  onDelete, 
  onToggleActive, 
  onManualTrigger 
}) {
  // קיבוץ לפי קטגוריה
  const groupedTemplates = templates.reduce((acc, t) => {
    const cat = t.category || 'system';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardContent className="py-8 text-center text-gray-500">
          <Bell className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>אין תבניות התראה. לחץ על "תבנית חדשה" ליצירת תבנית ראשונה.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
        <Card key={category} className="bg-white/95 backdrop-blur-sm shadow-xl border-r-4 border-r-blue-500">
          <CardHeader className="py-3">
            <CardTitle className="text-base">
              {CATEGORIES[category] || category}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {categoryTemplates.map((template) => (
                <NotificationTemplateCard
                  key={template.id}
                  template={template}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggleActive={onToggleActive}
                  onManualTrigger={onManualTrigger}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}