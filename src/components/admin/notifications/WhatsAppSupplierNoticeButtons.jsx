import React,{useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Save,RefreshCw} from 'lucide-react';

// Separate four already-supported supplier URL-only message sources.
// Does not add reply actions, modify assignment decisions or activate any
// rollout switch. Reads ONLY when explicitly opened in owner settings.
const SOURCES=[
 ['event_reminder','תזכורת לאירוע'],
 ['supplier_pending_reminder','תזכורת לאישור שיבוץ'],
 ['scheduled_template','הודעה מתוזמנת לספק'],
 ['manual_trigger','הודעה ידנית לספק']
];
export default function WhatsAppSupplierNoticeButtons({active=false}){
 const [open,setOpen]=useState(false),[saved,setSaved]=useState(null),[draft,setDraft]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editText,setEditText]=useState(false);
 async function load(){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await base44.functions.invoke('WhatsAppQueueAdmin',{action:'supplierNavigationGet'});
   const data=result.data;
   if(!data?.success||data.corrupt||!data.setting)
    throw Error('הגדרות כפתורי התזכורות אינן תקינות. לא בוצע שינוי.');
   setSaved(data.setting);
   setDraft(JSON.parse(JSON.stringify(data.setting.sources)));
  }catch(e){setError(e?.response?.data?.error||e?.message||'טעינת ההגדרות נכשלה');setSaved(null);setDraft(null);}
  finally{setBusy(false);}
 }
 const edit=(source,field,value)=>setDraft(prev=>({...prev,
  [source]:{...prev[source],[field]:value}}));
 async function save(){
  if(!saved||!draft||busy)return;
  if(active&&!window.confirm('לשמור כפתורים לפי סוג הודעה? הבחירה תשפיע רק על הודעות חדשות שנשלחות דרך Green; אין שליחת ניסיון.'))
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
   setNotice('ההגדרות נשמרו עבור הודעות חדשות. הודעות שכבר נשלחו לא ישתנו.');
  }catch(e){
   setError((e?.response?.data?.error||e?.message||'השמירה נכשלה')+
    (e?.response?.status===409?' ההגדרות עודכנו במקום אחר. רענן ונסה שוב.':''));
  }finally{setBusy(false);}
 }
 const dirty=!!saved&&!!draft&&JSON.stringify(draft)!==JSON.stringify(saved.sources);
 return <details className="rounded border p-3 text-sm" open={open}
  onToggle={e=>{const value=e.currentTarget.open;setOpen(value);
   if(value&&!saved&&!busy)void load();
  }}>
  <summary className="cursor-pointer font-medium">כפתורים לפי סוג הודעה לספק</summary>
  <div className="pt-3 space-y-3">
   <p className="text-xs text-gray-600">
    בחר אילו קישורים יופיעו בתזכורות ובהודעות לספקים. ללא כפתורים, ההודעה תישלח כטקסט רגיל.
    אישור ודחיית שיבוץ נשארים בהגדרות הנפרדות של השיבוצים. קבוצות, מסמכים וספק Wasender אינם משתנים.
   </p>
   {draft&&<div className="space-y-2">
    {SOURCES.map(([source,title])=><div key={source}
     className="rounded border p-3 space-y-2">
     <div className="font-medium">{title}</div>
     <div className="flex flex-wrap gap-x-6 gap-y-2">
      <label className="flex items-center gap-2">
       <input type="checkbox" disabled={busy}
        checked={draft[source]?.portal===true}
        onChange={e=>edit(source,'portal',e.target.checked)}/>
       כניסה למערכת
      </label>
      <label className="flex items-center gap-2">
       <input type="checkbox" disabled={busy}
        checked={draft[source]?.office===true}
        onChange={e=>edit(source,'office',e.target.checked)}/>
       פנייה למשרד
      </label>
     </div>
     {editText&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label className="space-y-1">
       <span className="text-xs">כיתוב כניסה למערכת</span>
       <Input maxLength={25} disabled={busy||!draft[source]?.portal}
        value={draft[source]?.portalLabel||''} placeholder="ברירת מחדל"
        onChange={e=>edit(source,'portalLabel',e.target.value)}/>
      </label>
      <label className="space-y-1">
       <span className="text-xs">כיתוב פנייה למשרד</span>
       <Input maxLength={25} disabled={busy||!draft[source]?.office}
        value={draft[source]?.officeLabel||''} placeholder="ברירת מחדל"
        onChange={e=>edit(source,'officeLabel',e.target.value)}/>
      </label>
     </div>}
    </div>)}
    <label className="flex gap-2 items-center text-xs">
     <input type="checkbox" disabled={busy} checked={editText}
      onChange={e=>setEditText(e.target.checked)}/>
     התאמה אישית של כיתובי הכפתורים
    </label>
   </div>}
   <div className="flex flex-wrap gap-2">
    <Button size="sm" variant="outline" disabled={busy} onClick={load}>
     <RefreshCw className="h-4 w-4 ml-1"/>רענן הגדרות
    </Button>
    <Button size="sm" disabled={busy||!dirty} onClick={save}>
     <Save className="h-4 w-4 ml-1"/>שמור כפתורים לפי סוג הודעה
    </Button>
   </div>
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
   {notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
  </div>
 </details>;
}
