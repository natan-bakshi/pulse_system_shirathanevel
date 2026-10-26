import React,{useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Switch} from '@/components/ui/switch';
import {Save,RefreshCw} from 'lucide-react';

// These are editable DRAFTS only. Live interactive sends stay fail-closed
// until provider signatures, inbound idempotency and supplier identity are ready.
const ACTIONS=[
  {action:'assignment_approve',title:'אישור שיבוץ',defaultLabel:'אישור שיבוץ'},
  {action:'assignment_reject',title:'דחיית שיבוץ',defaultLabel:'דחיית שיבוץ'},
  {action:'contact_office',title:'פנייה למשרד',defaultLabel:'פנייה למשרד'}
];
const emptyDraft={officeNumber:'',policy:{enabled:false,quoteAssignment:false,buttons:[]}};
export default function WhatsAppInteractiveDraftSettings(){
  const [expanded,setExpanded]=useState(false);
  const [provider,setProvider]=useState('green');
  const [draft,setDraft]=useState(null);
  const [version,setVersion]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  async function load(which=provider){
    setBusy(true);setError('');setNotice('');
    try{
      const response=await base44.functions.invoke('WhatsAppQueueAdmin',{action:'interactiveGet',provider:which});
      const data=response?.data;
      if(!data?.success)throw Error(data?.error||'טעינת הגדרות WhatsApp נכשלה');
      if(data.corrupt)throw Error('ההגדרות השמורות אינן תקינות. אין לדרוס אותן ללא בדיקת מנהל מערכת.');
      if(!data.setting||data.liveEnabled!==false)throw Error('לא התקבלה הגדרת טיוטה בטוחה');
      setDraft({officeNumber:data.setting.officeNumber,
        policy:{...data.setting.policy,enabled:false,
          buttons:[...(data.setting.policy.buttons||[])]}});
      setVersion(data.setting.version);
    }catch(e){
      setDraft(null);setVersion(null);
      setError(e?.response?.data?.error||e?.message||'הגדרות הטיוטה אינן זמינות');
    }finally{setBusy(false);}
  }
  function changeProvider(next){
    setProvider(next);setDraft(null);setVersion(null);setNotice('');setError('');
    if(expanded)void load(next);
  }
  function updateAction(action,selected){
    setDraft(s=>{
      if(!s)return s;
      const prior=s.policy.buttons;
      const buttons=selected?
        ACTIONS.filter(a=>a.action===action||prior.some(b=>b.action===a.action))
          .map(a=>prior.find(b=>b.action===a.action)||{action:a.action,label:a.defaultLabel}):
        prior.filter(b=>b.action!==action);
      return {...s,policy:{...s.policy,buttons}};
    });
  }
  async function save(){
    if(!draft||!version)return;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await base44.functions.invoke('WhatsAppQueueAdmin',{
        action:'interactiveSave',provider,expectedVersion:version,
        messageKind:'assignment',officeNumber:draft.officeNumber,
        policy:{...draft.policy,enabled:false}
      });
      const data=response?.data;
      if(!data?.success)throw Error(data?.error||'שמירת ההגדרות נכשלה');
      if(data.liveEnabled!==false)throw Error('תגובת שרת לא צפויה');
      setVersion(data.setting.version);
      setDraft({officeNumber:data.setting.officeNumber,policy:data.setting.policy});
      setNotice('טיוטת ההגדרות נשמרה בשרת. לא הופעלו כפתורים ולא נשלחו הודעות.');
    }catch(e){
      const message=e?.response?.data?.error||e?.message||'שמירת הטיוטה נכשלה';
      setError(message+(e?.response?.status===409?' יש לרענן לפני ניסיון נוסף.':''));
    }finally{setBusy(false);}
  }
  return <details className="rounded-lg border bg-white p-4" dir="rtl"
    open={expanded} onToggle={e=>{
      const next=e.currentTarget.open;
      setExpanded(next);
      if(next && version===null && !busy)void load(provider);
    }}>
    <summary className="cursor-pointer font-semibold">כפתורי תגובה להודעות שיבוץ — טיוטת הגדרות (לא פעיל)</summary>
    <p className="mt-3 text-sm text-amber-800">
      הגדרות ההודעות נשמרות בנפרד לכל ספק WhatsApp במערכת שירת הנבל.
      הכפתורים והציטוטים עדיין לא פעילים בהודעות אמת. הפעלה תתאפשר רק לאחר אימות אבטחת Webhook
      והשלמת מניעת תגובות כפולות ושיבוצים לא מעודכנים.
    </p>
    <div className="space-y-4 mt-3">
      <label className="block text-sm font-medium" htmlFor="interactive-wa-provider">ספק הודעות</label>
      <select id="interactive-wa-provider" value={provider} disabled={busy} onChange={e=>changeProvider(e.target.value)}
        className="border rounded-md px-3 py-2 text-sm">
        <option value="green">Green API</option>
        <option value="wasender">WasenderAPI</option>
      </select>
      {version!==null&&draft&&<div className="space-y-3 rounded-lg border p-3">
        <p className="text-xs text-gray-500">טיוטה בגרסה {version} · שייכת לשירת הנבל בלבד · מצב הפעלה: כבוי</p>
        {ACTIONS.map(a=>{
          const selected=draft.policy.buttons.find(b=>b.action===a.action);
          return <div key={a.action} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 min-w-[140px] text-sm">
              <input type="checkbox" checked={!!selected} disabled={busy}
                onChange={e=>updateAction(a.action,e.target.checked)}/>{a.title}
            </label>
            {selected&&<Input className="max-w-[240px]" aria-label={'כיתוב כפתור '+a.title}
              value={selected.label} disabled={busy} maxLength={20}
              onChange={e=>setDraft(s=>({...s,policy:{...s.policy,
                buttons:s.policy.buttons.map(b=>b.action===a.action?{...b,label:e.target.value}:b)}}))}/>}
          </div>;
        })}
        <label className="block space-y-1 text-sm">
          <span>מספר WhatsApp של המשרד (בפורמט בינלאומי, ספרות בלבד)</span>
          <Input value={draft.officeNumber} maxLength={15} disabled={busy} inputMode="numeric"
            placeholder="972501234567" className="max-w-[260px]" dir="ltr"
            onChange={e=>setDraft(s=>({...s,officeNumber:e.target.value}))}/>
          <span className="block text-xs text-gray-500">משמש בתכנון לכפתור ״פנייה למשרד״; עדיין לא נשלח ללקוחות.</span>
        </label>
        <label className="flex gap-2 items-center text-sm">
          <Switch checked={draft.policy.quoteAssignment} disabled={busy}
            onCheckedChange={quoteAssignment=>setDraft(s=>({...s,policy:{...s.policy,quoteAssignment}}))}/>
          לכלול ציטוט להודעת השיבוץ המקורית בתזכורות ובביטולים (כשייתמך)
        </label>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>load()}>
          <RefreshCw className="h-4 w-4 ml-2"/>רענן טיוטה
        </Button>
        <Button size="sm" disabled={busy||!draft||version===null} onClick={save}>
          <Save className="h-4 w-4 ml-2"/>שמור טיוטה בלבד
        </Button>
      </div>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice&&<p role="status" className="text-sm text-green-700">{notice}</p>}
      <p className="text-xs text-gray-500">ללא משלוח הודעות, ללא שינוי סטטוס ספק וללא שינוי מרווחי התור. טיוטה זו אינה אישור להפעלת הכפתורים.</p>
    </div>
  </details>;
}
