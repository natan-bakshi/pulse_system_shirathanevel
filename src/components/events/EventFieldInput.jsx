import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EVENT_TYPE_OPTIONS, systemKey, displayEventOptionLabel } from '@/lib/eventFields';
import {useLanguage} from '@/i18n/LanguageProvider';
export default function EventFieldInput({field,value,onChange,disabled,concepts=[]}) {
  const {t: uiTranslate}=useLanguage();
  const [manualConcept, setManualConcept] = useState(false);
  const label=systemKey(field)?uiTranslate(field.name):field.name;
  const hint=systemKey(field)?uiTranslate(field.placeholder||field.name):(field.placeholder||field.name);
  const props={value:value??'',disabled,required:!!field.required,'aria-label':label};
  if(field.type==='textarea') return <Textarea {...props} onChange={e=>onChange(e.target.value)} placeholder={hint} />;
  if(field.type==='select') {
    const options=systemKey(field)==='event_type'?EVENT_TYPE_OPTIONS:(field.options || []);
    return <Select value={String(value??'')} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label}><SelectValue placeholder={hint} /></SelectTrigger><SelectContent>{options.map(o=>{const v=typeof o==='string'?o:o.value;return <SelectItem key={v} value={v}>{displayEventOptionLabel(field,o,uiTranslate)}</SelectItem>;})}</SelectContent></Select>;
  }
  if(field.type==='concept') return manualConcept || (value && !concepts.includes(value)) ? <div className="space-y-2"><Input {...props} onChange={e=>onChange(e.target.value)} placeholder={uiTranslate("שם קונספט חדש...")} /><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={()=>{setManualConcept(false);onChange('');}}>{uiTranslate("חזור לבחירה מהרשימה")}</Button></div> : <Select value={value || ''} disabled={disabled} onValueChange={v=>{if(v==='__manual__')setManualConcept(true);else onChange(v);}}><SelectTrigger aria-label={label}><SelectValue placeholder={uiTranslate("בחר קונספט...")} /></SelectTrigger><SelectContent>{concepts.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}<SelectItem value="__manual__">{uiTranslate("+ הכנס קונספט חדש")}</SelectItem></SelectContent></Select>;

  return <Input {...props} type={field.type==='phone'?'tel':['number','time','date','email','url'].includes(field.type)?field.type:'text'} min={systemKey(field)==='guest_count'?0:undefined} step={systemKey(field)==='guest_count'?1:undefined} onChange={e=>onChange(e.target.value)} placeholder={hint} />;
}
