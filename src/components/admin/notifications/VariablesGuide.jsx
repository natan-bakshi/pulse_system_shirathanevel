import React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Variable } from "lucide-react";
import { toast } from "sonner";
import { AVAILABLE_VARIABLES } from "./constants";

// Popover עם רשימת המשתנים - מוצג ליד שדה טקסט
export default function VariablesGuide({ onInsert }) {
  const handleClick = (variable) => {
    const text = `{{${variable}}}`;
    if (onInsert) {
      onInsert(text);
    } else {
      navigator.clipboard.writeText(text);
      toast.success("הועתק", { description: `${text} הועתק ללוח` });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-blue-600 hover:bg-blue-50"
          title="הצג רשימת משתנים זמינים"
        >
          <Variable className="h-3.5 w-3.5 ml-1" />
          משתנים זמינים
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" side="top" align="end">
        <div className="space-y-2">
          <div>
            <h4 className="font-medium text-sm mb-1">משתנים זמינים</h4>
            <p className="text-xs text-gray-500">
              {onInsert ? 'לחץ על משתנה כדי להוסיפו לטקסט' : 'לחץ כדי להעתיק'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
            {Object.entries(AVAILABLE_VARIABLES).map(([key, info]) => (
              <TooltipProvider key={key}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => handleClick(key)}
                      className="flex items-center gap-1.5 p-1.5 bg-gray-100 rounded text-xs hover:bg-blue-100 transition-colors text-right"
                    >
                      <Copy className="h-3 w-3 shrink-0 text-gray-400" />
                      <span className="font-mono text-[11px] truncate">{`{{${key}}}`}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="font-medium text-xs">{info.description}</p>
                    <p className="text-[10px] text-gray-400">דוגמה: {info.example}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}