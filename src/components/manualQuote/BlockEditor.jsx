import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { GripVertical, Trash2, ChevronUp, ChevronDown, Info } from 'lucide-react';
import RichTextEditor from './RichTextEditor';
import { BLOCK_TYPES, BLOCK_LABELS } from './blockTypes';

/**
 * עורך בלוק יחיד בהצעה הידנית.
 * רכיבים שתלויים באירוע (פרטי אירוע / שירותים / סיכום כספי) מציגים תצוגה מקדימה אינפורמטיבית בלבד —
 * התוכן עצמו נבנה בצד השרת בעת ייצוא PDF.
 */
export default function BlockEditor({ block, index, total, onChange, onRemove, onMoveUp, onMoveDown, linkedEventId, templates }) {
  const update = (patch) => onChange({ ...block, ...patch });
  const updateOptions = (patch) => onChange({ ...block, options: { ...(block.options || {}), ...patch } });

  const introTemplates = (templates || []).filter(t => t.template_type === 'concept_intro');
  const paymentTemplates = (templates || []).filter(t => t.template_type === 'payment_terms');
  const agreementTemplates = (templates || []).filter(t => t.template_type === 'agreement_disclaimer');

  const renderEditor = () => {
    switch (block.type) {
      case BLOCK_TYPES.FREE_TEXT:
        return (
          <RichTextEditor
            value={block.content || ''}
            onChange={(html) => update({ content: html })}
            minHeight={150}
          />
        );

      case BLOCK_TYPES.HEADING:
        return (
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <Select value={String(block.options?.level || 2)} onValueChange={(v) => updateOptions({ level: parseInt(v, 10) })}>
                <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">כותרת 1 (גדולה)</SelectItem>
                  <SelectItem value="2">כותרת 2</SelectItem>
                  <SelectItem value="3">כותרת 3</SelectItem>
                  <SelectItem value="4">כותרת 4</SelectItem>
                </SelectContent>
              </Select>
              <Select value={block.options?.align || 'center'} onValueChange={(v) => updateOptions({ align: v })}>
                <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="right">ישור לימין</SelectItem>
                  <SelectItem value="center">מרכז</SelectItem>
                  <SelectItem value="left">ישור לשמאל</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              value={block.content || ''}
              onChange={(e) => update({ content: e.target.value })}
              placeholder="כותרת..."
              className="text-lg font-bold"
            />
          </div>
        );

      case BLOCK_TYPES.EVENT_DETAILS:
        if (!linkedEventId) {
          return <NotLinkedNotice />;
        }
        return (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">בחר אילו פרטים מהאירוע המשויך יוצגו:</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['showFamilyName', 'שם משפחה'],
                ['showChildName', 'שם ילד/ה'],
                ['showDate', 'תאריך'],
                ['showLocation', 'מיקום'],
                ['showCity', 'עיר'],
                ['showGuestCount', 'כמות אורחים'],
                ['showParents', 'שמות הורים']
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={block.options?.[key] !== false}
                    onCheckedChange={(v) => updateOptions({ [key]: !!v })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        );

      case BLOCK_TYPES.INTRO_TEMPLATE:
        return (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={block.options?.useEventConcept !== false}
                onCheckedChange={(v) => updateOptions({ useEventConcept: !!v })}
                disabled={!linkedEventId}
              />
              <span>השתמש אוטומטית בקונספט של האירוע המשויך</span>
            </label>
            {(!block.options?.useEventConcept || !linkedEventId) && (
              <div>
                <Label className="text-xs">בחר תבנית פתיח ידנית:</Label>
                <Select value={block.options?.templateId || '__none__'} onValueChange={(v) => updateOptions({ templateId: v === '__none__' ? '' : v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="בחר פתיח..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— ללא —</SelectItem>
                    {introTemplates.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.identifier}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        );

      case BLOCK_TYPES.SERVICES:
        if (!linkedEventId) return <NotLinkedNotice />;
        return (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">תצוגת רשימת שירותים וחבילות מתוך האירוע המשויך:</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['showPrices', 'הצג מחירים'],
                ['showDescriptions', 'הצג תיאורים'],
                ['showQuantities', 'הצג כמויות']
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={block.options?.[key] !== false}
                    onCheckedChange={(v) => updateOptions({ [key]: !!v })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        );

      case BLOCK_TYPES.FINANCIAL_SUMMARY:
        if (!linkedEventId) return <NotLinkedNotice />;
        return (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">סיכום כספי מהאירוע המשויך:</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['showVat', 'הצג מע"מ'],
                ['showDiscount', 'הצג הנחה'],
                ['showPaid', 'הצג תשלומים'],
                ['showBalance', 'הצג יתרה']
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={block.options?.[key] !== false}
                    onCheckedChange={(v) => updateOptions({ [key]: !!v })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        );

      case BLOCK_TYPES.PAYMENT_TERMS:
        return (
          <div>
            <Label className="text-xs">בחר תבנית תנאי תשלום:</Label>
            <Select value={block.options?.templateId || '__default__'} onValueChange={(v) => updateOptions({ templateId: v === '__default__' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">תבנית ברירת מחדל</SelectItem>
                {paymentTemplates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.identifier}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case BLOCK_TYPES.AGREEMENT_DISCLAIMER:
        return (
          <div>
            <Label className="text-xs">בחר תבנית תנאי התקשרות:</Label>
            <Select value={block.options?.templateId || '__default__'} onValueChange={(v) => updateOptions({ templateId: v === '__default__' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">תבנית ברירת מחדל</SelectItem>
                {agreementTemplates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.identifier}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case BLOCK_TYPES.SPACER:
        return (
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <Label className="text-xs">גובה (px)</Label>
              <Input
                type="number"
                min="0"
                max="200"
                value={block.options?.height || 20}
                onChange={(e) => updateOptions({ height: parseInt(e.target.value, 10) || 0 })}
                className="h-9 w-24"
              />
            </div>
            <label className="flex items-center gap-2 text-sm pt-5">
              <Checkbox
                checked={!!block.options?.showLine}
                onCheckedChange={(v) => updateOptions({ showLine: !!v })}
              />
              <span>קו מפריד</span>
            </label>
          </div>
        );

      default:
        return <div className="text-sm text-gray-500">סוג בלוק לא נתמך</div>;
    }
  };

  return (
    <Card className="bg-white border-2 border-gray-100 hover:border-gray-200 transition">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 pb-2 border-b">
          <div className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-gray-400" />
            <Badge variant="secondary" className="text-xs">{BLOCK_LABELS[block.type] || block.type}</Badge>
            <span className="text-xs text-gray-400">#{index + 1}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveUp} disabled={index === 0}>
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveDown} disabled={index === total - 1}>
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-600 hover:bg-red-50" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {renderEditor()}
      </CardContent>
    </Card>
  );
}

function NotLinkedNotice() {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        קטע זה דורש אירוע משויך. שייך אירוע בראש העמוד כדי שהתוכן יומשך מהאירוע אוטומטית בעת ייצוא ה-PDF.
      </div>
    </div>
  );
}