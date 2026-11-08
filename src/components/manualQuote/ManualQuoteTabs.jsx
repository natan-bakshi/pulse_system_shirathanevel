import React from 'react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import ManualQuotesList from '@/components/manualQuote/ManualQuotesList';
import ModularQuotesTab from '@/components/modularQuote/ModularQuotesTab';
import {useLanguage} from '@/i18n/LanguageProvider';
export default function ManualQuoteTabs() {
  const {t,dir}=useLanguage();
  return <Tabs defaultValue="regular" dir={dir} className="space-y-4 min-w-0"><TabsList className="grid grid-cols-2 w-full bg-card"><TabsTrigger value="regular" className="min-w-0 text-sm">{t('ידניות רגילות')}</TabsTrigger><TabsTrigger value="modular" className="min-w-0 text-sm">{t('מודולריות')}</TabsTrigger></TabsList><TabsContent value="regular"><ManualQuotesList/></TabsContent><TabsContent value="modular"><ModularQuotesTab/></TabsContent></Tabs>;
}