import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import ContactPicker from '@/components/ui/ContactPicker';
import { normalizeContact, parseContactSettings, stringifyContactSettings } from '@/lib/contactSettings';

const phoneToggles = [
  ['show_phone', 'הצג מספר'],
  ['allow_phone_copy', 'העתקה'],
  ['allow_phone_whatsapp', 'WhatsApp'],
  ['allow_phone_call', 'שיחה'],
];

const emailToggles = [
  ['show_email', 'הצג מייל'],
  ['allow_email_copy', 'העתקה'],
  ['allow_email_send', 'שליחת מייל'],
];

export default function ContactSettingsEditor({ value, onChange }) {
  const contacts = parseContactSettings(value);

  const updateContacts = (nextContacts) => onChange(stringifyContactSettings(nextContacts));
  const updateContact = (id, patch) => updateContacts(contacts.map(contact => contact.id === id ? { ...contact, ...patch } : contact));
  const addContact = () => updateContacts([...contacts, normalizeContact({ name: 'איש קשר חדש' })]);
  const addContactFromPhone = (contactData) => updateContacts([...contacts, normalizeContact({
    name: contactData.name || 'איש קשר חדש',
    phone: contactData.phone || '',
    email: contactData.email || '',
  })]);
  const deleteContact = (id) => updateContacts(contacts.filter(contact => contact.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">אנשי קשר שיופיעו ללקוחות וספקים</h3>
          <p className="text-xs text-gray-500">כל אייקון יוצג רק אם הופעל כאן וקיים עבורו מספר או מייל.</p>
        </div>
        <div className="flex items-center gap-2">
          <ContactPicker
            onContactSelect={addContactFromPhone}
            className="h-9 w-9 border border-red-200 text-red-800 hover:bg-red-50"
          />
          <Button type="button" variant="outline" onClick={addContact} className="border-red-200 text-red-800 hover:bg-red-50">
            <Plus className="h-4 w-4 ml-2" />הוסף איש קשר
          </Button>
        </div>
      </div>

      {contacts.length === 0 && <div className="rounded-lg border border-dashed p-4 text-center text-sm text-gray-500">לא הוגדרו אנשי קשר להצגה.</div>}

      {contacts.map((contact, index) => (
        <div key={contact.id} className="rounded-xl border bg-gray-50 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold text-gray-900">איש קשר {index + 1}</h4>
            <Button type="button" variant="ghost" size="icon" onClick={() => deleteContact(contact.id)} aria-label="מחק איש קשר" title="מחק איש קשר">
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`contact-name-${contact.id}`}>שם</Label>
              <Input id={`contact-name-${contact.id}`} value={contact.name} onChange={e => updateContact(contact.id, { name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`contact-role-${contact.id}`}>תפקיד / תיאור קצר</Label>
              <Input id={`contact-role-${contact.id}`} value={contact.role} onChange={e => updateContact(contact.id, { role: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`contact-phone-${contact.id}`}>מספר טלפון</Label>
              <Input id={`contact-phone-${contact.id}`} value={contact.phone} onChange={e => updateContact(contact.id, { phone: e.target.value })} dir="ltr" />
            </div>
            <div>
              <Label htmlFor={`contact-email-${contact.id}`}>מייל</Label>
              <Input id={`contact-email-${contact.id}`} value={contact.email} onChange={e => updateContact(contact.id, { email: e.target.value })} dir="ltr" />
            </div>
          </div>

          <ToggleGroup title="טלפון" items={phoneToggles} contact={contact} onChange={updateContact} />
          <ToggleGroup title="מייל" items={emailToggles} contact={contact} onChange={updateContact} />
        </div>
      ))}
    </div>
  );
}

function ToggleGroup({ title, items, contact, onChange }) {
  return (
    <div className="rounded-lg bg-white p-3 border">
      <p className="text-sm font-medium text-gray-800 mb-2">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <Label htmlFor={`${key}-${contact.id}`} className="text-xs">{label}</Label>
            <Switch id={`${key}-${contact.id}`} checked={contact[key] !== false} onCheckedChange={checked => onChange(contact.id, { [key]: checked })} />
          </div>
        ))}
      </div>
    </div>
  );
}