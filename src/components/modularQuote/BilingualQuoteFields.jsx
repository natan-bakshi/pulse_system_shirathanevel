import React from 'react';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import QuoteTextSection from './QuoteTextSection';

// Secondary content is optional while editing Hebrew, and only shown when
// the operator explicitly chooses an English client document.
const texts=[
 ['intro','Opening Text'],['payment_terms','Payment Terms'],
 ['agreement','Terms & Conditions'],['notes','Additional Notes']
];
const names=[
 ['custom_title','Custom Heading'],['services_title','Services Section Heading'],
 ['event_type','Event Type'],['concept','Concept']
];
export default function BilingualQuoteFields({content,onChange}){
 if(content.document_language!=='en')return null;
 const set=(key,value)=>onChange({...content,english:{
  ...content.english,[key]:{source:content[key]||'',value}
 }});
 return <details className="rounded-xl border p-3 sm:p-4 space-y-3">
  <summary className="font-medium cursor-pointer">English content · Edit only when needed</summary>
  <p className="text-sm text-muted-foreground mt-2">Catalog services and existing approved templates are translated automatically. For custom text, write or approve the English version here. When the Hebrew source changes, the English version will require re-approval.</p>
  <div className="grid sm:grid-cols-2 gap-3 mt-4">
   {names.filter(([key])=>content[key]).map(([key,label])=>{
    const pair=content.english?.[key];
    const outdated=pair?.value && pair.source!==(content[key]||'');
    return <div key={key}><Label>{label}</Label>
      <Input dir="ltr" lang="en" value={pair?.value||''} onChange={e=>set(key,e.target.value)}
       placeholder="English wording (optional if already in glossary)" />
      {outdated&&<p className="text-xs text-amber-700">Hebrew text changed. Review and update this English wording.</p>}
    </div>;
   })}
  </div>
  <div className="mt-3 space-y-3" dir="ltr">
   {texts.filter(([key])=>content[key]).map(([key,label])=>{
    const pair=content.english?.[key];
    const outdated=pair?.value && pair.source!==(content[key]||'');
    return <div key={key}><QuoteTextSection label={label} value={pair?.value||''} onChange={v=>set(key,v)}/>
      {outdated&&<p className="text-xs text-amber-700">Source changed—review and approve the English version.</p>}
    </div>;
   })}
  </div>
 </details>;
}
