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
import EnglishDraftButton from '@/i18n/EnglishDraftButton';
import {useLanguage} from '@/i18n/LanguageProvider';

/**
 * עורך בלוק יחיד בהצעה הידנית.
 * רכיבים שתלויים באירוע (פרטי אירוע / שירותים / סיכום כספי) מציגים תצוגה מקדימה אינפורמטיבית בלבד —
 * התוכן עצמו נבנה בצד השרת בעת ייצוא PDF.
 */
export default function BlockEditor({ block, index, total, onChange, onRemove, onMoveUp, onMoveDown, linkedEventId, templates, linkedEvent, documentLanguage='he' }) {
  const {t: uiTranslate}=useLanguage();
  const {t,locale}=useLanguage();
  const update = (patch) => onChange({ ...block, ...patch });
  const updateOptions = (patch) => onChange({ ...block, options: { ...(block.options || {}), ...patch } });
  const updateEnglish=(key,source,value)=>onChange({...block,english:{...block.english,[key]:{source,value}}});
  const englishKey=block.type===BLOCK_TYPES.HEADING||block.type===BLOCK_TYPES.FREE_TEXT
    ?'content':(['intro_template','payment_terms','agreement_disclaimer'].includes(block.type)&&block.options?.useCustomContent?'customContent':null);
  const englishSource=englishKey==='customContent'?block.options?.customContent:block.content;

  const introTemplates = (templates || []).filter(t => t.template_type === 'concept_intro');
  const paymentTemplates = (templates || []).filter(t => t.template_type === 'payment_terms');
  const agreementTemplates = (templates || []).filter(t => t.template_type === 'agreement_disclaimer');

  // מחשב את התוכן הנוכחי של התבנית הרלוונטית עבור הבלוק — משמש כברירת מחדל בעת הפעלת
  // האופציה "ערוך טקסט מותאם", כדי שהמשתמש יראה את הטקסט הקיים של התבנית ויוכל לערוך/למחוק אותו.
  const getCurrentTemplateContent = () => {
    if (block.type === BLOCK_TYPES.INTRO_TEMPLATE) {
      // אם משתמשים בקונספט של האירוע — חפש תבנית מתאימה לפי identifier=concept
      if (block.options?.useEventConcept && linkedEvent?.concept) {
        const t = introTemplates.find(tpl => tpl.identifier === linkedEvent.concept);
        return t?.content || '';
      }
      // אחרת — לפי בחירה ידנית
      const id = block.options?.templateId;
      if (id) {
        const t = introTemplates.find(tpl => tpl.id === id);
        return t?.content || '';
      }
      return '';
    }
    if (block.type === BLOCK_TYPES.PAYMENT_TERMS) {
      const id = block.options?.templateId;
      const t = id
        ? paymentTemplates.find(tpl => tpl.id === id)
        : paymentTemplates.find(tpl => tpl.identifier === 'default');
      return t?.content || '';
    }
    if (block.type === BLOCK_TYPES.AGREEMENT_DISCLAIMER) {
      const id = block.options?.templateId;
      const t = id
        ? agreementTemplates.find(tpl => tpl.id === id)
        : agreementTemplates.find(tpl => tpl.identifier === 'default');
      return t?.content || '';
    }
    return '';
  };

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
                  <SelectItem value="1">{t('כותרת 1 (גדולה)')}</SelectItem>
                  <SelectItem value="2">{t('כותרת 2')}</SelectItem>
                  <SelectItem value="3">{t('כותרת 3')}</SelectItem>
                  <SelectItem value="4">{t('כותרת 4')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={block.options?.align || 'center'} onValueChange={(v) => updateOptions({ align: v })}>
                <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="right">{t('ישור לימין')}</SelectItem>
                  <SelectItem value="center">{t('מרכז')}</SelectItem>
                  <SelectItem value="left">{t('ישור לשמאל')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              value={block.content || ''}
              onChange={(e) => update({ content: e.target.value })}
              placeholder={t("כותרת...")}
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
            <div className="text-xs text-gray-600">{t('בחר אילו פרטים מהאירוע המשויך יוצגו:')}</div>
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
                  <span>{t(label)}</span>
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
              <span>{t('השתמש אוטומטית בקונספט של האירוע המשויך')}</span>
            </label>
            {(!block.options?.useEventConcept || !linkedEventId) && (
              <div>
                <Label className="text-xs">{t('בחר תבנית פתיח ידנית:')}</Label>
                <Select value={block.options?.templateId || '__none__'} onValueChange={(v) => updateOptions({ templateId: v === '__none__' ? '' : v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={t("בחר פתיח...")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('— ללא —')}</SelectItem>
                    {introTemplates.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.identifier}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <CustomContentToggle
              block={block}
              updateOptions={updateOptions}
              label={uiTranslate("ערוך טקסט פתיח רק עבור הצעה זו (לא משנה את התבנית הגלובלית)")}
              placeholder={uiTranslate("טקסט פתיח מותאם להצעה זו...")}
              defaultContent={getCurrentTemplateContent()}
            />
          </div>
        );

      case BLOCK_TYPES.SERVICES:
        if (!linkedEventId) return <NotLinkedNotice />;
        return (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">{t('תצוגת רשימת שירותים וחבילות מתוך האירוע המשויך:')}</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['showPrices', 'הצג מחירים'],
                ['showDescriptions', 'הצג תיאורים'],
                ['showQuantities', 'הצג כמויות'],
                ['showClientNotes', 'הצג הערות ללקוח'],
                ['showTransportDetails', 'הצג פרטי נסיעה / איש קשר']
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={block.options?.[key] !== false}
                    onCheckedChange={(v) => updateOptions({ [key]: !!v })}
                  />
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </div>
        );

      case BLOCK_TYPES.FINANCIAL_SUMMARY:
        if (!linkedEventId) return <NotLinkedNotice />;
        return (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">{t('סיכום כספי מהאירוע המשויך:')}</div>
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
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </div>
        );

      case BLOCK_TYPES.SCHEDULE:
        if (!linkedEventId) return <NotLinkedNotice />;
        return (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">{t('לוח הזמנים יוצג מתוך האירוע המשויך (אם קיים).')}</div>
          </div>
        );

      case BLOCK_TYPES.PAYMENT_TERMS:
        return (
          <div className="space-y-2">
            <Label className="text-xs">{t('בחר תבנית תנאי תשלום:')}</Label>
            <Select value={block.options?.templateId || '__default__'} onValueChange={(v) => updateOptions({ templateId: v === '__default__' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">{t('תבנית ברירת מחדל')}</SelectItem>
                {paymentTemplates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.identifier}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CustomContentToggle
              block={block}
              updateOptions={updateOptions}
              label={uiTranslate("ערוך תנאי תשלום רק עבור הצעה זו (לא משנה את התבנית הגלובלית)")}
              placeholder={uiTranslate("תנאי תשלום מותאמים להצעה זו...")}
              defaultContent={getCurrentTemplateContent()}
            />
          </div>
        );

      case BLOCK_TYPES.AGREEMENT_DISCLAIMER:
        return (
          <div className="space-y-2">
            <Label className="text-xs">{t('בחר תבנית תנאי התקשרות:')}</Label>
            <Select value={block.options?.templateId || '__default__'} onValueChange={(v) => updateOptions({ templateId: v === '__default__' ? '' : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">{t('תבנית ברירת מחדל')}</SelectItem>
                {agreementTemplates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.identifier}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CustomContentToggle
              block={block}
              updateOptions={updateOptions}
              label={uiTranslate("ערוך תנאי התקשרות רק עבור הצעה זו (לא משנה את התבנית הגלובלית)")}
              placeholder={uiTranslate("תנאי התקשרות מותאמים להצעה זו...")}
              defaultContent={getCurrentTemplateContent()}
            />
          </div>
        );

      case BLOCK_TYPES.SPACER:
        return (
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <Label className="text-xs">{t('גובה (px)')}</Label>
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
              <span>{t('קו מפריד')}</span>
            </label>
          </div>
        );

      default:
        return <div className="text-sm text-gray-500">{t('סוג בלוק לא נתמך')}</div>;
    }
  };

  return (
    <Card className="bg-white border-2 border-gray-100 hover:border-gray-200 transition">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 pb-2 border-b">
          <div className="flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-gray-400" />
            <Badge variant="secondary" className="text-xs">{t(BLOCK_LABELS[block.type] || block.type)}</Badge>
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
        {documentLanguage==='en'&&englishKey&&!!englishSource?.trim()&&(
          <details className="border rounded-lg p-3 mt-3">
            <summary className="font-medium text-sm cursor-pointer">English wording for this section</summary>
            <p className="text-xs text-gray-500 mt-2">Translate the custom text only. The original Hebrew is retained; changes require an updated English version.</p>
            {englishKey==='content'&&block.type===BLOCK_TYPES.HEADING?
              <Input dir="ltr" lang="en" className="mt-3" value={block.english?.content?.value||''}
                onChange={e=>updateEnglish('content',englishSource,e.target.value)}/>:
              <div dir="ltr" className="mt-3"><RichTextEditor value={block.english?.[englishKey]?.value||''}
                onChange={value=>updateEnglish(englishKey,englishSource,value)} minHeight={110}/></div>}
            <EnglishDraftButton source={englishSource} kind={block.type===BLOCK_TYPES.HEADING?'custom_title':block.type===BLOCK_TYPES.FREE_TEXT?'quote_notes':'quote_terms'}
              onDraft={value=>updateEnglish(englishKey,englishSource,value)} compact />
            {block.english?.[englishKey]?.value&&block.english[englishKey].source!==englishSource&&
              <p className="text-xs text-amber-700 mt-2">Hebrew text changed. The previous English translation must be reviewed.</p>}
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function NotLinkedNotice() {
  const {t}=useLanguage();
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        {t('קטע זה דורש אירוע משויך. שייך אירוע בראש העמוד כדי שהתוכן יומשך מהאירוע אוטומטית בעת ייצוא ה-PDF.')}
      </div>
    </div>
  );
}

/**
 * רכיב משותף — מאפשר לדרוס את תוכן התבניות (פתיח / תנאי תשלום / תנאי התקשרות)
 * עבור הצעה זו בלבד, מבלי לשנות את התבנית הגלובלית.
 *
 * defaultContent: תוכן ה-HTML של התבנית הקיימת — נטען לעורך כברירת מחדל בעת
 * הפעלת האופציה (אם אין עדיין customContent שמור), כדי שהמשתמש יראה את הטקסט
 * הנוכחי בעיצובו ויוכל לערוך/לשנות/למחוק אותו.
 */
function CustomContentToggle({ block, updateOptions, label, placeholder, defaultContent = '' }) {
  const {t}=useLanguage();
  const useCustom = !!block.options?.useCustomContent;

  const handleToggle = (v) => {
    const enabled = !!v;
    const patch = { useCustomContent: enabled };
    // בעת הפעלה ראשונית — אם אין תוכן מותאם שמור, טען את תוכן התבנית הנוכחית
    if (enabled && !block.options?.customContent && defaultContent) {
      patch.customContent = defaultContent;
    }
    updateOptions(patch);
  };

  return (
    <div className="pt-2 mt-2 border-t border-dashed border-gray-200 space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={useCustom}
          onCheckedChange={handleToggle}
        />
        <span>{t(label)}</span>
      </label>
      {useCustom && (
        <RichTextEditor
          value={block.options?.customContent || ''}
          onChange={(html) => updateOptions({ customContent: html })}
          minHeight={140}
          placeholder={t(placeholder)}
        />
      )}
    </div>
  );
}