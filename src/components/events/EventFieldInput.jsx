import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EVENT_TYPE_OPTIONS, systemKey } from '@/lib/eventFields';
export default function EventFieldInput({field,value,onChange,disabled,concepts=[]}) {
  const [manualConcept, setManualConcept] = useState(false);
  const props={value:value??'',disabled,required:!!field.required,'aria-label':field.name};
  if(field.type==='textarea') return <Textarea {...props} onChange={e=>onChange(e.target.value)} placeholder={field.placeholder || field.name} />;
  if(field.type==='select') {
    const options=systemKey(field)==='event_type'?EVENT_TYPE_OPTIONS:(field.options || []);
    return <Select value={String(value??'')} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={field.name}><SelectValue placeholder={field.placeholder || field.name} /></SelectTrigger><SelectContent>{options.map(o=>{const v=typeof o==='string'?o:o.value;return <SelectItem key={v} value={v}>{typeof o==='string'?o:o.label}</SelectItem>;})}</SelectContent></Select>;
  }
  if(field.type==='concept') return manualConcept || (value && !concepts.includes(value)) ? <div className="space-y-2"><Input {...props} onChange={e=>onChange(e.target.value)} placeholder="שם קונספט חדש..." /><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={()=>{setManualConcept(false);onChange('');}}>חזור לבחירה מהרשימה</Button></div> : <Select value={value || ''} disabled={disabled} onValueChange={v=>{if(v==='__manual__')setManualConcept(true);else onChange(v);}}><SelectTrigger aria-label={field.name}><SelectValue placeholder="בחר קונספט..." /></SelectTrigger><SelectContent>{concepts.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}<SelectItem value="__manual__">+ הכנס קונספט חדש</SelectItem></SelectContent></Select>;

  return <Input {...props} type={field.type==='phone'?'tel':['number','time','date','email','url'].includes(field.type)?field.type:'text'} min={systemKey(field)==='guest_count'?0:undefined} step={systemKey(field)==='guest_count'?1:undefined} onChange={e=>onChange(e.target.value)} placeholder={field.placeholder || field.name} />;
}
