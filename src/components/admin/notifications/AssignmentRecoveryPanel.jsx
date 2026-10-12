import React, { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, RefreshCcw, Pause, Play, ListChecks } from 'lucide-react';

const labels = {
  not_prepared: 'טרם הוכן', queued: 'ממתין לשליחה', dispatching: 'בתהליך שליחה',
  accepted: 'התקבל אצל ספק ה־API', rejected: 'הספק דחה', unknown: 'לא ידוע — לא לשלוח שוב ללא בדיקה',
  skipped: 'דולג — השיבוץ השתנה'
};
const isEligible = x => x.recoveryState === 'not_prepared';
const itemKey = x => x.eventServiceId + '|' + x.supplierId;

export default function AssignmentRecoveryPanel() {
  const [hours, setHours] = useState('8');
  const [preview, setPreview] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [queue, setQueue] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const timer = useRef(null);
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    base44.functions.invoke('AssignmentWhatsAppRecovery', {action:'status'})
      .then(r=>{if(mounted.current&&r.data?.success)setQueue(r.data);})
      .catch(()=>{});
    return () => {
      mounted.current=false; running.current=false;
      if(timer.current)clearTimeout(timer.current);
    };
  }, []);

  const eligible = useMemo(()=>preview.filter(isEligible),[preview]);
  const selectionCount = eligible.filter(x=>selected.has(itemKey(x))).length;
  const totals = queue?.summary || {};
  const pendingCount = totals.queued || 0;

  async function scan() {
    if(running.current)return;
    setBusy(true);setError('');setNotice('');
    try {
      const r=await base44.functions.invoke('AssignmentWhatsAppRecovery',{action:'preview',hours:Number(hours)});
      if(!r.data?.success)throw new Error(r.data?.error||'לא ניתן לקבל רשימת שיבוצים');
      setPreview(r.data.items||[]);
      setQueue(r.data);
      setSelected(new Set());
      setNotice(`נמצאו ${r.data.items?.length||0} שיבוצים ממתינים ברשומות שעודכנו בחלון הזמן שנבחר. אלו מועמדים לבדיקה — לא רשימה מאומתת של הודעות שלא הגיעו.`);
    }catch(e){setError(e?.response?.data?.error||e?.message||'סריקת השיבוצים נכשלה');}
    finally{setBusy(false);}
  }

  async function prepare() {
    const selection=eligible.filter(x=>selected.has(itemKey(x))).map(x=>({eventServiceId:x.eventServiceId,supplierId:x.supplierId}));
    if(!selection.length)return;
    if(!window.confirm(`להכין ${selection.length} תזכורות לשיבוצים?\n\nהכנה לא שולחת הודעות. לפני השליחה אפשר לראות את כל הפרטים. חלק מהנמענים אולי קיבלו כבר את ההודעה המקורית.`))return;
    setBusy(true);setError('');setNotice('');
    try {
      const r=await base44.functions.invoke('AssignmentWhatsAppRecovery',{action:'prepare',hours:Number(hours),selection});
      if(!r.data?.success)throw new Error(r.data?.error||'ההכנה נכשלה');
      setQueue(r.data);
      setNotice(`הוכנו ${r.data.prepared||0} הודעות לשליחה. ${r.data.excluded||0} כבר היו בתור או אינן תואמות עוד את השיבוץ. עדיין לא נשלחה הודעה.`);
      await scan();
    }catch(e){setError(e?.response?.data?.error||e?.message||'לא ניתן להכין את התור');}
    finally{setBusy(false);}
  }

  async function tick() {
    if(!running.current||!mounted.current)return;
    try {
      const r=await base44.functions.invoke('AssignmentWhatsAppRecovery',{action:'sendNext'});
      if(!mounted.current||!running.current)return;
      const data=r.data;
      if(!data?.success)throw new Error(data?.error||'השליחה נכשלה');
      setQueue(data);
      if(data.finished||!(data.summary?.queued||0)){
        running.current=false;setSending(false);
        setNotice('התור הסתיים. בדוק הודעות שסומנו כ״לא ידוע״ או ״נדחתה״ לפני ניסיון נוסף.');
        return;
      }
      if(data.sent)setNotice('הודעה אחת התקבלה לעיבוד אצל ספק ה־API. אין עדיין אישור מסירה לנמען.');
      if(data.recoveryState==='unknown')setNotice('התקבלה תוצאה לא ידועה. ההודעה המסוימת לא תישלח שוב אוטומטית.');
      if(data.recoveryState==='rejected')setNotice('הספק דחה הודעה. היא סומנה כנדחתה ולא תישלח שוב אוטומטית.');
      const pauseSeconds=Math.max(2,Number(data.waitingSeconds|| (data.skipped?2:70)));
      timer.current=setTimeout(()=>{void tick();},pauseSeconds*1000);
    }catch(e){
      running.current=false;setSending(false);
      setError(e?.response?.data?.error||e?.message||'שליחת התור נעצרה; ניתן לרענן ולהמשיך לאחר בדיקה.');
    }
  }

  function start() {
    if(!pendingCount||busy||running.current)return;
    if(!window.confirm(`לשלוח בהדרגה את ${pendingCount} ההודעות הממתינות?\n\nהשליחה תתבצע אחת לכ־70 שניות כל עוד מסך זה פתוח. פעולה זו שולחת הודעות אמיתיות לספקים. עצור אם קיימות כפילויות לא רצויות.`))return;
    setError('');setNotice('השליחה החלה. השאר את הדף פתוח או לחץ עצור. ניתן להמשיך גם לאחר רענון.');
    running.current=true;setSending(true);void tick();
  }
  function pause() {
    running.current=false;setSending(false);
    if(timer.current)clearTimeout(timer.current);
    setNotice('ההמשך האוטומטי נעצר. הודעה שכבר התחילה להישלח עשויה להסתיים. התור נשמר.');
  }

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl" dir="rtl">
      <CardHeader><CardTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5" />התאוששות משליחת הודעות שיבוץ שנכשלו</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-700">רשימת מועמדים מתוך השיבוצים הקיימים, בלי לשנות שיבוץ אחד. מכיוון שבעבר לא נשמר אישור מסירה לכל הודעה, אין דרך לקבוע בוודאות מי לא קיבל. ההודעות מחודשות בנוסח של תזכורת, לא הודעת שיבוץ חדשה.</p>
        <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>בתקופת הניסיון של WasenderAPI מותרת הודעה אחת בדקה ועד 50 ביום. השליחה פה מוגבלת לכ־70 שניות בין הודעות, ורק כשהדף פתוח. שליחות אוטומטיות אחרות עשויות לנצל גם הן את המכסה.</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm space-y-1"><span className="block font-medium">שיבוצים שעודכנו ב־</span>
            <select aria-label="חלון זמן לשחזור" className="rounded-md border px-3 py-2" value={hours} onChange={e=>setHours(e.target.value)} disabled={sending||busy}>
              <option value="8">8 השעות האחרונות</option>
              <option value="24">24 השעות האחרונות</option>
              <option value="48">48 השעות האחרונות</option>
              <option value="72">72 השעות האחרונות</option>
            </select>
          </label>
          <Button onClick={scan} variant="outline" disabled={busy||sending}><RefreshCcw className="h-4 w-4 ml-2"/>{busy?'בודק...':'סרוק שיבוצים'}</Button>
          {eligible.length>0&&<Button variant="outline" disabled={busy||sending} onClick={()=>setSelected(new Set(eligible.map(itemKey)))}>בחר את כל המועמדים ({eligible.length})</Button>}
          {selected.size>0&&<Button variant="outline" disabled={busy||sending} onClick={()=>setSelected(new Set())}>נקה בחירה</Button>}
        </div>
        {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
        {notice&&<p role="status" className="text-sm text-blue-800">{notice}</p>}
        {preview.length>0&&<div className="overflow-x-auto rounded-lg border">
          <table className="min-w-[760px] w-full text-right text-sm">
            <thead className="bg-gray-100"><tr>
              <th className="p-2">בחירה</th><th className="p-2">אירוע</th><th className="p-2">ספק</th><th className="p-2">שירות</th><th className="p-2">מועד</th><th className="p-2">מצב</th><th className="p-2">נוסח</th>
            </tr></thead>
            <tbody>{preview.map(item=><tr key={itemKey(item)} className="border-t align-top">
              <td className="p-2"><Checkbox checked={selected.has(itemKey(item))} disabled={!isEligible(item)||busy||sending} aria-label={'בחר שיבוץ '+item.supplierName} onCheckedChange={checked=>setSelected(prev=>{const next=new Set(prev);if(checked)next.add(itemKey(item));else next.delete(itemKey(item));return next})}/></td>
              <td className="p-2">{item.eventName}</td><td className="p-2">{item.supplierName}</td>
              <td className="p-2">{item.serviceName}</td>
              <td className="p-2 whitespace-nowrap">{item.eventDate} {item.eventTime}</td>
              <td className="p-2">{labels[item.recoveryState]||item.recoveryState}</td>
              <td className="p-2"><details><summary className="cursor-pointer text-blue-700">הצג</summary><div className="mt-1 max-w-sm whitespace-pre-wrap rounded bg-gray-50 p-2">{item.message}</div></details></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {preview.length>0&&<div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm">נבחרו {selectionCount} מתוך {eligible.length} מועמדים חדשים</span>
          <Button onClick={prepare} disabled={busy||sending||!selectionCount}><ListChecks className="h-4 w-4 ml-2"/>הכן מסומנים לתור (ללא שליחה)</Button>
        </div>}
        {queue&&<div className="rounded border bg-gray-50 p-3 space-y-3">
          <div className="text-sm flex flex-wrap gap-3">
            <span>ממתינות: <strong>{pendingCount}</strong></span>
            <span>התקבלו אצל הספק: <strong>{totals.accepted||0}</strong></span>
            <span>נדחו: <strong>{totals.rejected||0}</strong></span>
            <span>תוצאה לא ידועה: <strong>{totals.unknown||0}</strong></span>
            <span>דולגו: <strong>{totals.skipped||0}</strong></span>
          </div>
          <div className="flex flex-wrap gap-2">
            {!sending?<Button disabled={!pendingCount||busy} onClick={start}><Play className="h-4 w-4 ml-2"/>התחל / המשך שליחה מרוכזת</Button>
            :<Button variant="destructive" onClick={pause}><Pause className="h-4 w-4 ml-2"/>עצור שליחה</Button>}
            <Button variant="outline" disabled={busy||sending} onClick={async()=>{try{const r=await base44.functions.invoke('AssignmentWhatsAppRecovery',{action:'status'});if(r.data?.success)setQueue(r.data);}catch{setError('לא ניתן לרענן את התור');}}}>רענן מצב</Button>
          </div>
          <p className="text-xs text-gray-600">״התקבלה אצל הספק״ אינה הוכחת מסירה לנמען. הודעות במצב לא ידוע לא יישלחו שוב אוטומטית. התור נשמר גם לאחר סגירת הדף.</p>
        </div>}
      </CardContent>
    </Card>
  );
}
