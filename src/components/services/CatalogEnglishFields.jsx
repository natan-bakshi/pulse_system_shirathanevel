import React from 'react';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';

// A single collapsed area in the existing editor, not a second workflow.
export default function CatalogEnglishFields({
 fields,values={},source={},existing={},touched=[],loading=false,onChange
}){
 const current=fields.map(([key,label])=>({
  key,label,value:values[key]??'',oldSource:existing?.[key]?.source,
  stale:!!existing?.[key]?.value && existing[key].source!==source[key]
 }));
 return <details className="rounded-lg border p-3 space-y-3">
  <summary className="cursor-pointer text-sm font-medium">English · תרגום באנגלית</summary>
  <p className="text-xs text-muted-foreground my-2">The Hebrew record remains unchanged. These translations are used for English client proposals only. If Hebrew changes, the older English wording is marked for review.</p>
  {loading?<p className="text-sm">Loading translations…</p>:<div className="space-y-3 mt-3" dir="ltr">
   {current.map(f=><div key={f.key} className="space-y-1">
    <Label>{f.label}</Label>
    {f.key.endsWith('_description')?<Textarea rows={4} dir="ltr" lang="en"
      value={f.value} onChange={e=>onChange(f.key,e.target.value)}/>:
      <Input dir="ltr" lang="en" value={f.value}
      onChange={e=>onChange(f.key,e.target.value)}/>}
    {f.stale&&!touched.includes(f.key)&&
      <p className="text-xs text-amber-700">The Hebrew text changed. Review this English version before using it.</p>}
   </div>)}
  </div>}
 </details>;
}
