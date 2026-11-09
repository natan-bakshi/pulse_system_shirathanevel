import React,{useEffect,useMemo,useState} from 'react';
import {base44} from '@/api/base44Client';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import EnglishDraftButton from '@/i18n/EnglishDraftButton';
import {externalEnglishEnabled} from '@/i18n/futureTranslationClient';
import {useLanguage} from '@/i18n/LanguageProvider';
import {isHebrew,translationPreservesProtectedContent,quoteVisibleFragmentField} from '../../../base44/shared/quoteLocalization.ts';
import {matchesResidualEnglishSample,hebrewTextNodesInTranslation,substituteExactHebrewTextNode} from '@/i18n/quoteEnglishReviewHelpers';

const eventFields={event_name:'Event title',family_name:'Family name',child_name:"Child's name",location:'Event location',city:'City',concept:'Concept',services_section_title:'Services heading',standalone_services_title:'Standalone services heading',external_services_title:'External services heading',notes:'Client-facing notes',discount_reason:'Discount Reason'};
const serviceFields={service_name:'Service name',service_description:'Description',package_name:'Package name',package_description:'Package description',client_notes:'Client-facing notes',price_display_text:'Custom price label'};
function organizerFieldValue(record,key){
 if(!record)return '';
 if(key==='contacts_label'){
  try{return JSON.parse(record.contacts_config||'{}').label||'';}catch{return '';}
 }
 const match=key.match(/^block_(\d+)_subtitle_title$/);
 if(match){try{return JSON.parse(record.quote_blocks||'[]')[Number(match[1])]?.subtitle_title||'';}catch{return '';}}
 return record[key]||'';
}
function liveValue(f,event,services){
 if(f.entity==='EventService'){
  const service=services.find(s=>s.id===f.id);
  if(!service)return '';
  if(f.key==='on_site_contact_name')return service.on_site_contact_details?.name||'';
  const pickup=f.key.match(/^pickup_(\d+)_(\d+)_(location|contact)$/);
  if(pickup){
   try{
    const point=JSON.parse(service.pickup_point||'[]')?.[Number(pickup[1])]?.pickupPoints?.[Number(pickup[2])];
    return pickup[3]==='location'?(point?.location||''):(point?.contact?.name||'');
   }catch{return '';}
  }
  return service[f.key]||'';
 }
 if(f.key.startsWith('organizer_contact_')&&f.key.endsWith('_name')){
  try{
   const id=f.key.slice('organizer_contact_'.length,-'_name'.length);
   const contacts=JSON.parse(event.organizer_contacts||event.organizercontacts||'[]');
   return contacts.find((c,i)=>String(c.id||i)===id)?.name||'';
  }catch{return '';}
 }
 if(f.key.startsWith('custom_')){
  try{return JSON.parse(event.custom_organizer_fields||'{}')?.[f.key.slice(7)]||'';}
  catch{return '';}
 }
 const m=f.key.match(/^schedule_(\d+)_(activity|notes)$/);
 if(m)return event.schedule?.[Number(m[1])]?.[m[2]]||'';
 if(f.key.startsWith('contact_')&&f.key.endsWith('_name')){
  const id=f.key.slice(8,-5);
  return (event.parents||[]).find((p,i)=>String(p.id||i)===id)?.name||'';
 }
 return event[f.key]||'';
}
function collect(event,services,catalog,rows,missingFields=[],quoteTemplates=[],organizerTypes=[],appSettings=[],visibleTextSamples=[]){
 if(!event)return [];
 const fields=[];
 const add=(entity,id,key,source,label,group)=>{
  if(typeof source==='string'&&source.trim()&&isHebrew(source))
   fields.push({entity,id,key,source,label,group,hash:entity+':'+id+':'+key,
      rich:/description|notes|content/.test(key)});
 };
 for(const [key,label] of Object.entries(eventFields))
  add('Event',event.id,key,event[key],label,'event');
 if(typeof event.custom_organizer_fields==='string'&&event.custom_organizer_fields.trim()){
  try{const fields=JSON.parse(event.custom_organizer_fields);
   for(const [key,value] of Object.entries(fields||{}))
    add('Event',event.id,'custom_'+key,value,'Organizer Field: '+key,'event');
  }catch{}
 }

 (event.parents||[]).forEach((p,i)=>
  add('Event',event.id,'contact_'+String(p.id||i)+'_name',p.name,"Contact's English spelling",'event'));
 if(event.contacts_schema_version!==2){
  try{const legacy=JSON.parse(event.organizer_contacts||event.organizercontacts||'[]');
   (Array.isArray(legacy)?legacy:[]).forEach((c,i)=>
     add('Event',event.id,'organizer_contact_'+String(c.id||i)+'_name',
       c.name,'Additional Contact Name','event'));
  }catch{}
 }
 (event.schedule||[]).forEach((s,i)=>{
  add('Event',event.id,'schedule_'+i+'_activity',s.activity,'Schedule activity '+(i+1),'event');
  add('Event',event.id,'schedule_'+i+'_notes',s.notes,'Schedule notes '+(i+1),'event');
 });
 for(const organizer of organizerTypes){
  if(organizer.type_name!==event.organizer_type)continue;
  for(const key of ['quote_main_title_template','contacts_label'])
   add('QuoteOrganizerType',organizer.id,key,organizerFieldValue(organizer,key),
    key==='contacts_label'?'Event Contacts Heading':'Custom Quote Title','organizer');
  let blocks=[];
  try{blocks=JSON.parse(organizer.quote_blocks||'[]');}catch{}
  if(Array.isArray(blocks))blocks.forEach((block,i)=>
   add('QuoteOrganizerType',organizer.id,'block_'+i+'_subtitle_title',block.subtitle_title,
    'Section '+(i+1)+' Heading','organizer'));
 }
 if(missingFields.includes('footer'))for(const setting of appSettings){
  if(setting.setting_key==='quote_footer_text')
   add('AppSettings',setting.id,'setting_value',setting.setting_value,'Quote Footer','settings');
 }
 // Keep already approved template translations in the review model too.
 // A final-document error can originate inside an approved English value,
 // not only in an untranslated Hebrew source. The visible list is filtered
 // below to the exact affected fields, so this does not clutter the dialog.
 for(const template of quoteTemplates){
  add('QuoteTemplate',template.id,'content',template.content,
    template.template_type==='payment_terms'?'Payment Terms — Quote Template':
    template.template_type==='agreement_disclaimer'?'Agreement Terms — Quote Template':
    'Quote Template — '+(template.identifier||template.template_type),'templates');
 }
 for(const catalogService of catalog){
  if(!missingFields.some(key=>key.startsWith('catalog.'+catalogService.id+'.'))&&
     !services.some(s=>s.service_id===catalogService.id))continue;
  add('Service',catalogService.id,'service_name',catalogService.service_name,
    'Catalog Service Name','catalog');
  add('Service',catalogService.id,'service_description',catalogService.service_description,
    'Catalog Service Description','catalog');
 }
 for(const service of services){
  for(const [key,label] of Object.entries(serviceFields)){
   const source=service[key];
   if(!source||!isHebrew(source))continue;
   const approvedCatalog=rows.some(t=>t.source_entity==='Service'&&
     t.source_id===service.service_id&&t.status==='approved'&&
     t.fields?.[key]?.source===source&&
     translationPreservesProtectedContent(source,t.fields?.[key]?.value||''));
   if(!approvedCatalog)add('EventService',service.id,key,source,label,service.id);
  }
  add('EventService',service.id,'on_site_contact_name',
    service.on_site_contact_details?.name,'On-site Contact Name',service.id);
  const pickup=service.pickup_point;
  if(typeof pickup==='string'&&pickup.trim()&&isHebrew(pickup)){
   let parsed;
   try{parsed=JSON.parse(pickup);}catch{}
   if(Array.isArray(parsed)){
    parsed.forEach((unit,u)=>(unit.pickupPoints||[]).forEach((point,p)=>{
     add('EventService',service.id,'pickup_'+u+'_'+p+'_location',point.location,
       'Journey '+(u+1)+' — Stop '+(p+1)+' Location',service.id);
     add('EventService',service.id,'pickup_'+u+'_'+p+'_contact',point.contact?.name,
       'Journey '+(u+1)+' — Stop '+(p+1)+' Contact Name',service.id);
    }));
   }else add('EventService',service.id,'pickup_point',pickup,
       'Pickup Location / Transport Details',service.id);
  }
 }
 // Last-resort repair for genuine renderer-only text. Scoped to this event,
 // exact visible text nodes, and never changing the original event or catalog.
 // Error snippets are capped at 640 characters; longer fragments cannot
 // be safely matched, and are never silently truncated into an override.
 if(missingFields.includes('document.visible_text')){
  for(const raw of visibleTextSamples){
   const sample=String(raw||'').replace(/\s+/g,' ').trim();
   if(!isHebrew(sample)||!sample||sample.length>=640)continue;
   const covered=fields.some(f=>{
    const entry=rows.find(r=>r.source_entity===f.entity&&r.source_id===f.id&&r.locale==='en');
    return matchesResidualEnglishSample(entry?.fields?.[f.key]?.value,[sample])||
      matchesResidualEnglishSample(f.source,[sample]);
   });
   if(!covered)add('Event',event.id,quoteVisibleFragmentField(sample),sample,
     'Text found only in generated document','document');
  }
 }
 return fields;
}
export default function EventQuoteEnglishDialog({open,onOpenChange,event,eventServices=[],allServices=[],quoteTemplates=[],missingFields=null,visibleTextSamples=[],onSaved}){
 const {locale,t}=useLanguage();
 const [rows,setRows]=useState([]),[draft,setDraft]=useState({});
 const [organizers,setOrganizers]=useState([]),[footerSettings,setFooterSettings]=useState([]);
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [showAll,setShowAll]=useState(false);
 const [fragmentInputs,setFragmentInputs]=useState({});
 useEffect(()=>{if(open){setShowAll(false);setFragmentInputs({});}},[open,missingFields]);
 useEffect(()=>{
  if(!open)return;
  let active=true;setLoading(true);setError('');setDraft({});
  const readOrganizer=(Array.isArray(missingFields)&&missingFields.some(k=>k.startsWith('organizer.')))||visibleTextSamples.length>0;
  const readFooter=(Array.isArray(missingFields)&&missingFields.includes('footer'))||visibleTextSamples.length>0;
  Promise.all([
   (async()=>{
     const found=[],seen=new Set();
     for(let offset=0;offset<15000;offset+=500){
       const page=await base44.entities.ContentTranslation.list('-updated_date',500,offset);
       if(!Array.isArray(page))throw Error('Could not load all existing English translations.');
       let added=0;
       for(const row of page){
         const id=String(row.id||row.source_entity+':'+row.source_id);
         if(!seen.has(id)){found.push(row);seen.add(id);added++;}
       }
       if(page.length<500)return found;
       if(added===0)throw Error('The translation list could not advance to the next page.');
     }
     throw Error('The translation list exceeded the safe page limit.');
   })(),
   readOrganizer?base44.entities.QuoteOrganizerType.list():Promise.resolve([]),
   readFooter?base44.entities.AppSettings.filter({setting_key:'quote_footer_text'}):Promise.resolve([])
  ])
   .then(([translations,types,settings])=>{
    if(active){setRows(Array.isArray(translations)?translations:[]);
      setOrganizers(Array.isArray(types)?types:[]);
      setFooterSettings(Array.isArray(settings)?settings:[]);}
   })
   .catch(()=>{if(active)setError('Could not load English translations or quote settings.');})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[open,event?.id,visibleTextSamples.length]);
 const fields=useMemo(()=>collect(event,eventServices,allServices,rows,missingFields||[],quoteTemplates,organizers,footerSettings,visibleTextSamples),
  [event,eventServices,allServices,rows,missingFields,quoteTemplates,organizers,footerSettings,visibleTextSamples]);
 const map=useMemo(()=>new Map(rows.map(row=>[row.source_entity+':'+row.source_id,row])),[rows]);
 const changed=fields.filter(f=>Object.prototype.hasOwnProperty.call(draft,f.hash));
 const needed=new Set(missingFields||[]);
 const issueKey=f=>f.entity==='Event'?'event.'+f.key:
   f.entity==='Service'?'catalog.'+f.id+'.'+f.key:
   f.entity==='QuoteTemplate'?'template.'+f.id+'.'+f.key:
   f.entity==='QuoteOrganizerType'?'organizer.'+f.key:
   f.entity==='AppSettings'?'footer':'service.'+f.id+'.'+f.key;
 const matchesResidual=f=>{
   const existing=map.get(f.entity+':'+f.id)?.fields?.[f.key];
   // The latest backend identifies partly translated fields directly, but
   // support older 422 document.visible_text errors too: match the actual
   // leftover text to its approved translation rather than hiding its editor.
   return matchesResidualEnglishSample(existing?.value,visibleTextSamples)||
     matchesResidualEnglishSample(f.source,visibleTextSamples);
 };
 const matchesMissing=f=>needed.has(issueKey(f))||
   needed.has('service.'+f.key)||needed.has('catalog.'+f.key)||matchesResidual(f);
 const displayedFields=Array.isArray(missingFields)&&!showAll?
   fields.filter(matchesMissing):fields;
 const grouped=displayedFields.reduce((o,f)=>((o[f.group]??=[]).push(f),o),{});
 const matchedIssueKeys=new Set(fields.filter(matchesMissing).map(issueKey));
 const unmatched=Array.isArray(missingFields)?missingFields.filter(k=>
   !(k==='document.visible_text'&&fields.some(matchesResidual))&&
   !matchedIssueKeys.has(k)&&!fields.some(f=>k==='service.'+f.key||k==='catalog.'+f.key)):[];
 const save=async()=>{
  if(!changed.length){
   if(Array.isArray(missingFields)&&missingFields.length){
    setError(locale==='en'?'Enter and approve at least one of the missing English translations.':'כדי להמשיך, יש להזין ולאשר לפחות אחד מהתרגומים החסרים.');
    return;
   }
   onOpenChange(false);return;
  }
  setSaving(true);setError('');
  try{
   const latestEvent=await base44.entities.Event.get(event.id);
   const latestServices=await base44.entities.EventService.filter({event_id:event.id});
   const latestCatalog=changed.some(f=>f.entity==='Service')?
     await Promise.all(changed.filter(f=>f.entity==='Service').map(f=>
       base44.entities.Service.get(f.id))):[];
   const latestTemplates=changed.some(f=>f.entity==='QuoteTemplate')?
     await Promise.all(changed.filter(f=>f.entity==='QuoteTemplate').map(f=>
       base44.entities.QuoteTemplate.get(f.id))):[];
   const latestOrganizers=changed.some(f=>f.entity==='QuoteOrganizerType')?
     await Promise.all([...new Set(changed.filter(f=>f.entity==='QuoteOrganizerType').map(f=>f.id))]
       .map(id=>base44.entities.QuoteOrganizerType.get(id))):[];
   const latestSettings=changed.some(f=>f.entity==='AppSettings')?
     await Promise.all([...new Set(changed.filter(f=>f.entity==='AppSettings').map(f=>f.id))]
       .map(id=>base44.entities.AppSettings.get(id))):[];
   for(const f of changed){
    const liveSource=f.entity==='Service'?latestCatalog.find(x=>x.id===f.id)?.[f.key]:
      f.entity==='QuoteTemplate'?latestTemplates.find(x=>x.id===f.id)?.[f.key]:
      f.entity==='QuoteOrganizerType'?organizerFieldValue(latestOrganizers.find(x=>x.id===f.id),f.key):
      f.entity==='AppSettings'?latestSettings.find(x=>x.id===f.id)?.setting_value:
      f.entity==='Event'&&f.key.startsWith('visible_fragment_')?f.source:
      liveValue(f,latestEvent,latestServices);
    if(String(liveSource??'')!==f.source)
     throw Error('The original Hebrew text changed. Reopen this editor to review it.');
    if(matchesMissing(f)&&!String(draft[f.hash]||'').trim())
     throw Error(locale==='en'?'A required English translation cannot be empty.':'לא ניתן להשאיר תרגום נדרש ריק.');
    if(draft[f.hash]&&!translationPreservesProtectedContent(f.source,draft[f.hash]))
     throw Error(locale==='en'?'The English text still contains Hebrew or changed a protected number, URL or placeholder: '+f.label:'התרגום מכיל עדיין עברית או שינה מספר, קישור או משתנה מוגן: '+f.label);
   }
   const updates=new Map();
   for(const f of changed){
    const group=f.entity+':'+f.id,fieldsForGroup=updates.get(group)||{};
    fieldsForGroup[f.key]=draft[f.hash]?.trim()?{source:f.source,value:draft[f.hash].trim()}:null;
    updates.set(group,fieldsForGroup);
   }
   for(const [group,updatesForGroup] of updates){
    const [entity,id]=group.split(':');
    const matches=rows.filter(r=>r.source_entity===entity&&r.source_id===id&&r.locale==='en');
    if(matches.length>1)throw Error('Duplicate translation records need administrator review.');
    const old=matches[0],next={...(old?.fields||{})};
    for(const [key,pair] of Object.entries(updatesForGroup)){
     if(pair)next[key]=pair;else delete next[key];
    }
    if(old)await base44.entities.ContentTranslation.update(old.id,{
     fields:next,status:'approved',provenance:'human_reviewed'
    });
    else if(Object.keys(next).length)await base44.entities.ContentTranslation.create({
     source_entity:entity,source_id:id,locale:'en',fields:next,
     status:'approved',provenance:'human_reviewed'
    });
   }
   onSaved?.();
   onOpenChange(false);
  }catch(e){setError(e.message||'Could not save translations.');}
  finally{setSaving(false);}
 };
 const editor=f=>{
  const pair=map.get(f.entity+':'+f.id)?.fields?.[f.key];
  const val=Object.prototype.hasOwnProperty.call(draft,f.hash)?draft[f.hash]:(pair?.value||'');
  const stale=pair?.value && pair.source!==f.source;
  const fragments=hebrewTextNodesInTranslation(val);
  return <div key={f.hash} className="space-y-2">
   <Label className="text-xs">{f.label}</Label>
   <p dir="rtl" className="text-xs text-muted-foreground break-words">
     {f.source.replace(/<[^>]*>/g,' ').slice(0,350)}
   </p>
   {fragments.length>0&&<div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-3" role="group">
     <p className="font-medium text-sm text-amber-950">{locale==='en'?'Untranslated Hebrew found inside an existing English translation. Fix just the marked text below, or edit the full text.':'נמצא טקסט בעברית בתוך תרגום אנגלי קיים. אפשר לתקן רק את הקטע המסומן, בלי לערוך את המסמך כולו.'}</p>
     {fragments.map((fragment,i)=>{
       const id=f.hash+':'+i;
       return <div key={id} className="space-y-2">
         <p dir="rtl" className="text-sm font-semibold text-amber-950 break-words">{fragment}</p>
         <div className="flex flex-col sm:flex-row gap-2">
           <Input dir="ltr" lang="en" aria-label={locale==='en'?'English replacement for Hebrew text':'תרגום אנגלי לקטע בעברית'}
             value={fragmentInputs[id]||''} onChange={e=>setFragmentInputs(p=>({...p,[id]:e.target.value}))}
             placeholder={locale==='en'?'Enter exact English wording':'הקלד כאן נוסח אנגלי מדויק'}/>
           <Button type="button" variant="outline" disabled={!String(fragmentInputs[id]||'').trim()}
             onClick={()=>{
               const next=substituteExactHebrewTextNode(val,fragment,fragmentInputs[id]);
               if(!next){setError(locale==='en'?'Replace the full Hebrew phrase with safe English text.':'יש להזין נוסח אנגלי תקין במקום הקטע המלא בעברית.');return;}
               setDraft(d=>({...d,[f.hash]:next}));setError('');
             }}>{locale==='en'?'Apply to Draft':'החלף בטיוטה'}</Button>
         </div>
       </div>;
     })}
     <p className="text-xs text-amber-800">{locale==='en'?'The original Hebrew and protected bank numbers stay unchanged. Save the reviewed English draft below.':'המקור בעברית ומספרי חשבון הבנק נשארים ללא שינוי. לאחר ההחלפה יש לשמור את התרגום.'}</p>
   </div>}
   {f.rich?<Textarea rows={7} dir="ltr" lang="en" value={val}
       onChange={e=>setDraft(d=>({...d,[f.hash]:e.target.value}))} className="text-xs sm:text-sm"/>:
    <Input dir="ltr" lang="en" value={val}
       onChange={e=>setDraft(d=>({...d,[f.hash]:e.target.value}))}/>}
   <EnglishDraftButton source={f.source} kind={f.key.includes('description')?'service_description':
     f.key.includes('name')?'event_name':f.key.includes('schedule')?'schedule_notes':'event_notes'}
     onDraft={draft=>setDraft(d=>({...d,[f.hash]:draft}))} compact/>
   {stale&&<p className="text-xs text-amber-700">The Hebrew source changed. Review the English version.</p>}
  </div>;
 };
 return <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" dir={locale==='en'?'ltr':'rtl'}>
   <DialogHeader><DialogTitle>{locale==='en'?'Complete English Quote Content':'השלמת תוכן להצעת מחיר באנגלית'}</DialogTitle></DialogHeader>
   <p className="text-sm text-muted-foreground" dir={locale==='en'?'ltr':'rtl'}>{t("השדות שכבר תורגמו בקטלוג משמשים אוטומטית. כאן אפשר לאשר נוסח אנגלי רק עבור שדות שדורשים השלמה, בלי לשנות את העברית או את המחירים.")}</p>
   {!externalEnglishEnabled()&&<p dir={locale==='en'?'ltr':'rtl'} className="text-xs text-amber-800 border rounded-md p-2">
     {t("המתרגם האוטומטי לשינויים חדשים עדיין אינו מחובר לשירות חיצוני פעיל. אפשר לערוך ולשמור כאן תרגומים באנגלית ידנית; לא יתבצע תרגום אוטומטי ללא חיבור מאובטח.")}
   </p>}
   {Array.isArray(missingFields)&&<div dir={locale==='en'?'ltr':'rtl'} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 space-y-2">
     <p className="font-semibold">{t("נדרשת השלמה של")} {missingFields.length} {t("שדות לפני הנפקה באנגלית")}</p>
     <label className="inline-flex items-center gap-2"><input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)}/>{t("הצג גם שדות שכבר תורגמו")}</label>
     <p className="text-xs">{t("הנוסח באנגלית נשמר לשימוש חוזר. לאחר השמירה אפשר להפיק מחדש את ההצעה.")}</p>
   </div>}
   {visibleTextSamples.length>0&&<div dir={locale==='en'?'ltr':'rtl'} role="alert" className="border border-amber-300 rounded-md p-3 text-sm space-y-2">
     <p className="font-semibold">{t("נמצא טקסט עברי במסמך האנגלי לאחר הרכבת ההצעה")}</p>
     <p className="text-xs text-muted-foreground">{t("יש למצוא את הנוסח בפרטי האירוע, בשירותים או בתבנית הרלוונטית ולהזין לו תרגום באנגלית. עד אז המערכת לא תפיק מסמך מעורב בעברית ובאנגלית.")}</p>
     <ul className="list-disc pr-5 space-y-1 text-xs break-words">
       {visibleTextSamples.map((snippet,i)=><li key={i}>{snippet}</li>)}
     </ul>
   </div>}
   {loading?<p role="status">Loading English content…</p>:<>
    {grouped.event&&<div className="space-y-4 border rounded-lg p-3">
      <h3 className="font-semibold">Event & family details</h3>{grouped.event.map(editor)}
    </div>}
    {Object.entries(grouped).filter(([key])=>key!=='event').map(([key,list])=>
      <details key={key} defaultOpen={Array.isArray(missingFields)&&!showAll} className="border rounded-lg p-3">
       <summary className="cursor-pointer font-medium text-sm" dir={locale==='en'?'ltr':'rtl'}>
        {t(key==='organizer'?'כותרות של סוג ההזמנה':key==='templates'?'תבניות הצעת מחיר':
         key==='catalog'?'שירותים מהקטלוג':key==='settings'?'הגדרות הצעת מחיר':
         key==='document'?(locale==='en'?'Other Text in the Document':'טקסט נוסף במסמך'):
         eventServices.find(s=>s.id===key)?.service_name||'שירות')} — {list.length} {t("שדות לתרגום")}
       </summary><div className="space-y-3 mt-4">{list.map(editor)}</div>
      </details>)}
    {!displayedFields.length&&<p className="text-sm" dir={locale==='en'?'ltr':'rtl'}>{t("לא נמצאו שדות נוספים לעריכה בתצוגה הזאת.")}</p>}
    {unmatched.length>0&&<div dir={locale==='en'?'ltr':'rtl'} className="border rounded-lg p-3 text-sm">
      <p className="font-semibold mb-2">{t("שדות נוספים שדורשים בדיקה בהגדרות התבניות או בפרטי האירוע:")}</p>
      <div className="text-xs text-muted-foreground space-y-1">{unmatched.map(x=><div key={x}>{x}</div>)}</div>
    </div>}
   </>}
   {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
   <DialogFooter className="flex gap-2 flex-wrap">
    <Button variant="outline" disabled={saving} onClick={()=>onOpenChange(false)}>{t("סגור")}</Button>
    <Button disabled={saving||loading} onClick={save}>
     {saving?t('שומר…'):t('שמור תרגומים')+(changed.length?' ('+changed.length+')':'')}
    </Button>
   </DialogFooter>
  </DialogContent>
 </Dialog>;
}
