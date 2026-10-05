import React,{useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import QuoteDetails from '@/components/modularQuote/QuoteDetails';
import QuoteVisibility from '@/components/modularQuote/QuoteVisibility';
import QuoteTextSection from '@/components/modularQuote/QuoteTextSection';
import {DragDropContext} from '@hello-pangea/dnd';
import QuoteItemsList from '@/components/modularQuote/QuoteItemsList';
import CatalogAdder from '@/components/modularQuote/CatalogAdder';
import QuoteShareLinks from '@/components/modularQuote/QuoteShareLinks';
import {defaultContent,reorderItems,addOrderedItem} from '@/components/modularQuote/quoteDefaults';
import useQuoteActions from '@/components/modularQuote/useQuoteActions';
export default function ModularQuoteEditor({quote,onBack,onSaved}) {
  const [title,setTitle]=useState(quote?.title||'הצעה מודולרית');const [content,setContent]=useState({...defaultContent(),...quote?.content});
  const actions=useQuoteActions({quote,title,content,onSaved});
  const {data:catalog,isLoading,error}=useQuery({queryKey:['modular-quote-catalog'],queryFn:async()=>{const [services,packages,templates]=await Promise.all([base44.entities.Service.list('service_name',500),base44.entities.Package.list('package_name',500),base44.entities.QuoteTemplate.list()]);return {services,packages,templates};}});
  function update(c){setContent(c);actions.clearPreview();}
  function field(key,value){update({...content,[key]:value});}
  function changeItems(items,manual=false){update({...content,items,...(manual?{manual_order:true}:{})});}
  function dragEnd({source,destination}) {
    if(!destination||source.droppableId!==destination.droppableId||source.index===destination.index)return;
    if(source.droppableId==='quote-items')changeItems(reorderItems(content.items,source.index,destination.index),true);
    else changeItems(content.items.map(item=>source.droppableId===`package:${item.id}`?{...item,children:reorderItems(item.children||[],source.index,destination.index),manual_order:true}:item));
  }
  if(isLoading)return <p className="bg-card rounded-xl p-6" role="status">טוען חבילות, שירותים ותבניות…</p>;
  if(error)return <p className="bg-card rounded-xl p-6" role="alert">לא ניתן לטעון את הקטלוג: {error.message}</p>;
  const templates=catalog.templates;
  return <div className="bg-card text-card-foreground border rounded-xl p-4 sm:p-6 space-y-5"><div className="flex flex-wrap justify-between items-center gap-2"><h2 className="font-semibold text-lg">{quote?.id?'עריכת הצעה מודולרית':'הצעה מודולרית חדשה'}</h2><Button variant="ghost" disabled={!!actions.busy} onClick={onBack}>חזרה לרשימה</Button></div><p className="text-sm text-muted-foreground">הצעה עצמאית ללא שם חוגג ותאריך אירוע. בחר מה לכלול; התוכן נשמר בנפרד מהאירועים.</p><fieldset disabled={!!actions.busy} className="space-y-5 min-w-0"><QuoteDetails title={title} setTitle={setTitle} content={content} onChange={update} concepts={[...new Set(templates.filter(t=>t.template_type==='concept_intro').map(t=>t.identifier))]}/><QuoteVisibility content={content} onChange={update}/><QuoteTextSection label="פתיח" value={content.intro} onChange={v=>field('intro',v)} templates={templates.filter(t=>t.template_type==='concept_intro')}/><section className="space-y-3"><div><Label htmlFor="modular-services-title">כותרת מקטע החבילות והשירותים (אפשר להשאיר ריק)</Label><Input id="modular-services-title" value={content.services_title} onChange={e=>field('services_title',e.target.value)}/></div><p className="text-sm text-muted-foreground">גרור באמצעות ידית הגרירה כדי לשנות סדר, גם בתוך חבילה. הסדר נשמר עם ההצעה.</p><DragDropContext onDragEnd={dragEnd}><QuoteItemsList items={content.items} listId="quote-items" services={catalog.services} onChange={changeItems}/></DragDropContext><CatalogAdder services={catalog.services} packages={catalog.packages} onAdd={v=>changeItems(addOrderedItem(content.items,v,content.manual_order))}/></section><QuoteTextSection label="תנאי תשלום" value={content.payment_terms} onChange={v=>field('payment_terms',v)} templates={templates.filter(t=>t.template_type==='payment_terms')}/><QuoteTextSection label="תנאי התקשרות" value={content.agreement} onChange={v=>field('agreement',v)} templates={templates.filter(t=>t.template_type==='agreement_disclaimer')}/><QuoteTextSection label="טקסט נוסף (רשות)" value={content.notes} onChange={v=>field('notes',v)}/></fieldset>{actions.error&&<p role="alert" className="text-destructive">{actions.error}</p>}<div className="flex flex-wrap gap-2">{[['save','שמור הצעה'],['preview','תצוגה מקדימה'],['pdf','הפק PDF'],['share','הכן קישור ללקוח']].map(([action,label])=><Button key={action} variant={action==='save'?'default':'outline'} disabled={!!actions.busy} onClick={()=>actions.run(action)}>{actions.busy===action?'בתהליך…':label}</Button>)}</div><QuoteShareLinks link={actions.link} pdf={actions.pdf} file={actions.pdfFile}/>{actions.html&&<div className="space-y-2"><h3 className="font-medium">תצוגה מקדימה — זהה לתוכן הקישור וה־PDF</h3><iframe title="תצוגה מקדימה להצעה המודולרית" sandbox="" srcDoc={actions.html} className="w-full h-[650px] rounded-xl border bg-background"/></div>}</div>;
}