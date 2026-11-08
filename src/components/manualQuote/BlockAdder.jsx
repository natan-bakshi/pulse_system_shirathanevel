import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus } from 'lucide-react';
import { BLOCK_TYPES, BLOCK_LABELS, BLOCK_DESCRIPTIONS, createBlock } from './blockTypes';
import {useLanguage} from '@/i18n/LanguageProvider';

const ALL_TYPES = [
  BLOCK_TYPES.FREE_TEXT,
  BLOCK_TYPES.HEADING,
  BLOCK_TYPES.EVENT_DETAILS,
  BLOCK_TYPES.INTRO_TEMPLATE,
  BLOCK_TYPES.SERVICES,
  BLOCK_TYPES.FINANCIAL_SUMMARY,
  BLOCK_TYPES.SCHEDULE,
  BLOCK_TYPES.PAYMENT_TERMS,
  BLOCK_TYPES.AGREEMENT_DISCLAIMER,
  BLOCK_TYPES.SPACER
];

export default function BlockAdder({ onAdd, label = 'הוסף קטע', size = 'sm', variant = 'outline' }) {
  const {t,dir}=useLanguage();
  const [open, setOpen] = useState(false);

  const handlePick = (type) => {
    onAdd(createBlock(type));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant={variant} size={size} className="gap-1">
          <Plus className="h-4 w-4" /> {t(label)}
        </Button>
      </PopoverTrigger>
      <PopoverContent dir={dir} className="w-72 p-2">
        <div className="text-xs font-semibold text-gray-500 px-2 py-1 mb-1 border-b">{t('בחר סוג קטע')}</div>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {ALL_TYPES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => handlePick(t)}
              className="w-full text-start p-2 rounded hover:bg-gray-100 transition"
            >
              <div className="text-sm font-medium">{t(BLOCK_LABELS[t])}</div>
              <div className="text-xs text-gray-500">{t(BLOCK_DESCRIPTIONS[t])}</div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}