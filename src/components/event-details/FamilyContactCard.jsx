import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Edit, Trash2, Plus, Save, Loader2 } from 'lucide-react';
import PhoneNumber from '../ui/PhoneNumber';
import EmailAddress from '../ui/EmailAddress';
import ContactPicker from '../ui/ContactPicker';

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
            <div className="flex gap-2 justify-end pt-4">
              <Button variant="outline" onClick={() => setEditingSection(null)} disabled={isSavingFamilyDetails}>ביטול</Button>
              <Button onClick={handleSaveFamilyDetails} disabled={isSavingFamilyDetails}>
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}