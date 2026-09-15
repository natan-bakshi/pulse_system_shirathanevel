import React from 'react';
import { Label } from '@/components/ui/label';
import EventFieldInput from './EventFieldInput';
import { systemKey, readEventField } from '@/lib/eventFields';
export default function DynamicEventFieldsSection({fields,values={},onChange,eventValues={},onEventChange,disabled,concepts=[],categories=['event_details','organizer_details'],compact=false}) {
  return <>{categories.map(category=>{
    const selected=fields.filter(f=>(f.category || 'event_details')===category && !['contacts','schedule'].includes(f.type));
    if(!selected.length) return null;
    return <div key={category} className={compact?'space-y-3':'p-3 sm:p-6 border rounded-lg bg-gray-50/80'}>
      {!compact && <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 border-b pb-2">{category==='organizer_details'?'פרטי מזמין':'פרטי אירוע'}</h3>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{selected.map(field=><div key={field.id} className={field.type==='textarea'?'col-span-full':''}>
        <Label>{field.name}{field.required?' *':''}</Label>
        <EventFieldInput field={field} value={readEventField(field,eventValues,values)} disabled={disabled} concepts={concepts} onChange={value=>{const key=systemKey(field);if(key) onEventChange(key,value);else onChange({...values,[field.id]:value});}} />
      </div>)}</div>
    </div>;
  })}</>;
}
