import React,{useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Save,RefreshCw} from 'lucide-react';

// The production worker reads this existing policy, even though the stored
// policy.enabled flag is intentionally false: ONLY the owner's separate
// production switch authorizes outbound buttons. Editing the existing policy
// must not arm/unarm the switch, change recipient routing or create a test job.
const REQUIRED=[
 {action:'assignment_approve',title:'אישור שיבוץ'},
 {action:'assignment_reject',title:'דחיית שיבוץ'},
 {action:'contact_office',title:'פנייה למשרד'}
];
export default function WhatsAppLiveButtonSettings({active=false}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 const [saved,setSaved]=useState(null),[draft,setDraft]=useState(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editLabels,setEditLabels]=useState(false);

 async function load(){
  setBusy(true);setError('');setNotice('');
  try{
   const response=await base44.functions.invoke('WhatsAppQueueAdmin',{
    action:'interactiveGet',provider:'green'
   });
   const data=response.data;
   if(!data?.success||data.corrupt||!data.setting)
    throw Error('אי אפשר לטעון את הגדרות הכפתורים. לא בוצעו שינויים.');
   const policy=data.setting.policy;
   if(!REQUIRED.every(item=>policy?.buttons?.some(b=>b.action===item.action)))
    throw Error('מדיניות הכפתורים אינה שלמה. נדרשת בדיקת מנהל לפני עריכה.');
   setSaved(data.setting);
   setDraft({officeNumber:data.setting.officeNumber,
    policy:{...policy,enabled:false,
     buttons:policy.buttons.map(item=>({...item}))}});
  }catch(e){
   setSaved(null);setDraft(null);
   setError(e?.response?.data?.error||e?.message||'לא ניתן לטעון הגדרות.');
  }finally{setBusy(false);}
 }
 function editLabel(action,value){
  setDraft(previous=>({...previous,policy:{...previous.policy,
   buttons:previous.policy.buttons.map(item=>
    item.action===action?{...item,label:value}:item)}}));
 }
 async function save(){
  if(!draft||!saved||busy)return;
  const phone=draft.officeNumber;
  if(!/^[1-9][0-9]{7,14}$/.test(phone)){
   setError('מספר המשרד חייב להיות מספר בינלאומי (ספרות בלבד, בלי +).');return;
  }
  if(!REQUIRED.every(action=>{
   const label=draft.policy.buttons.find(b=>b.action===action.action)?.label;
   return typeof label==='string'&&label===label.trim()&&label.length>0&&
    label.length<=20&&!/[\u0000-\u001f\u007f]/.test(label);
  })){setError('יש להזין כיתוב קצר ותקין לכל אחד משלושת הכפתורים.');return;}
  if(active&&!window.confirm('לשמור הגדרות כפתורים? השינוי ישפיע על הודעות WhatsApp חדשות בלבד, ולא על הודעות שכבר נשלחו.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const response=await base44.functions.invoke('WhatsAppQueueAdmin',{
    action:'interactiveSave',provider:'green',
    expectedVersion:saved.version,messageKind:'assignment',
    officeNumber:phone,policy:{...draft.policy,enabled:false}
   });
   const data=response.data;
   if(!data?.success||!data.setting)
    throw Error(data?.error||'לא ניתן לשמור את הגדרות הכפתורים.');
   setSaved(data.setting);
   setDraft({officeNumber:data.setting.officeNumber,
    policy:{...data.setting.policy,enabled:false,
     buttons:data.setting.policy.buttons.map(b=>({...b}))}});
   setNotice('ההגדרות נשמרו. הודעות חדשות ישתמשו במספר ובכיתובים המעודכנים.');
  }catch(e){
   setError((e?.response?.data?.error||e?.message||'השמירה נכשלה')+
    (e?.response?.status===409?' ההגדרות השתנו בחלון אחר — רענן לפני שמירה.':''));
  }finally{setBusy(false);}
 }
 return <details className="rounded-lg border p-3 text-sm" open={open}
  onToggle={event=>{
   const value=event.currentTarget.open;
   setOpen(value);
   if(value&&!draft&&!busy)void load();
  }}>
  <summary className="cursor-pointer font-medium">מספר המשרד וכיתוב הכפתורים</summary>
  <div className="pt-3 space-y-3">
   <p className="text-xs text-gray-600">
    שינוי מספר המשרד משפיע על כפתור ״פנייה למשרד״ בהודעות חדשות.
    מספר זה אינו בהכרח המספר שממנו Green שולח הודעות.
   </p>
   {draft&&<>
    <div className="max-w-sm space-y-1">
     <Label htmlFor="wa-live-office-number">WhatsApp של המשרד</Label>
     <Input id="wa-live-office-number" dir="ltr" inputMode="numeric"
      maxLength={15} disabled={busy} value={draft.officeNumber}
      placeholder="972501234567"
      onChange={e=>setDraft(s=>({...s,officeNumber:e.target.value.trim()}))}/>
     <p className="text-xs text-gray-500">מספר בינלאומי בספרות בלבד. הודעות שכבר נשלחו לא ישתנו.</p>
    </div>
    <details open={editLabels} onToggle={e=>setEditLabels(e.currentTarget.open)}
     className="rounded border p-2">
     <summary className="cursor-pointer text-xs font-medium">עריכת שמות הכפתורים</summary>
     <div className="pt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
      {REQUIRED.map(item=><div className="space-y-1" key={item.action}>
       <Label htmlFor={'wa-label-'+item.action}>{item.title}</Label>
       <Input id={'wa-label-'+item.action} maxLength={20} disabled={busy}
        value={draft.policy.buttons.find(b=>b.action===item.action)?.label||''}
        onChange={e=>editLabel(item.action,e.target.value)}/>
      </div>)}
     </div>
    </details>
   </>}
   <div className="flex flex-wrap gap-2">
    <Button type="button" variant="outline" size="sm" disabled={busy}
     onClick={load}><RefreshCw className="h-4 w-4 ml-1"/>רענן הגדרות</Button>
    <Button type="button" size="sm" disabled={busy||!draft||!saved||
      JSON.stringify({officeNumber:draft.officeNumber,policy:draft.policy})===
      JSON.stringify({officeNumber:saved.officeNumber,policy:saved.policy})}
     onClick={save}><Save className="h-4 w-4 ml-1"/>שמור שינויים</Button>
   </div>
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
   {notice&&<p role="status" className="text-sm text-green-700">{notice}</p>}
  </div>
 </details>;
}
