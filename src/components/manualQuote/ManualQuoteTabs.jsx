import React from 'react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import ManualQuotesList from '@/components/manualQuote/ManualQuotesList';
import ModularQuotesTab from '@/components/modularQuote/ModularQuotesTab';
export default function ManualQuoteTabs() {
  return <Tabs defaultValue="regular" dir="rtl" className="space-y-4 min-w-0"><TabsList className="grid grid-cols-2 w-full bg-card"><TabsTrigger value="regular" className="min-w-0 text-sm">ידניות רגילות</TabsTrigger><TabsTrigger value="modular" className="min-w-0 text-sm">מודולריות</TabsTrigger></TabsList><TabsContent value="regular"><ManualQuotesList/></TabsContent><TabsContent value="modular"><ModularQuotesTab/></TabsContent></Tabs>;
}