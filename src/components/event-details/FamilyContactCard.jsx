import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Edit, Trash2, Plus, Save, Loader2 } from 'lucide-react';
import PhoneNumber from '../ui/PhoneNumber';
import EmailAddress from '../ui/EmailAddress';
import ContactPicker from '../ui/ContactPicker';
import { base44 } from '@/api/base44Client';

export default function FamilyContactCard({
  event,
  isAdmin,
  isClient,
  editingSection,
  setEditingSection,
  editableParents,
  setEditableParents,
  editableFamilyName,
  setEditableFamilyName,
  editableChildName,
  setEditableChildName,
  handleSaveFamilyDetails,
  isSavingFamilyDetails
}) {
  const [contactsConfig, setContactsConfig] = useState(null);
  const [editableOrgContacts, setEditableOrgContacts] = useState([]);

  useEffect(() => {
    if (!event?.organizer_type) { setContactsConfig(null); return; }
    base44.entities.QuoteOrganizerType.filter({ type_name: event.organizer_type }).then(types => {
      const match = types.find(t => t.is_active !== false);
      if (match?.contacts_config) {
        try { setContactsConfig(JSON.parse(match.contacts_config)); } catch { setContactsConfig(null); }
      } else { setContactsConfig(null); }
    }).catch(() => setContactsConfig(null));
  }, [event?.organizer_type]);

  const orgContacts = (() => {
    try { return JSON.parse(event?.organizer_contacts || '[]'); } catch { return []; }
  })();

  const cLabel = contactsConfig?.label || "אנשי קשר של המזמין";
  const cItemLabel = contactsConfig?.item_label || "איש קשר";
  const extraFields = contactsConfig?.extra_fields || [];
  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">פרטי משפחה ואנשי קשר</h3>
          {(isAdmin || isClient) && editingSection !== 'family_details' && (
            <Button variant="outline" size="sm" onClick={() => { 
              setEditingSection('family_details'); 
              setEditableParents([...(event.parents || [])]);
              setEditableFamilyName(event.family_name || '');
              setEditableChildName(event.child_name || '');
              setEditableOrgContacts([...orgContacts]);
            }}>
              <Edit className="h-4 w-4 ml-2" />ערוך
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editingSection === 'family_details' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-gray-50 rounded">
              <div>
                <label className="text-sm font-semibold mb-1 block">שם המשפחה</label>
                <Input 
                  placeholder="שם משפחה" 
                  value={editableFamilyName} 
                  onChange={(e) => setEditableFamilyName(e.target.value)} 
                />
              </div>
              <div>
                <label className="text-sm font-semibold mb-1 block">שם החתן/כלה</label>
                <Input 
                  placeholder="שם החתן/כלה" 
                  value={editableChildName} 
                  onChange={(e) => setEditableChildName(e.target.value)} 
                />
              </div>
            </div>
            {editableParents.map((parent, index) => (
              <div key={index} className="p-3 bg-gray-50 rounded space-y-2">
                <div className="flex justify-between items-center">
                  <h4 className="font-semibold">הורה {index + 1}</h4>
                  <Button variant="ghost" size="sm" onClick={() => setEditableParents(editableParents.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Input 
                    placeholder="שם" 
                    value={parent.name} 
                    onChange={(e) => { 
                      const updated = [...editableParents]; 
                      updated[index].name = e.target.value; 
                      setEditableParents(updated); 
                    }} 
                  />
                  <Input 
                    placeholder="טלפון" 
                    value={parent.phone} 
                    onChange={(e) => { 
                      const updated = [...editableParents]; 
                      updated[index].phone = e.target.value; 
                      setEditableParents(updated); 
                    }} 
                  />
                  <Input 
                    placeholder="אימייל" 
                    type="email" 
                    value={parent.email} 
                    onChange={(e) => { 
                      const updated = [...editableParents]; 
                      updated[index].email = e.target.value; 
                      setEditableParents(updated); 
                    }} 
                  />
                  <div className="flex items-center justify-center">
                    <ContactPicker 
                        onContactSelect={(contact) => {
                            const updated = [...editableParents];
                            if (contact.name) updated[index].name = contact.name;
                            if (contact.phone) updated[index].phone = contact.phone;
                            if (contact.email) updated[index].email = contact.email;
                            setEditableParents(updated);
                        }}
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setEditableParents([...editableParents, { name: '', phone: '', email: '' }])}>
              <Plus className="h-4 w-4 ml-2" />הוסף הורה
            </Button>

            {/* Organizer Contacts Edit */}
            {orgContacts.length > 0 || contactsConfig ? (
              <div className="mt-6 pt-4 border-t">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-semibold">{cLabel}</h4>
                  <Button variant="outline" size="sm" onClick={() => {
                    const empty = { name: '', phone: '', email: '' };
                    extraFields.forEach(f => { empty[f.id] = ''; });
                    setEditableOrgContacts([...editableOrgContacts, empty]);
                  }}>
                    <Plus className="h-4 w-4 ml-2" />הוסף {cItemLabel}
                  </Button>
                </div>
                {editableOrgContacts.map((contact, index) => (
                  <div key={index} className="p-3 bg-gray-50 rounded space-y-2 mb-2">
                    <div className="flex justify-between items-center">
                      <h4 className="font-semibold text-sm">{cItemLabel} {index + 1}</h4>
                      <div className="flex items-center gap-1">
                        <ContactPicker onContactSelect={(c) => {
                          const updated = [...editableOrgContacts];
                          if (c.name) updated[index].name = c.name;
                          if (c.phone) updated[index].phone = c.phone;
                          if (c.email) updated[index].email = c.email;
                          setEditableOrgContacts(updated);
                        }} />
                        <Button variant="ghost" size="sm" onClick={() => setEditableOrgContacts(editableOrgContacts.filter((_, i) => i !== index))}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <Input placeholder="שם" value={contact.name || ''} onChange={(e) => {
                        const u = [...editableOrgContacts]; u[index] = { ...u[index], name: e.target.value }; setEditableOrgContacts(u);
                      }} />
                      <Input placeholder="טלפון" value={contact.phone || ''} onChange={(e) => {
                        const u = [...editableOrgContacts]; u[index] = { ...u[index], phone: e.target.value }; setEditableOrgContacts(u);
                      }} />
                      <Input placeholder="אימייל" type="email" value={contact.email || ''} onChange={(e) => {
                        const u = [...editableOrgContacts]; u[index] = { ...u[index], email: e.target.value }; setEditableOrgContacts(u);
                      }} />
                    </div>
                    {extraFields.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {extraFields.map(f => (
                          <div key={f.id}>
                            {f.type === 'select' ? (
                              <Select value={contact[f.id] || ''} onValueChange={(v) => {
                                const u = [...editableOrgContacts]; u[index] = { ...u[index], [f.id]: v }; setEditableOrgContacts(u);
                              }}>
                                <SelectTrigger><SelectValue placeholder={f.name} /></SelectTrigger>
                                <SelectContent>{(f.options || []).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                              </Select>
                            ) : (
                              <Input placeholder={f.name} value={contact[f.id] || ''} onChange={(e) => {
                                const u = [...editableOrgContacts]; u[index] = { ...u[index], [f.id]: e.target.value }; setEditableOrgContacts(u);
                              }} />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex gap-2 justify-end pt-4">
              <Button variant="outline" onClick={() => setEditingSection(null)} disabled={isSavingFamilyDetails}>ביטול</Button>
              <Button onClick={() => handleSaveFamilyDetails(editableOrgContacts)} disabled={isSavingFamilyDetails}>
                {isSavingFamilyDetails && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                <Save className="h-4 w-4 ml-2" />
                שמור
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div><strong>משפחת:</strong> {event.family_name}</div>
            {event.child_name && <div><strong>שם החתן/כלה:</strong> {event.child_name}</div>}
            <div className="space-y-2">
              <strong>אנשי קשר:</strong>
              {(event.parents || []).map((parent, index) => (
                <div key={index} className="p-2 bg-gray-50 rounded space-y-1">
                  <div>{parent.name}</div>
                  <PhoneNumber phone={parent.phone} />
                  <EmailAddress email={parent.email} />
                </div>
              ))}
            </div>
            {orgContacts.length > 0 && (
              <div className="space-y-2 mt-3 pt-3 border-t">
                <strong>{cLabel}:</strong>
                {orgContacts.map((contact, index) => (
                  <div key={index} className="p-2 bg-gray-50 rounded space-y-1">
                    <div className="font-medium text-sm text-gray-500">{cItemLabel} {index + 1}</div>
                    <div>{contact.name}</div>
                    <PhoneNumber phone={contact.phone} />
                    <EmailAddress email={contact.email} />
                    {extraFields.map(f => contact[f.id] ? (
                      <div key={f.id} className="text-sm text-gray-600"><strong>{f.name}:</strong> {contact[f.id]}</div>
                    ) : null)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}