import React from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {toast} from 'sonner';
import QuoteWhatsAppButton from '@/components/modularQuote/QuoteWhatsAppButton';
import {useLanguage} from '@/i18n/LanguageProvider';
export default function QuoteShareLinks({link,pdf,file}) {
  const {t}=useLanguage();
  async function copy(){try{await navigator.clipboard.writeText(link);toast.success(t('הקישור הועתק'));}catch{toast.error(t('ניתן לסמן ולהעתיק את הקישור מהשדה'));}}
  return <div className="space-y-3">{link&&<div className="rounded-lg border p-3 space-y-2"><label htmlFor="modular-share-url" className="text-sm font-medium">{t('קישור ללקוח — כל מי שמחזיק בו יכול לצפות בהצעה')}</label><Input id="modular-share-url" dir="ltr" value={link} readOnly onFocus={e=>e.target.select()}/><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={copy}>{t('העתק קישור')}</Button><Button variant="outline" asChild><a href={link} target="_blank" rel="noreferrer">{t('פתח קישור')}</a></Button><Button variant="outline" asChild><a href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank" rel="noreferrer">{t('שתף בוואטסאפ')}</a></Button></div></div>}{pdf&&<div className="rounded-lg border p-3"><Button asChild><a href={pdf} target="_blank" rel="noreferrer" download>{t('פתח / הורד PDF')}</a></Button></div>}{file?.uri&&<QuoteWhatsAppButton file={file}/>}</div>;
}