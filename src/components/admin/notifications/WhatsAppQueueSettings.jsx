import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw, Save, Play, AlertTriangle } from 'lucide-react';

const STATUS_NAMES = {
  queued:'ממתין',sending:'בתהליך',accepted:'התקבל בספק',
  retry_wait:'ממתין לניסיון חוזר',unknown:'תוצאה לא ידועה',failed:'נכשל',
  cancelled:'בוטל',expired:'פג תוקף'
};
export default function WhatsAppQueueSettings(){
  const [view,setView]=useState(null);
  const [form,setForm]=useState({enabled:false,paused:false,minIntervalSeconds:7,maxMessagesPerRun:16});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function refresh(){
    const r=await base44.functions.invoke('WhatsAppQueueAdmin',{action:'status'});
    if(!r.data?.success)throw new Error(r.data?.error||'בדיקת תור WhatsApp נכשלה');
    setView(r.data);setForm(r.data.config);
  }
  useEffect(()=>{let active=true;base44.functions.invoke('WhatsAppQueueAdmin',{action:'status'})
    .then(r=>{if(active&&r.data?.success){setView(r.data);setForm(r.data.config);}})
    .catch(()=>{if(active)setError('לא ניתן לטעון את הגדרות תור WhatsApp. ייתכן שפונקציות התור עדיין לא פורסמו.');});
    return()=>{active=false;};},[]);
  async function run(action,params={}){
    setBusy(true);setError('');setNotice('');
    try{
      const r=await base44.functions.invoke('WhatsAppQueueAdmin',{action,...params});
      if(!r.data?.success)throw new Error(r.data?.error||'הפעולה לא הצליחה');
      if(action==='kick'){
        const result=r.data.dispatch;
        setNotice(result.reason==='disabled'?'התור כבוי — לא נשלחה הודעה':
          result.reason==='busy'?'עובד תור אחר כבר פועל':
          result.reason==='empty'?'התור ריק':
          `פעולת התור הושלמה: ${result.accepted||0} הודעות התקבלו בספק, ${result.unknown||0} תוצאה לא ידועה, ${result.failed||0} נכשלו.`);
      }else if(action==='configure')setNotice('הגדרות התור המרכזי נשמרו.');
      await refresh();
    }catch(e){setError(e?.response?.data?.error||e?.message||'הפעולה נכשלה');}
    finally{setBusy(false);}
  }
  const stats=view?.totals||{};
  return <details className="rounded-lg border bg-white p-4 space-y-3" dir="rtl">
    <summary className="cursor-pointer font-semibold text-base">תור WhatsApp מרכזי — קצב, המתנה ומעקב</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-gray-600">הגדרה אחת לכל השיבוצים, התזכורות, החשבוניות, הקישורים והודעות הידניות. ההודעה הראשונה נשלחת מיד כשהתור פנוי; המרווח חל רק בין ניסיונות שליחה לספק, ולא לפני כל הודעה.</p>
      {view && <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm rounded border p-3 bg-gray-50">
        <span>ספק פעיל: <strong>{view.activeProvider==='wasender'?'WasenderAPI':'Green API'}</strong></span>
        <span>בהמתנה: <strong>{(stats.queued||0)+(stats.retry_wait||0)}</strong></span>
        <span>התקבלו אצל ספק: <strong>{stats.accepted||0}</strong></span>
        <span>נכשלו: <strong>{stats.failed||0}</strong></span>
        <span>לא ידוע: <strong>{stats.unknown||0}</strong></span>
        <span>{view.workerBusy?'עובד התור פעיל':'עובד התור פנוי'}</span>
        <span>{view.nextAllowedInSeconds>0?`חלון השליחה הבא: בעוד ${view.nextAllowedInSeconds} שניות`:'התור פנוי מבחינת מרווח הזמן'}</span>
        {view.historyTruncated&&<span>מוצגים רק 500 ההודעות האחרונות.</span>}
        {view.lastError&&<span className="text-red-700">שגיאה אחרונה: {view.lastError}</span>}
      </div>}
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.enabled} onCheckedChange={enabled=>setForm(s=>({...s,enabled}))} disabled={busy}/><span>תור מרכזי מופעל</span></label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.paused} onCheckedChange={paused=>setForm(s=>({...s,paused}))} disabled={busy}/><span>השהה שליחות חדשות (שמור בתור)</span></label>
      </div>
      <div className="flex flex-wrap items-end gap-5">
        <div className="space-y-1"><Label htmlFor="queue-interval">מרווח מינימלי בין שתי הודעות, בשניות</Label>
          <Input id="queue-interval" className="w-32" type="number" min="1" max="60" step="1" value={form.minIntervalSeconds} onChange={e=>setForm(s=>({...s,minIntervalSeconds:Number(e.target.value)}))} disabled={busy}/></div>
        <div className="space-y-1"><Label htmlFor="queue-batch">הודעות בכל ריצת עובד, לכל היותר</Label>
          <Input id="queue-batch" className="w-32" type="number" min="1" max="30" step="1" value={form.maxMessagesPerRun} onChange={e=>setForm(s=>({...s,maxMessagesPerRun:Number(e.target.value)}))} disabled={busy}/></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy||!view} onClick={()=>run('configure',form)}><Save className="h-4 w-4 ml-2"/>שמור הגדרות תור</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('status')}><RefreshCw className="h-4 w-4 ml-2"/>רענן מצב</Button>
        <Button size="sm" variant="outline" disabled={busy||!form.enabled} onClick={()=>{if(window.confirm('הפעולה עשויה לשלוח בפועל הודעות שכבר ממתינות בתור. להמשיך?'))run('kick');}}><Play className="h-4 w-4 ml-2"/>הפעל עובד תור כעת</Button>
      </div>
      {error&&<p className="text-red-700 text-sm" role="alert">{error}</p>}
      {notice&&<p className="text-green-700 text-sm" role="status">{notice}</p>}
      <p className="text-xs text-gray-500">תור השליחה מתעורר עם כל הודעה חדשה. עובד הרקע משלים אצוות באופן רציף; בדיקת גיבוי אחת לחמש דקות מיועדת להתאוששות מקריסה. הודעת ״התקבלה אצל הספק״ אינה אישור מסירה לנמען.</p>
      {Array.isArray(view?.latest)&&view.latest.length>0&&<details className="rounded border p-3"><summary className="text-sm cursor-pointer">הצג היסטוריית תור אחרונה ({view.latest.length})</summary>
        <div className="mt-3 max-h-72 overflow-y-auto space-y-1 text-xs">{view.latest.map(j=><div key={j.id} className="flex flex-wrap gap-3 border-b p-1">
          <span>{j.source||'מערכת'}</span><span>{STATUS_NAMES[j.status]||j.status}</span><span>{j.kind==='document'?'מסמך':'טקסט'}</span>
          <span>{j.createdAt?new Date(j.createdAt).toLocaleString('he-IL'):''}</span>
          {j.errorCode&&<span className="text-red-700">קוד שגיאה: {j.errorCode}</span>}
          {j.error&&<span className="text-red-700">{j.error}</span>}
        </div>)}</div>
      </details>}
      {(stats.unknown||0)>0&&<p className="flex items-start gap-2 text-amber-800 text-sm"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0"/>הודעות בעלות תוצאה לא ידועה לא יישלחו שוב אוטומטית, כדי למנוע כפילויות.</p>}
    </div>
  </details>;
}
