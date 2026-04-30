import React from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Pencil, Trash2, Clock, Zap, Cog } from "lucide-react";
import { TRIGGER_TYPES, AUDIENCES, TIMING_UNITS } from "./constants";
import { getSystemTemplateInfo } from "./systemTemplatesInfo";

// כרטיס תבנית התראה בודדת - מציג את הפרטים החשובים וכפתורי פעולה
export default function NotificationTemplateCard({ 
  template, 
  onEdit, 
  onDelete, 
  onToggleActive, 
  onManualTrigger 
}) {
  const canManualTrigger = ['scheduled_check', 'event_status_change'].includes(template.trigger_type);
  const systemInfo = getSystemTemplateInfo(template.type);

  return (
    <div 
      className={`flex items-center justify-between p-3 rounded-lg border ${
        template.is_active ? 'bg-white' : 'bg-gray-50 opacity-60'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{template.name}</span>
          {template.allowed_channels?.includes('push') && (
            <Badge variant="outline" className="text-xs border-blue-200 text-blue-700 bg-blue-50">
              Push
            </Badge>
          )}
          {template.allowed_channels?.includes('whatsapp') && (
            <Badge variant="outline" className="text-xs border-green-200 text-green-700 bg-green-50">
              WhatsApp
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {TRIGGER_TYPES[template.trigger_type]?.label || template.trigger_type}
          </Badge>
          {systemInfo && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs border-purple-200 text-purple-700 bg-purple-50 flex items-center gap-1 cursor-help">
                    <Cog className="h-3 w-3" />
                    תבנית מערכת
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="text-xs space-y-1">
                    <p className="font-semibold">{systemInfo.handler} • {systemInfo.phase}</p>
                    <p className="text-gray-300">{systemInfo.frequency}</p>
                    <p>{systemInfo.description}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
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
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 mr-4">
        <Switch
          checked={template.is_active}
          onCheckedChange={(checked) => onToggleActive(template.id, checked)}
        />
        {canManualTrigger && (
          <Button
            variant="ghost"
            size="icon"
            title="הפעל ידנית עכשיו"
            onClick={() => onManualTrigger(template)}
          >
            <Zap className="h-4 w-4 text-amber-500" />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => onEdit(template)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => {
            if (confirm('האם למחוק את תבנית ההתראה?')) {
              onDelete(template.id);
            }
          }}
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      </div>
    </div>
  );
}