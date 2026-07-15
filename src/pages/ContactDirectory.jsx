import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, PhoneCall } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ContactCard from '@/components/contact/ContactCard';
import { parseContactSettings } from '@/lib/contactSettings';

export default function ContactDirectory() {
  const { data: appSettings = [], isLoading } = useQuery({
    queryKey: ['appSettings'],
    queryFn: () => base44.entities.AppSettings.list(),
    staleTime: 10 * 60 * 1000,
    cacheTime: 30 * 60 * 1000,
  });

  const settingsMap = appSettings.reduce((acc, setting) => {
    acc[setting.setting_key] = setting.setting_value;
    return acc;
  }, {});
  const contacts = parseContactSettings(settingsMap.contact_entries);

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-white">
        <PhoneCall className="h-6 w-6" />
        <h1 className="text-2xl font-bold">צור קשר</h1>
      </div>

      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardHeader>
          <CardTitle className="text-lg">משרד ומנהלים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">לא הוגדרו אנשי קשר זמינים.</div>
          ) : (
            contacts.map(contact => <ContactCard key={contact.id} contact={contact} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}