import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Edit, Save, Loader2 } from 'lucide-react';
import PhoneNumber from '../ui/PhoneNumber';
import EmailAddress from '../ui/EmailAddress';
import OrganizerContactsSection from '../events/OrganizerContactsSection';
import { useOrganizerConfig } from '@/hooks/useOrganizerConfig';
import { getField, getEventContacts, contactExtraValue, systemKey, readEventField } from '@/lib/eventFields';

export default function FamilyContactCard({event,isAdmin,isClient,editingSection,setEditingSection,editableParents,setEditableParents,editableFamilyName,setEditableFamilyName,editableChildName,setEditableChildName,handleSaveFamilyDetails,isSavingFamilyDetails}) {
  const {fields,contactsConfig,isLoading,isError}=useOrganizerConfig(event?.organizer_type);
  const [contacts,setContacts]=useState([]);
  const family=getField(fields,'family_name'), child=getField(fields,'child_name'), contactField=getField(fields,'parents');
  const extraFields=contactsConfig.extra_fields || [];
  const existingContacts=getEventContacts(event);
  const customOrganizerFields=fields.filter(f=>!systemKey(f) && f.category==='organizer_details');
  if(!family && !child && !contactField && !customOrganizerFields.length) return null;
  return <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
    <CardHeader><div className="flex justify-between items-center">
      <h3 className="text-lg font-semibold">{family || child ? 'פרטי משפחה ואנשי קשר' : contactField?.name || 'פרטי מזמין'}</h3>
      {(isAdmin || isClient) && editingSection!=='family_details' && <Button variant="outline" size="sm" disabled={isLoading || isError} onClick={()=>{
        setEditingSection('family_details');
        setEditableFamilyName(event.family_name || '');setEditableChildName(event.child_name || '');
        setEditableParents(existingContacts.map(c=>({...c,custom_fields:{...c.custom_fields}})));
        setContacts(existingContacts.map(c=>({...c,custom_fields:{...c.custom_fields}})));
      }}><Edit className="h-4 w-4 ml-2" />ערוך</Button>}
    </div></CardHeader>
    <CardContent>{editingSection==='family_details' ? <div className="space-y-4">
      {(family || child) && <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-gray-50 rounded">
        {family && <div><label className="text-sm font-semibold mb-1 block">{family.name}</label><Input aria-label={family.name} value={editableFamilyName} onChange={e=>setEditableFamilyName(e.target.value)} disabled={isSavingFamilyDetails} /></div>}
        {child && <div><label className="text-sm font-semibold mb-1 block">{child.name}</label><Input aria-label={child.name} value={editableChildName} onChange={e=>setEditableChildName(e.target.value)} disabled={isSavingFamilyDetails} /></div>}
      </div>}
      {contactField && <OrganizerContactsSection contacts={contacts} onChange={next=>{setContacts(next);setEditableParents(next);}} config={{...contactsConfig,label:contactField.name}} disabled={isSavingFamilyDetails} />}
      <div className="flex gap-2 justify-end pt-4"><Button variant="outline" onClick={()=>setEditingSection(null)} disabled={isSavingFamilyDetails}>ביטול</Button><Button onClick={()=>handleSaveFamilyDetails(contactField ? contacts : editableParents)} disabled={isSavingFamilyDetails || isLoading || isError}>{isSavingFamilyDetails && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}<Save className="h-4 w-4 ml-2" />שמור</Button></div>
    </div> : <div className="space-y-3">
      {family && <div><strong>{family.name}:</strong> {event.family_name}</div>}
      {child && event.child_name && <div><strong>{child.name}:</strong> {event.child_name}</div>}
      {customOrganizerFields.map(f=><div key={f.id}><strong>{f.name}:</strong> {String(readEventField(f,event))}</div>)}
      {contactField && <div className="space-y-2"><strong>{contactField.name}:</strong>{existingContacts.map((c,i)=><div key={c.id || i} className="p-2 bg-gray-50 rounded space-y-1">
        <div>{c.name}</div><PhoneNumber phone={c.phone} /><EmailAddress email={c.email} />
        {extraFields.map(f=>{const v=contactExtraValue(c,f);return v==='' || v==null?null:<div key={f.id} className="text-sm text-gray-600"><strong>{f.name}:</strong> {String(v)}</div>;})}
      </div>)}</div>}
    </div>}</CardContent>
  </Card>;
}
