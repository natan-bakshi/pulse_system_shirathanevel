import React from 'react';
import { Copy, Mail, MessageCircle, Phone } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import ContactActionButton from '@/components/contact/ContactActionButton';
import { getTelLink, getWhatsAppLink } from '@/lib/contactSettings';

export default function ContactCard({ contact }) {
  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} הועתק` });
    } catch {
      toast({ title: 'לא ניתן להעתיק', description: 'אפשר לסמן ולהעתיק ידנית.' });
    }
  };

  const showPhone = contact.phone && contact.show_phone;
  const showEmail = contact.email && contact.show_email;

  return (
    <div className="rounded-xl border border-gray-200 bg-white/95 p-4 shadow-sm">
      <div className="mb-3 min-w-0">
        <h3 className="text-base font-semibold text-gray-900 break-words">{contact.name || 'איש קשר'}</h3>
        {contact.role && <p className="text-sm text-gray-500 break-words">{contact.role}</p>}
      </div>

      <div className="space-y-3">
        {showPhone && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
            <span className="text-sm text-gray-800 break-all" dir="ltr">{contact.phone}</span>
            <div className="flex items-center gap-1 shrink-0">
              {contact.allow_phone_copy && <ContactActionButton icon={Copy} label="העתק מספר" onClick={() => copyText(contact.phone, 'המספר')} />}
              {contact.allow_phone_whatsapp && <ContactActionButton icon={MessageCircle} label="פתח WhatsApp" href={getWhatsAppLink(contact.phone)} className="text-green-600" />}
              {contact.allow_phone_call && <ContactActionButton icon={Phone} label="התקשר" href={getTelLink(contact.phone)} className="text-blue-700" />}
            </div>
          </div>
        )}

        {showEmail && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
            <span className="text-sm text-gray-800 break-all" dir="ltr">{contact.email}</span>
            <div className="flex items-center gap-1 shrink-0">
              {contact.allow_email_copy && <ContactActionButton icon={Copy} label="העתק מייל" onClick={() => copyText(contact.email, 'המייל')} />}
              {contact.allow_email_send && <ContactActionButton icon={Mail} label="שלח מייל" href={`mailto:${contact.email}`} className="text-red-800" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}