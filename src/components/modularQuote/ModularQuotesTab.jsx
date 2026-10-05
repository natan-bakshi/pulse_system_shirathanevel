import React,{useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import ModularQuoteEditor from '@/components/modularQuote/ModularQuoteEditor';
import ModularQuoteRow from '@/components/modularQuote/ModularQuoteRow';
export default function ModularQuotesTab() {
  const [editing,setEditing]=useState(null);const qc=useQueryClient();
  const {data:quotes=[],isLoading,error}=useQuery({queryKey:['modular-quotes'],queryFn:()=>base44.entities.ModularQuote.list('-updated_date',100),refetchOnMount:'always'});
  const refresh=(saved)=>{if(saved?.content)qc.setQueryData(['modular-quotes'],(previous=[])=>[saved,...previous.filter(item=>item.id!==saved.id)]);return qc.invalidateQueries({queryKey:['modular-quotes']});};
  if(editing)return <ModularQuoteEditor key={editing.id||'new'} quote={editing} onBack={()=>{setEditing(null);refresh();}} onSaved={refresh}/>;
  return <section className="bg-card text-card-foreground border rounded-xl p-4 sm:p-6 space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-lg">הצעות מודולריות</h2><Button onClick={()=>setEditing({})}>הצעה מודולרית חדשה</Button></div><p className="text-sm text-muted-foreground">הצעות עצמאיות שניתן לערוך ולשלוח שוב, ללא פרטים אישיים או תאריך אירוע.</p>{isLoading?<p role="status">טוען הצעות…</p>:error?<p role="alert" className="text-destructive">לא ניתן לטעון הצעות: {error.message}</p>:quotes.length===0?<p className="text-center py-8 text-muted-foreground">אין עדיין הצעות מודולריות. צור הצעה ראשונה.</p>:quotes.map(q=><ModularQuoteRow key={q.id} quote={q} onEdit={()=>setEditing(q)} onRefresh={refresh}/>)}</section>;
}