import React,{forwardRef,useEffect,useImperativeHandle,useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {RefreshCw,Save} from 'lucide-react';
import WhatsAppCustomButtonEditor,{newCustomSupplierButtons}
 from './WhatsAppCustomButtonEditor';
import {useLanguage} from '@/i18n/LanguageProvider';

const choices=[
 {value:'inherit',label:'כמו ברירת המחדל לסוג ההתראה'},
 {value:'both',label:'כניסה למערכת + פנייה למשרד'},
 {value:'portal',label:'כניסה למערכת בלבד'},
 {value:'office',label:'פנייה למשרד בלבד'},
 {value:'none',label:'ללא כפתורים'},
 {value:'custom',label:'כפתורים מותאמים אישית'}
];
function supported(t){
 return !!(t?.id&&/^[A-Za-z0-9_-]{12,64}$/.test(t.id)&&
  t.allowed_channels?.includes('whatsapp')&&
  t.target_audiences?.includes('supplier')&&
  (['SUPPLIER_EVENT_REMINDER','SUPPLIER_PENDING_REMINDER'].includes(t.type)||
   (!['SUPPLIER_NEW_ASSIGNMENT','SUPPLIER_ASSIGNMENT_UPDATE','CANCEL_SUPPLIER'].includes(t.type)&&
    ['scheduled_check','manual'].includes(t.trigger_type))));
}
function modeOf(value){
 if(!value)return 'inherit';
 if(value.kind==='custom')return 'custom';
 return value.portal&&value.office?'both':value.portal?'portal':value.office?'office':'none';
}
function messageOf(error){
 const text=String(error?.response?.data?.error||error?.message||'');
 if(/version_conflict|version_race/.test(text)||error?.response?.status===409)
  return 'מישהו עדכן את הכפתורים במקביל. לחץ על רענן לפני שמירה נוספת.';
 if(/https_url_required|invalid_url|public_https_only|url_too_long/.test(text))
  return 'כתובת הקישור החיצוני חייבת להיות קישור HTTPS ציבורי ותקין.';
 if(/smart_event_link_requires_event_source/.test(text))
  return 'התבנית הזו אינה מספקת מזהה אירוע מאומת לצורך קישור חכם.';
 if(/reply_requires_supplier_event_reminder/.test(text))
  return 'אפשר להגדיר תגובת קבלה רק בתזכורת אירוע לספק.';
 return text||'העדכון נכשל. ההגדרות לא נשמרו.';
}
const WhatsAppTemplateButtonsTab=forwardRef(function WhatsAppTemplateButtonsTab({
 template
},ref){
  const {t: uiTranslate}=useLanguage();
 const [stored,setStored]=useState(null);
 const [value,setValue]=useState(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [editingLabels,setEditingLabels]=useState(false);
 const eligible=supported(template);
 const templateId=template?.id||'';
 async function load(){
  if(!eligible||busy)return false;
  setBusy(true);setError('');setMessage('');
  try{
   const response=await base44.functions.invoke('WhatsAppQueueAdmin',{
    action:'supplierTemplateButtonsGet'
   });
   const data=response.data;
   if(!data?.success||!data.setting||data.corrupt)
    throw Error('לא ניתן לקרוא את הגדרות הכפתורים.');
   setStored(data.setting);
   setValue(data.setting.templates?.[templateId]||null);
   return true;
  }catch(e){setError(messageOf(e));return false;
  }finally{setBusy(false);}
 }
 useEffect(()=>{
  setStored(null);setValue(null);setMessage('');setError('');
  if(!eligible)return;
  let disposed=false;
  (async()=>{
   try{
    const response=await base44.functions.invoke('WhatsAppQueueAdmin',{
     action:'supplierTemplateButtonsGet'
    });
    if(disposed)return;
    const data=response.data;
    if(!data?.success||!data.setting||data.corrupt)throw Error('ההגדרות אינן זמינות.');
    setStored(data.setting);setValue(data.setting.templates?.[templateId]||null);
   }catch(e){if(!disposed)setError(messageOf(e));}
  })();
  return ()=>{disposed=true;};
 },[templateId,eligible]);
 const initial=stored?.templates?.[templateId]||null;
 const dirty=!!stored&&JSON.stringify(value)!==JSON.stringify(initial);
 async function save(){
  if(!eligible||!stored||busy||!dirty)return !dirty;
  setBusy(true);setError('');setMessage('');
  try{
   const templates={...stored.templates};
   if(value===null)delete templates[templateId];else templates[templateId]=value;
   const response=await base44.functions.invoke('WhatsAppQueueAdmin',{
    action:'supplierTemplateButtonsSave',expectedVersion:stored.version,
    templates
   });
   const result=response.data;
   if(!result?.success||!result.setting)throw Error(result?.error||'השמירה נכשלה.');
   setStored(result.setting);
   setValue(result.setting.templates?.[templateId]||null);
   setMessage('כפתורי התבנית נשמרו. השינוי יחול על הודעות חדשות בלבד.');
   return true;
  }catch(e){setError(messageOf(e));return false;
  }finally{setBusy(false);}
 }
 useImperativeHandle(ref,()=>({hasPendingChanges:()=>dirty,save}),[dirty,busy,stored,value,templateId]);
 const updateMode=(mode)=>{
  if(mode==='inherit')setValue(null);
  else if(mode==='custom')setValue(value?.kind==='custom'?value:newCustomSupplierButtons());
  else setValue({portal:mode==='portal'||mode==='both',
   office:mode==='office'||mode==='both',
   portalLabel:modeOf(value)==='custom'?'':value?.portalLabel||'',
   officeLabel:modeOf(value)==='custom'?'':value?.officeLabel||''});
 };
 if(!templateId)return <p className="p-4 rounded-md border text-sm">
  {uiTranslate("שמור תחילה את התבנית החדשה. לאחר יצירתה אפשר יהיה להגדיר כאן את הכפתורים שלה.")}
 </p>;
 if(!eligible)return <div className="p-4 rounded-md border text-sm space-y-2">
  <strong>{uiTranslate("הודעה זו אינה משתמשת בכפתורים מותאמים במסלול הנוכחי.")}</strong>
  <p className="text-gray-600">
   {uiTranslate("התאמה אישית זמינה בשלב זה לתבניות WhatsApp לספקים. אישור ודחיית שיבוץ מנוהלים במנגנון נפרד ומאובטח תחת הגדרות WhatsApp. ההתראות ללקוחות ולמנהלים אינן מושפעות.")}
  </p>
 </div>;
 return <div className="space-y-4 text-sm" dir="rtl">
  <p className="text-gray-600">
   {uiTranslate("הכפתורים שייכים לתבנית הזו בלבד. בחר כפתורים, סדר וכיתוב. הם אינם משנים שיבוצים או פעולות עסקיות.")}
  </p>
  {!stored&&!error&&<p role="status">{uiTranslate("טוען הגדרות כפתורים…")}</p>}
  {stored&&<>
   <label className="block space-y-1">
    <span className="text-sm font-medium">{uiTranslate("אילו כפתורים יופיעו?")}</span>
    <select aria-label={uiTranslate("בחירת כפתורים לתבנית")}
     className="w-full rounded-md border bg-white p-2"
     disabled={busy} value={modeOf(value)}
     onChange={e=>updateMode(e.target.value)}>
     {choices.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
   </label>
   {modeOf(value)==='custom'&&<WhatsAppCustomButtonEditor
    template={template} value={value} busy={busy}
    onChange={setValue}/>}
   {!['custom','inherit'].includes(modeOf(value))&&<div className="rounded-md border p-3 space-y-2 bg-gray-50">
    <p className="text-xs font-medium">{uiTranslate("תצוגה מקדימה")}</p>
    <div className="flex flex-wrap gap-2">
     {value?.portal&&<span className="rounded border bg-white px-3 py-2 text-xs">
      {value.portalLabel||'כניסה למערכת'}
     </span>}
     {value?.office&&<span className="rounded border bg-white px-3 py-2 text-xs">
      {value.officeLabel||'פנייה למשרד'}
     </span>}
     {!value?.portal&&!value?.office&&<span>{uiTranslate("ללא כפתורים")}</span>}
    </div>
    {(value?.portal||value?.office)&&<label className="flex gap-2 items-center text-xs">
     <input type="checkbox" checked={editingLabels}
      disabled={busy} onChange={e=>setEditingLabels(e.target.checked)}/>
     {uiTranslate("שינוי כיתוב הכפתורים")}
    </label>}
    {editingLabels&&<div className="grid sm:grid-cols-2 gap-2">
     <label className="space-y-1">{uiTranslate("כיתוב הכניסה")}
      <Input maxLength={25} disabled={busy||!value?.portal}
       value={value?.portalLabel||''}
       onChange={e=>setValue(x=>({...x,portalLabel:e.target.value}))}/>
     </label>
     <label className="space-y-1">{uiTranslate("כיתוב הפנייה למשרד")}
      <Input maxLength={25} disabled={busy||!value?.office}
       value={value?.officeLabel||''}
       onChange={e=>setValue(x=>({...x,officeLabel:e.target.value}))}/>
     </label>
    </div>}
   </div>}
   {modeOf(value)==='inherit'&&<p className="text-xs text-gray-600">
    {uiTranslate("התבנית תשתמש בכפתורי ברירת המחדל שנקבעו לסוג ההתראה.")}
   </p>}
   <p className="text-xs text-gray-500">
    {uiTranslate("שמירת הכפתורים מתבצעת דרך שרת ההגדרות המאובטח, בנפרד מנתוני התבנית הרגילים. גם הכפתור ״שמור״ של חלון התבנית שומר אותם אם שינית כאן משהו. הודעות שכבר ממתינות בתור אינן משתנות.")}
   </p>
   <div className="flex flex-wrap gap-2">
    <Button type="button" size="sm" disabled={busy||!dirty} onClick={save}>
     <Save className="h-4 w-4 ml-1"/>{uiTranslate("שמור כפתורים")}
    </Button>
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={load}>
     <RefreshCw className="h-4 w-4 ml-1"/>{uiTranslate("רענן")}
    </Button>
    {dirty&&<Button type="button" size="sm" variant="ghost"
     disabled={busy} onClick={()=>setValue(initial)}>{uiTranslate("בטל שינויי כפתורים")}</Button>}
   </div>
  </>}
  {message&&<p role="status" className="text-green-800">{message}</p>}
  {error&&<p role="alert" className="text-red-700">{error}</p>}
 </div>;
});
export default WhatsAppTemplateButtonsTab;
