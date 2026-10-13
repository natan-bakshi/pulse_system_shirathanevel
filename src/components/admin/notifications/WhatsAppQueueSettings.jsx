import React, {useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Switch} from '@/components/ui/switch';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {RefreshCw,Save,Play,AlertTriangle} from 'lucide-react';
import WhatsAppQueueMessages from './WhatsAppQueueMessages';

const defaults={enabled:false,paused:false,wasenderIntervalMs:7000,greenIntervalMs:7000,maxMessagesPerRun:16};
function IntervalEditor({name,which,ms,unit,onUnit,onMs,disabled}){
  const factor=unit==='seconds'?1000:1;
  return <div className="rounded-lg border p-3 space-y-2 min-w-[230px]">
    <div className="font-semibold">{name}</div>
    <div className="flex gap-2">
      <Input aria-label={'מרווח '+name} type="number" min="0" max={300000/factor} step={unit==='seconds'?'0.001':'1'}
        disabled={disabled} value={ms/factor} onChange={e=>{
          const value=Number(e.target.value);
          onMs(Number.isFinite(value)?Math.round(value*factor):0);
        }}/>
      <select aria-label={'יחידות '+name} className="border rounded-md px-2 text-sm" value={unit}
        disabled={disabled} onChange={e=>onUnit(e.target.value)}>
        <option value="seconds">שניות</option><option value="milliseconds">מילישניות</option>
      </select>
    </div>
    {which==='wasender'&&ms<5000&&<p className="text-xs text-amber-700">
      אם Account Protection מופעל ב־WasenderAPI, מרווח קצר מחמש שניות עלול לגרום להגבלת קצב.
    </p>}
    <p className="text-xs text-gray-500">0 = ללא השהיה, אך עדיין רק עובד תור אחד פועל.</p>
  </div>;
}
export default function WhatsAppQueueSettings(){
  const [form,setForm]=useState(defaults),[view,setView]=useState(null);
  const [units,setUnits]=useState({wasender:'seconds',green:'seconds'});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [refreshSignal,setRefreshSignal]=useState(0);
  const apply=data=>{setView(data);if(data?.config)setForm(data.config);};
  const read=async()=>{
    const res=await base44.functions.invoke('WhatsAppQueueAdmin',{action:'status'});
    if(!res.data?.success)throw Error(res.data?.error||'קריאת התור נכשלה');
    apply(res.data);setRefreshSignal(n=>n+1);
  };
  useEffect(()=>{
    let alive=true;
    base44.functions.invoke('WhatsAppQueueAdmin',{action:'status'})
      .then(r=>{if(alive&&r.data?.success)apply(r.data);})
      .catch(()=>{if(alive)setError('לא ניתן לטעון את תור WhatsApp. בדוק שהפונקציות פורסמו.');});
    return()=>{alive=false;};
  },[]);
  async function run(action,params={}){
    if(action==='configure'&&view&&!view.config.enabled&&form.enabled&&
      !window.confirm('הפעלת התור משנה את מסלול ה־WhatsApp לכל המערכת. ודא שאוטומציות הרקע ועובד התור פורסמו ונבדקו. להמשיך?'))return;
    setBusy(true);setError('');setNotice('');
    try{
      const res=await base44.functions.invoke('WhatsAppQueueAdmin',{action,...params});
      if(action==='diagnose'){
        const data=res.data||{};
        const checks=(data.checks||[]).map(x=>x.step+': '+(x.ok?'תקין':'שגיאה ('+(x.kind||'unknown')+')')).join(' | ');
        const msg='אבחון ללא שליחה: '+checks+(data.failedStep?' | שלב שנכשל: '+data.failedStep:'');
        if(!data.success)setError(msg||'אבחון התור נכשל');else setNotice(msg||'בדיקת התור עברה בהצלחה');
        return;
      }
      if(!res.data?.success)throw Error(res.data?.error||'הפעולה לא הצליחה');
      if(action==='kick'){
        const job=res.data.dispatch||{};
        setNotice(job.reason==='disabled'?'התור כבוי':job.reason==='busy'?'עובד אחר פעיל':
          job.reason==='blocked'?'עובד התור חסום; בדוק את השגיאה':'התקבלו אצל ספק: '+(job.accepted||0)+', תוצאות לא ידועות: '+(job.unknown||0));
        await read();
      }else if(action==='configure'){
        apply(res.data);setRefreshSignal(n=>n+1);setNotice('הגדרות קצב השליחה לכל ספק נשמרו.');
      }else await read();
    }catch(e){setError(e?.response?.data?.error||e?.message||'הפעולה נכשלה');}
    finally{setBusy(false);}
  }
  const totals=view?.totals||{};
  return <details className="rounded-lg border bg-white p-4" dir="rtl">
    <summary className="cursor-pointer font-semibold text-base">תור WhatsApp מרכזי — קצב לכל ספק וניהול הודעות</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-gray-600">כל סוגי ההודעות עוברים באותו תור. הודעה ראשונה נשלחת מיד כשהתור פנוי; המרווח מוגדר לכל ספק בנפרד, בשניות או במילישניות.</p>
      {!form.enabled&&<p role="alert" className="text-sm rounded border bg-amber-50 p-3 text-amber-800">
        התור המרכזי כבוי. המסלול הישיר הישן נשאר פעיל עד להפעלה מבוקרת.
      </p>}
      {view&&<div className="flex flex-wrap gap-x-5 gap-y-2 rounded bg-gray-50 border p-3 text-sm">
        <span>ספק: <strong>{view.activeProvider==='wasender'?'WasenderAPI':'Green API'}</strong></span>
        <span>ממתינות: <strong>{(totals.queued||0)+(totals.retry_wait||0)}</strong></span>
        <span>התקבלו אצל ספק: <strong>{totals.accepted||0}</strong></span>
        <span>נכשלו: <strong>{totals.failed||0}</strong></span>
        <span>לא ידוע: <strong>{totals.unknown||0}</strong></span>
        <span>{view.workerBusy?'עובד התור פעיל':'עובד התור פנוי'}</span>
        <span>מרווח פעיל: <strong>{view.currentIntervalMs}ms</strong></span>
        <span>{view.nextAllowedInMs>0?'מרווח נותר '+(view.nextAllowedInMs/1000).toFixed(2)+' שניות':'מוכן לשליחה ללא המתנה'}</span>
        {view.lastWorkerAt&&<span>עובד נבדק: {new Date(view.lastWorkerAt).toLocaleString('he-IL')}</span>}
        {view.lastError&&<span className="text-red-700">תקלה: {view.lastError}</span>}
      </div>}
      <div className="flex flex-wrap gap-6">
        <label className="flex gap-2 items-center text-sm"><Switch checked={!!form.enabled} disabled={busy} onCheckedChange={enabled=>setForm(s=>({...s,enabled}))}/>הפעל תור מרכזי</label>
        <label className="flex gap-2 items-center text-sm"><Switch checked={!!form.paused} disabled={busy} onCheckedChange={paused=>setForm(s=>({...s,paused}))}/>השהה שליחות חדשות</label>
      </div>
      <div className="flex flex-wrap gap-3">
        {['wasender','green'].map(which=><IntervalEditor key={which} name={which==='wasender'?'WasenderAPI':'Green API'}
          which={which} ms={form[which+'IntervalMs']??7000} unit={units[which]} disabled={busy}
          onUnit={unit=>setUnits(s=>({...s,[which]:unit}))}
          onMs={value=>setForm(s=>({...s,[which+'IntervalMs']:value}))}/>)}
      </div>
      <div className="space-y-1 max-w-xs">
        <Label htmlFor="wa-queue-batch">הודעות מרביות בכל ריצת עובד</Label>
        <Input id="wa-queue-batch" type="number" step="1" min="1" max="30" disabled={busy}
          value={form.maxMessagesPerRun} onChange={e=>setForm(s=>({...s,maxMessagesPerRun:Number(e.target.value)}))}/>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy||!view} onClick={()=>run('configure',form)}><Save className="h-4 w-4 ml-2"/>שמור הגדרות</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('status')}><RefreshCw className="h-4 w-4 ml-2"/>רענן</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('diagnose')}>אבחון ללא שליחה</Button>
        <Button size="sm" variant="outline" disabled={busy||!form.enabled||form.paused}
          onClick={()=>window.confirm('להפעיל עובד תור כעת? הפעולה עשויה לשלוח הודעות אמיתיות.')&&run('kick')}>
          <Play className="h-4 w-4 ml-2"/>הפעל עובד עכשיו
        </Button>
      </div>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice&&<p role="status" className="text-sm text-green-700">{notice}</p>}
      <div className="border-t pt-4"><WhatsAppQueueMessages refreshSignal={refreshSignal}/></div>
      <p className="text-xs text-gray-500">הודעה שהתקבלה אצל ספק WhatsApp אינה בהכרח הודעה שנמסרה לנמען. במצב לא ידוע יש לאמת אצל הספק לפני שליחה מחדש.</p>
      {(totals.unknown||0)>0&&<p className="text-sm text-amber-700 flex gap-2">
        <AlertTriangle className="h-4 w-4"/>תוצאה לא ידועה אינה נשלחת שוב אוטומטית.</p>}
    </div>
  </details>;
}
