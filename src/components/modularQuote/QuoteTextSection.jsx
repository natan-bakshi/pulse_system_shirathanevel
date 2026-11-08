import React from 'react';
import RichTextEditor from '@/components/manualQuote/RichTextEditor';
import {useLanguage} from '@/i18n/LanguageProvider';
export default function QuoteTextSection({label,value,onChange,templates=[]}) {
  const {t,locale}=useLanguage();
  return <details className="border rounded-xl p-4"><summary className="cursor-pointer font-medium">{t(label)}</summary><div className="space-y-3 mt-4">{templates.length>0&&<select aria-label={locale==='en'?`Load ${t(label)} from template`:`טען ${label} מתבנית`} className="border rounded-md p-2 w-full bg-background" value="" onChange={e=>{const t=templates.find(t=>t.id===e.target.value);if(t)onChange(t.content||'');}}><option value="">{t("טען מתבנית קיימת")}</option>{templates.map(t=><option key={t.id} value={t.id}>{t.identifier==='default'?label:t.identifier}</option>)}</select>}<RichTextEditor value={value} onChange={onChange} minHeight={100}/></div></details>;
}