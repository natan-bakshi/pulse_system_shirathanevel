import React,{useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Save,RefreshCw} from 'lucide-react';

// A friendly editor over the existing four SERVER-ALLOWLISTED Green sources.
// This is NOT one setting per NotificationTemplate record. That requires an
// independently persisted template identity in every outgoing Outbox job.
// Keep the truthful scope in UI; do not silently change working producers.
const SOURCES=[
 {id:'event_reminder',title:'תזכורת לאירוע לספק',
  description:'הודעות תזכורת לספקים לקראת אירוע'},
 {id:'supplier_pending_reminder',title:'תזכורת לאישור שיבוץ',
  description:'פנייה לספק שעדיין לא אישר או דחה שיבוץ'},
 {id:'scheduled_template',title:'התראות מתוזמנות לספקים',
  description:'הגדרה משותפת להודעות המתוזמנות שנשלחות לספקים'},
 {id:'manual_trigger',title:'הודעות ידניות לספקים',
  description:'כאשר מפעילים הודעת WhatsApp לספק באופן ידני'}
];
const OPTIONS=[
 {value:'both',text:'כניסה למערכת + פנייה למשרד'},
 {value:'portal',text:'כניסה למערכת בלבד'},
 {value:'office',text:'פנייה למשרד בלבד'},
 {value:'none',text:'ללא כפתורים (הודעה רגילה)'}
];
function modeFor(item){
 if(item?.portal&&item?.office)return 'both';
 if(item?.portal)return 'portal';
 if(item?.office)return 'office';
 return 'none';
}
function modeButtons(mode){
 return {portal:mode==='portal'||mode==='both',
  office:mode==='office'||mode==='both'};
}
export default function WhatsAppSupplierNoticeButtons({active=false}){
 const [saved,setSaved]=useState(null),[draft,setDraft]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');

 // The editor is mounted only in the explicitly selected "Buttons" tab.
 // No polling and no extra request for normal notifications-page entry.
 useEffect(()=>{void load();},[]);
 async function load(){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await base44.functions.invoke('WhatsAppQueueAdmin',{action:'supplierNavigationGet'});
   const data=result.data;
   if(!data?.success||data.corrupt||!data.setting)
    throw Error('אי אפשר לקרוא את הגדרות הכפתורים. לא בוצע שינוי.');
   setSaved(data.setting);
   setDraft(JSON.parse(JSON.stringify(data.setting.sources)));
  }catch(e){
   setError(e?.response?.data?.error||e?.message||'טעינת הגדרות הכפתורים נכשלה');
   setSaved(null);setDraft(null);
  }finally{setBusy(false);}
 }
 const edit=(source,field,value)=>setDraft(prev=>({...prev,
  [source]:{...prev[source],[field]:value}}));
 const editMode=(source,mode)=>setDraft(prev=>({...prev,
  [source]:{...prev[source],...modeButtons(mode)}}));
 const dirty=!!saved&&!!draft&&JSON.stringify(draft)!==JSON.stringify(saved.sources);
 async function save(){
  if(!saved||!draft||busy)return;
  if(active&&!window.confirm('לשמור את בחירת הכפתורים? השינוי ישפיע רק על הודעות WhatsApp חדשות מסוגים אלו.'))
   return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await base44.functions.invoke('WhatsAppQueueAdmin',{
    action:'supplierNavigationSave',expectedVersion:saved.version,sources:draft
   });
   const data=result.data;
   if(!data?.success||!data.setting)
    throw Error(data?.error||'שמירת הגדרות הכפתורים נכשלה');
   setSaved(data.setting);
   setDraft(JSON.parse(JSON.stringify(data.setting.sources)));
   setNotice('נשמר בהצלחה. רק הודעות חדשות ישתמשו בבחירה המעודכנת.');
  }catch(e){
   setError((e?.response?.data?.error||e?.message||'השמירה נכשלה')+
    (e?.response?.status===409?' ההגדרות השתנו במקום אחר — רענן לפני שמירה.':''));
  }finally{setBusy(false);}
 }
 return <section className="rounded-lg border p-4 space-y-4 text-sm" dir="rtl">
  <div className="space-y-1">
   <h3 className="font-semibold text-base">תזכורות והודעות לספקים</h3>
   <p className="text-gray-600">
    בחר מה יופיע בהודעת WhatsApp מכל סוג. לא צריך לכתוב קישור — המערכת מכינה אותו לבד.
   </p>
  </div>
  {busy&&!draft&&<p role="status" className="text-gray-500">טוען הגדרות כפתורים...</p>}
  {draft&&<div className="space-y-3">
   {SOURCES.map(source=>{
    const selected=draft[source.id];
    const mode=modeFor(selected);
    return <div key={source.id} className="rounded-lg border p-3 sm:p-4 space-y-3 bg-white">
     <div className="space-y-1">
      <h4 className="font-medium">{source.title}</h4>
      <p className="text-xs text-gray-500">{source.description}</p>
     </div>
     <label className="space-y-1 block">
      <span className="font-medium">אילו כפתורים יופיעו בהודעה?</span>
      <select className="block w-full sm:max-w-md rounded-md border bg-white px-3 py-2 text-sm"
       aria-label={'כפתורים עבור '+source.title}
       value={mode} disabled={busy}
       onChange={e=>editMode(source.id,e.target.value)}>
       {OPTIONS.map(option=><option key={option.value} value={option.value}>
        {option.text}
       </option>)}
      </select>
     </label>
     <div className="rounded-md bg-gray-50 border p-3 space-y-2">
      <p className="text-xs font-medium text-gray-600">תצוגה מקדימה — ללא שליחת הודעה</p>
      {mode==='none'?<p className="text-xs text-gray-500">
       ההודעה תישלח בטקסט רגיל, בלי כפתורים נוספים.
      </p>:<div className="space-y-2">
       <div className="flex flex-wrap gap-2">
        {selected.portal&&<span className="rounded-md bg-white border px-3 py-2 text-xs font-medium">
         {selected.portalLabel||'כניסה למערכת'}
        </span>}
        {selected.office&&<span className="rounded-md bg-white border px-3 py-2 text-xs font-medium">
         {selected.officeLabel||'פנייה למשרד'}
        </span>}
       </div>
       <p className="text-xs text-gray-600">
        {selected.portal&&'כניסה למערכת פותחת את לוח האירועים של הספק. '}
        {selected.office&&'פנייה למשרד פותחת שיחת WhatsApp עם מספר המשרד וטיוטת הודעה הכוללת את אסמכתת ההודעה.'}
       </p>
      </div>}
     </div>
     <details className="text-xs border-t pt-2">
      <summary className="cursor-pointer text-gray-600">שינוי הכיתוב שעל הכפתורים (לא חובה)</summary>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3">
       <label className="space-y-1">
        <span className="font-medium">שם כפתור הכניסה למערכת</span>
        <Input maxLength={25} disabled={busy||!selected.portal}
         value={selected.portalLabel||''} placeholder="כניסה למערכת"
         onChange={e=>edit(source.id,'portalLabel',e.target.value)}/>
       </label>
       <label className="space-y-1">
        <span className="font-medium">שם כפתור הפנייה למשרד</span>
        <Input maxLength={25} disabled={busy||!selected.office}
         value={selected.officeLabel||''} placeholder="פנייה למשרד"
         onChange={e=>edit(source.id,'officeLabel',e.target.value)}/>
       </label>
      </div>
     </details>
    </div>;
   })}
  </div>}
  <p className="text-xs text-gray-500">
   ההגדרות של ההודעות המתוזמנות משותפות כרגע לסוג השליחה, ולא נפרדות לכל תבנית.
   רק הודעות פרטיות לספק דרך Green שתומכות בכפתורים מקבלות אותם. שאר ההודעות נשארות כפי שהיו.
  </p>
  <div className="flex flex-wrap gap-2">
   <Button size="sm" variant="outline" disabled={busy} onClick={load}>
    <RefreshCw className="h-4 w-4 ml-1"/>רענן
   </Button>
   <Button size="sm" disabled={busy||!dirty} onClick={save}>
    <Save className="h-4 w-4 ml-1"/>שמור בחירת כפתורים
   </Button>
   {dirty&&<Button size="sm" variant="ghost" disabled={busy}
    onClick={()=>{setDraft(JSON.parse(JSON.stringify(saved.sources)));setError('');}}>
    בטל שינויים
   </Button>}
  </div>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
 </section>;
}
