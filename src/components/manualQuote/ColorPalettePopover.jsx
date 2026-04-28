import React, { useRef } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * פלטת צבעים שתואמת את צבעי ההצעה הרגילה (generateQuotePdf).
 * נותנת גישה מהירה לצבעי המערכת + בחירת צבע מותאם אישית.
 */
const DEFAULT_COLORS = [
  { value: '#8B0000', label: 'אדום מערכת (כותרות)' },
  { value: '#DAA520', label: 'זהב (קווים מפרידים)' },
  { value: '#333333', label: 'טקסט ראשי' },
  { value: '#555555', label: 'טקסט משני' },
  { value: '#666666', label: 'טקסט אפור בהיר' },
  { value: '#777777', label: 'אפור בהיר מאוד' },
  { value: '#1f2937', label: 'אפור כהה' },
  { value: '#6b7280', label: 'אפור בינוני' },
  { value: '#ef4444', label: 'אדום הנחה' },
  { value: '#2563eb', label: 'כחול קישורים' },
  { value: '#1e40af', label: 'כחול נסיעות' },
  { value: '#9ca3af', label: 'אפור הערות' },
  { value: '#000000', label: 'שחור' },
  { value: '#ffffff', label: 'לבן' },
];

export default function ColorPalettePopover({ icon, tooltip, active = false, onPickColor, onClear }) {
  const customInputRef = useRef(null);

  const handlePick = (color) => {
    onPickColor?.(color);
  };

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant={active ? 'default' : 'ghost'}
                size="sm"
                className="h-8 w-8 p-0"
              >
                {icon}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent dir="rtl" className="w-56 p-2" align="start">
        <div className="text-xs font-semibold text-gray-600 px-1 pb-2 border-b mb-2">צבעי המערכת</div>
        <div className="grid grid-cols-7 gap-1.5">
          {DEFAULT_COLORS.map(c => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              onClick={() => handlePick(c.value)}
              className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
        <div className="mt-2 pt-2 border-t flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs flex-1"
            onClick={() => customInputRef.current?.click()}
          >
            צבע מותאם...
          </Button>
          <input
            ref={customInputRef}
            type="color"
            className="absolute opacity-0 w-0 h-0"
            onChange={(e) => handlePick(e.target.value)}
          />
          {onClear && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onClear}
            >
              נקה
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}