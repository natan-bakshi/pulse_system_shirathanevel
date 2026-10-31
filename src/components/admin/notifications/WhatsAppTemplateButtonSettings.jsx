import React,{useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Save,RefreshCw} from 'lucide-react';

// Actual NotificationTemplate overrides. No raw URLs or arbitrary functions.
// The owner policy is verified against live template IDs on the SERVER.
const options=[
 {value:'inherit',label:'לפי ברירת המחדל של סוג ההודעה'},
 {value:'both',label:'כניסה למערכת + פנייה למשרד'},
 {value:'portal',label:'כניסה למערכת בלבד'},
 {value:'office',label:'פנייה למשרד בלבד'},
 {value:'none',label:'ללא כפתורים'}
];
const defaults={portalLabel:'',officeLabel:''};
function supported(t){
 return t&&/^[A-Za-z0-9_-]{12,64}$/.test(t.id||'')&&
  t.allowed_channels?.includes('whatsapp')&&t.target_audiences?.includes('supplier')&&
  (['SUPPLIER_EVENT_REMINDER','SUPPLIER_PENDING_REMINDER'].includes(t.type)||
  (!['SUPPLIER_NEW_ASSIGNMENT','SUPPLIER_ASSIGNMENT_UPDATE','CANCEL_SUPPLIER'].includes(t.type)&&
   ['scheduled_check','manual'].includes(t.trigger_type)));
}
function modeOf(v){
 if(!v)return 'inherit';
 if(v.portal&&v.office)return 'both';
 if(v.portal)return 'portal';
 if(v.office)return 'office';
 return 'none';
}
function toButtons(mode,previous){
 return {...defaults,...previous,portal:mode==='portal'||mode==='both',
  office:mode==='office'||mode==='both'};
}
export default function WhatsAppTemplateButtonSettings({templates=[],focusTemplateId=''}){
 const supportedTemplates=templates.filter(supported);
 const [stored,setStored]=useState(null),[draft,setDraft]=useState(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [expanded,setExpanded]=useState(!!focusTemplateId);
 useEffect(()=>{if(focusTemplateId)setExpanded(true);},[focusTemplateId]);
 useEffect(()=>{
  if(!focusTemplateId||!stored)return;
  const el=document.getElementById('wa-template-'+focusTemplateId);
  if(el)el.scrollIntoView({block:'nearest',behavior:'smooth'});
 },[focusTemplateId,stored]);
 const [editingLabels,setEditingLabels]=useState({});
 async function load(){
  if(busy)return;
  setBusy(true);setError('');setMessage('');
  try{
   const result=await base44.functions.invoke('WhatsAppQueueAdmin',{action:'supplierTemplateButtonsGet'});
   const data=result.data;
   if(!data?.success||data.corrupt||!data.setting)
    throw Error('הגדרות הכפתורים לפי תבנית אינן זמינות. לא בוצע שינוי.');
   setStored(data.setting);
   setDraft(JSON.parse(JSON.stringify(data.setting.templates)));
  }catch(e){
   setError(e?.response?.data?.error||e?.message||'לא ניתן לטעון את הכפתורים');
   setStored(null);setDraft(null);
  }finally{setBusy(false);}
 }
 useEffect(()=>{if(expanded&&!stored&&!busy)void load();},[expanded]);
 const editMode=(id,mode)=>setDraft(prior=>{
  const next={...prior};
  if(mode==='inherit')delete next[id];
  else next[id]=toButtons(mode,prior?.[id]);
  return next;
 });
 const editLabel=(id,key,value)=>setDraft(prior=>({
  ...prior,[id]:{...prior[id],[key]:value}
 }));
 const dirty=!!stored&&!!draft&&JSON.stringify(draft)!==JSON.stringify(stored.templates);
 async function save(){
  if(!dirty||busy)return;
  if(!window.confirm('לשמור כפתורים לתבניות התראה? ההגדרות יחולו על הודעות חדשות בלבד.'))return;
  setBusy(true);setError('');setMessage('');
  try{
   const res=await base44.functions.invoke('WhatsAppQueueAdmin',{
    action:'supplierTemplateButtonsSave',expectedVersion:stored.version,
    templates:draft
   });
   const data=res.data;
   if(!data?.success||!data.setting)throw Error(data?.error||'השמירה נכשלה');
   setStored(data.setting);
   setDraft(JSON.parse(JSON.stringify(data.setting.templates)));
   setMessage('נשמר. ההגדרה תחול על הודעות חדשות מהתבנית הזאת בלבד.');
  }catch(e){
   setError((e?.response?.data?.error||e?.message||'השמירה נכשלה')+
    (e?.response?.status===409?' הנתונים השתנו בחלון אחר. רענן לפני שמירה.':''));
  }finally{setBusy(false);}
 }
 return <details className="border rounded-lg p-4 text-sm" dir="rtl"
  open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}>
  <summary className="cursor-pointer font-semibold text-base">
   התאמת כפתורים לתבנית התראה מסוימת
  </summary>
  <div className="pt-3 space-y-4">
   <p className="text-gray-600">אפשר להשאיר כל תבנית על ברירת המחדל, או לתת לה כפתורים משלה.
    הבחירה לא תשנה התראות אחרות. אין צורך להקליד קישור.</p>
   {busy&&!draft&&<p role="status">טוען תבניות...</p>}
   {draft&&supportedTemplates.length===0&&<p className="text-gray-600">
    אין כרגע תבניות WhatsApp לספקים שזכאיות לכפתורי קישור נפרדים.</p>}
   {draft&&supportedTemplates.map(t=>{
    const v=draft[t.id],mode=modeOf(v);
    return <div key={t.id} id={'wa-template-'+t.id}
     className={'rounded border p-3 space-y-2 bg-white '+
      (focusTemplateId===t.id?'ring-2 ring-green-600':'')}>
     <div className="flex flex-wrap justify-between gap-2 items-center">
      <div>
       <h4 className="font-medium">{t.name}</h4>
       <p className="text-xs text-gray-500">{t.is_active?'התראה פעילה':'התראה כבויה'} · {t.type}</p>
      </div>
     </div>
     <label className="block space-y-1">
      <span className="text-xs font-medium">כפתורים בהודעת WhatsApp של התבנית</span>
      <select className="border rounded-md p-2 w-full sm:max-w-md bg-white"
       value={mode} disabled={busy}
       aria-label={'כפתורים לתבנית '+t.name}
       onChange={e=>editMode(t.id,e.target.value)}>
       {options.map(o=><option value={o.value} key={o.value}>{o.label}</option>)}
      </select>
     </label>
     {mode!=='inherit'&&<div className="rounded border bg-gray-50 p-3 space-y-2">
      <p className="text-xs text-gray-600">תצוגה מקדימה — בלי לשלוח הודעה</p>
      {mode==='none'?<p className="text-xs">הודעה רגילה ללא כפתורים.</p>:
      <div className="flex flex-wrap gap-2">
       {v?.portal&&<span className="rounded border bg-white px-3 py-2 text-xs">
        {v.portalLabel||'כניסה למערכת'}
       </span>}
       {v?.office&&<span className="rounded border bg-white px-3 py-2 text-xs">
        {v.officeLabel||'פנייה למשרד'}
       </span>}
      </div>}
      {v?.portal&&<p className="text-xs text-gray-600">כניסה למערכת: לוח האירועים של הספק.</p>}
      {v?.office&&<p className="text-xs text-gray-600">
       פנייה למשרד: שיחת WhatsApp עם המשרד והודעת פתיחה הכוללת אסמכתא.</p>}
      <label className="flex items-center gap-2 text-xs">
       <input type="checkbox" disabled={busy} checked={editingLabels[t.id]===true}
        onChange={e=>setEditingLabels(s=>({...s,[t.id]:e.target.checked}))}/>
       התאמת שמות הכפתורים
      </label>
      {editingLabels[t.id]&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
       <label className="space-y-1">
        <span>שם כפתור הכניסה</span>
        <Input maxLength={25} disabled={busy||!v?.portal}
         value={v?.portalLabel||''} placeholder="כניסה למערכת"
         onChange={e=>editLabel(t.id,'portalLabel',e.target.value)}/>
       </label>
       <label className="space-y-1">
        <span>שם כפתור המשרד</span>
        <Input maxLength={25} disabled={busy||!v?.office}
         value={v?.officeLabel||''} placeholder="פנייה למשרד"
         onChange={e=>editLabel(t.id,'officeLabel',e.target.value)}/>
       </label>
      </div>}
     </div>}
    </div>;
   })}
   <p className="text-xs text-gray-500">
    מיועד לתזכורות ולהודעות מתוזמנות לספקים שנשלחות דרך Green. כפתורי אישור ודחיית שיבוץ
    ממשיכים לעבוד במסלול השיבוצים הקיים. תבניות של לקוחות ומנהלים אינן מושפעות.
   </p>
   <div className="flex flex-wrap gap-2">
    <Button size="sm" variant="outline" disabled={busy} onClick={load}>
     <RefreshCw className="h-4 w-4 ml-1"/>רענן
    </Button>
    <Button size="sm" disabled={busy||!dirty} onClick={save}>
     <Save className="h-4 w-4 ml-1"/>שמור כפתורים לתבניות
    </Button>
    {dirty&&<Button size="sm" variant="ghost" disabled={busy}
     onClick={()=>setDraft(JSON.parse(JSON.stringify(stored.templates)))}>
     בטל שינויים
    </Button>}
   </div>
   {message&&<p role="status" className="text-green-800">{message}</p>}
   {error&&<p role="alert" className="text-red-700">{error}</p>}
  </div>
 </details>;
}
