import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Archive, Ban, Check, Eye, RefreshCw, RotateCcw } from 'lucide-react';

const statusNames={
  queued:'ממתין לשליחה',retry_wait:'ממתין לניסיון חוזר',
  sending:'נשלח כעת',accepted:'התקבל אצל ספק WhatsApp',failed:'נכשל',
  unknown:'תוצאה לא ידועה — דורש בירור',cancelled:'בוטל',expired:'פג תוקף',
  resolved:'טופל ידנית'
};
const actions={
  cancel:{title:'בטל הודעה ממתינה',description:'לא תתבצע פנייה לספק עבור הודעה זו. אי אפשר לבטל הודעה שכבר נשלחת.'},
  retry:{title:'החזר הודעה לתור',description:'ההודעה עשויה להישלח בפועל. מצב לא ידוע מחייב אימות מול ספק WhatsApp שההודעה לא נשלחה.'},
  resolve:{title:'סמן הודעה כטופלה',description:'לא תתבצע שליחה. הסטטוס יישמר להיסטוריה לצורך ביקורת.'},
  archive:{title:'העבר לארכיון',description:'מסתיר הודעה שטופלה מרשימת העבודה בלי למחוק את היסטוריית התוצאה.'},
  unarchive:{title:'החזר מהארכיון',description:'מחזיר רשומה להיסטוריה הגלויה בלי לשלוח הודעה.'}
};
const toLocale = value => {
  if(!value)return '';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?String(value):date.toLocaleString('he-IL');
};

export default function WhatsAppQueueMessages({refreshSignal=0}){
  const [rows,setRows]=useState([]);
  const [status,setStatus]=useState(()=>{
    if(typeof window==='undefined')return 'all';
    return new URLSearchParams(window.location.search).get('whatsappQueue')==='review'
      ?'unknown':'all';
  });
  const [source,setSource]=useState('');
  const [showArchived,setShowArchived]=useState(false);
  const [offset,setOffset]=useState(0);
  const [nextOffset,setNextOffset]=useState(null);
  const [selected,setSelected]=useState(new Set());
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [dialog,setDialog]=useState(null);
  const [full,setFull]=useState(null);
  const [note,setNote]=useState('');
  const [verifiedNotSent,setVerifiedNotSent]=useState(false);
  const [resolution,setResolution]=useState('handled_outside');

  async function fetchPage(nextOffsetValue=offset){
    setLoading(true);setError('');
    try{
      const response=await base44.functions.invoke('WhatsAppQueueAdmin',{
        action:'list',offset:nextOffsetValue,status,source:source.trim(),showArchived
      });
      if(!response.data?.success)throw new Error(response.data?.error||'שגיאה בקריאת ההודעות');
      setRows(response.data.rows||[]);
      setNextOffset(response.data.nextOffset??null);
      setOffset(nextOffsetValue);
      setSelected(new Set());
    }catch(e){setError(e?.response?.data?.error||e?.message||'קריאת רשימת התור נכשלה');}
    finally{setLoading(false);}
  }
  useEffect(()=>{
    let alive=true;
    base44.functions.invoke('WhatsAppQueueAdmin',{action:'list',offset:0,status,source:source.trim(),showArchived})
      .then(r=>{
        if(!alive)return;
        if(!r.data?.success)throw new Error(r.data?.error||'שגיאה');
        setRows(r.data.rows||[]);setNextOffset(r.data.nextOffset??null);setOffset(0);setSelected(new Set());
      }).catch(()=>{if(alive)setError('לא ניתן לטעון את הודעות WhatsApp.');});
    return()=>{alive=false};
  },[status,source,showArchived,refreshSignal]);

  const allowedSelected=(kind)=>rows.filter(row=>selected.has(row.id) &&
    (kind==='bulkCancel'?row.canCancel:row.canArchive)).map(row=>row.id);

  async function bulk(kind){
    const ids=allowedSelected(kind);
    if(!ids.length)return;
    const caption=kind==='bulkCancel'?'לבטל':'להעביר לארכיון';
    if(!window.confirm(`לבצע ${caption} עבור ${ids.length} הודעות מסומנות?\nהפעולה אינה שולחת WhatsApp.`))return;
    setBusy(true);setError('');setNotice('');
    try{
      const r=await base44.functions.invoke('WhatsAppQueueAdmin',{
        action:kind,ids,confirm:true,note:'System owner bulk queue management'
      });
      if(!r.data?.success)throw new Error(r.data?.error||'הפעולה נכשלה');
      setNotice(`עודכנו ${r.data.updated} הודעות. ${r.data.skipped?.length||0} לא עודכנו כי מצבן השתנה או שהן אינן מתאימות לפעולה.`);
      await fetchPage();
    }catch(e){setError(e?.response?.data?.error||e?.message||'פעולה מרוכזת נכשלה');}
    finally{setBusy(false);}
  }

  async function openAction(row,action){
    setNote('');setVerifiedNotSent(false);setResolution('handled_outside');setFull(null);
    setDialog({row,action});
    try{
      const r=await base44.functions.invoke('WhatsAppQueueAdmin',{action:'get',id:row.id});
      if(r.data?.success)setFull(r.data.message);
    }catch{ /* Detailed preview is optional; no action runs here. */ }
  }

  const close=()=>{if(!busy){setDialog(null);setFull(null);}};

  async function applyAction(){
    if(!dialog)return;
    setBusy(true);setError('');setNotice('');
    try{
      const r=await base44.functions.invoke('WhatsAppQueueAdmin',{
        action:dialog.action,id:dialog.row.id,note,
        verifiedNotSent,
        resolution:dialog.action==='resolve'?resolution:undefined
      });
      if(!r.data?.success)throw new Error(r.data?.error||'הפעולה נכשלה');
      setDialog(null);setFull(null);
      setNotice('הפעולה נשמרה. הפעולות התייחסו למצב ההודעה בזמן העדכון; לא נשלחה הודעה ישירות ממסך הניהול.');
      await fetchPage();
    }catch(e){setError(e?.response?.data?.error||e?.message||'הפעולה לא הצליחה — רענן את הרשימה');}
    finally{setBusy(false);}
  }

  const dialogNeedsNote=dialog && (dialog.action==='resolve'||dialog.action==='retry');
  const noteLength=note.trim().length;
  const canApply=!busy&&(!dialogNeedsNote||
    (dialog.action==='resolve'?noteLength>=5:
      noteLength>=(dialog.row.status==='unknown'?12:5) &&
      (dialog.row.status!=='unknown'||verifiedNotSent)));

  return <div className="space-y-3" dir="rtl">
    <div className="flex flex-wrap items-center gap-2">
      <div className="font-medium text-sm">ניהול הודעות בתור</div>
      <select aria-label="סינון מצב הודעה" className="border rounded-md px-2 py-1.5 text-sm" value={status}
        onChange={e=>setStatus(e.target.value)}>
        <option value="all">כל המצבים</option>
        {Object.entries(statusNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select>
      <Input className="w-44" placeholder="סנן לפי מקור הודעה" value={source} onChange={e=>setSource(e.target.value)} />
      <label className="flex gap-2 items-center text-sm"><Checkbox checked={showArchived}
        onCheckedChange={v=>setShowArchived(v===true)}/>הצג ארכיון</label>
      <Button variant="outline" size="sm" disabled={busy||loading} onClick={()=>fetchPage(0)}>
        <RefreshCw className="h-4 w-4 ml-1"/>{loading?'טוען...':'רענן'}
      </Button>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!rows.some(r=>r.canCancel)||busy}
        onClick={()=>setSelected(new Set(rows.filter(r=>r.canCancel).map(r=>r.id)))}>בחר הודעות שניתן לבטל</Button>
      <Button size="sm" variant="outline" disabled={!rows.some(r=>r.canArchive)||busy}
        onClick={()=>setSelected(new Set(rows.filter(r=>r.canArchive).map(r=>r.id)))}>בחר הודעות שטופלו</Button>
      <Button size="sm" variant="outline" onClick={()=>setSelected(new Set())} disabled={!selected.size||busy}>נקה בחירה</Button>
      <Button size="sm" variant="outline" onClick={()=>bulk('bulkCancel')} disabled={!allowedSelected('bulkCancel').length||busy}>
        <Ban className="h-4 w-4 ml-1"/>בטל מסומנות ({allowedSelected('bulkCancel').length})
      </Button>
      <Button size="sm" variant="outline" onClick={()=>bulk('bulkArchive')} disabled={!allowedSelected('bulkArchive').length||busy}>
        <Archive className="h-4 w-4 ml-1"/>ארכב מסומנות ({allowedSelected('bulkArchive').length})
      </Button>
    </div>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="text-sm text-green-700">{notice}</p>}
    <div className="overflow-x-auto border rounded-lg">
      <table className="w-full text-sm text-right min-w-[740px]">
        <thead className="bg-gray-50"><tr>
          <th className="p-2">בחר</th><th className="p-2">מקור</th><th className="p-2">מועד יצירה</th>
          <th className="p-2">נמען</th><th className="p-2">ספק שליחה</th><th className="p-2">מצב</th><th className="p-2">ניסיונות</th>
          <th className="p-2">פעולות</th>
        </tr></thead>
        <tbody>
          {rows.map(row=><tr key={row.id} className="border-t align-middle">
            <td className="p-2"><Checkbox checked={selected.has(row.id)} disabled={busy||!(row.canCancel||row.canArchive)}
              aria-label={'בחר הודעה '+row.id} onCheckedChange={checked=>{
                setSelected(prev=>{const next=new Set(prev);if(checked)next.add(row.id);else next.delete(row.id);return next;});
              }}/></td>
            <td className="p-2"><span className="font-medium">{row.source}</span></td>
            <td className="p-2 whitespace-nowrap">{toLocale(row.createdAt)}</td>
            <td className="p-2">{row.recipient}</td>
            <td className="p-2">{row.requestedProvider==='wasender'?'WasenderAPI':
              row.requestedProvider==='green'?'Green API':'לפי ברירת המחדל'}</td>
            <td className="p-2">
              {statusNames[row.status]||row.status}
              {row.errorCode&&<p className="text-xs text-amber-700">HTTP {row.errorCode}</p>}
            </td>
            <td className="p-2">{row.attemptCount||0}</td>
            <td className="p-2"><div className="flex gap-1 flex-wrap">
              <Button variant="ghost" size="sm" onClick={()=>openAction(row,'inspect')} disabled={busy}><Eye className="h-4 w-4 ml-1"/>פרטים</Button>
              {row.canCancel&&<Button variant="outline" size="sm" onClick={()=>openAction(row,'cancel')} disabled={busy}>בטל</Button>}
              {row.canRetry&&<Button variant="outline" size="sm" onClick={()=>openAction(row,'retry')} disabled={busy}><RotateCcw className="h-3 w-3 ml-1"/>נסה שוב</Button>}
              {row.canResolve&&<Button variant="outline" size="sm" onClick={()=>openAction(row,'resolve')} disabled={busy}>טופל ידנית</Button>}
              {row.canArchive&&!row.archived&&<Button variant="ghost" size="sm" onClick={()=>openAction(row,'archive')} disabled={busy}>ארכיון</Button>}
              {row.archived&&<Button variant="ghost" size="sm" onClick={()=>openAction(row,'unarchive')} disabled={busy}>שחזר</Button>}
            </div></td>
          </tr>)}
          {!rows.length&&<tr><td className="p-5 text-center text-gray-500" colSpan={8}>אין הודעות התואמות לסינון. ייתכן שהתור עדיין כבוי או שטרם נוצרו הודעות.</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">מוצגות {rows.length} הודעות; נתוני שגיאה זמינים בכל הודעה.</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={loading||busy||!offset} onClick={()=>fetchPage(Math.max(0,offset-60))}>הקודם</Button>
        <Button size="sm" variant="outline" disabled={loading||busy||nextOffset===null} onClick={()=>fetchPage(nextOffset)}>הבא</Button>
      </div>
    </div>
    <Dialog open={!!dialog} onOpenChange={open=>{if(!open)close();}}>
      <DialogContent dir="rtl" className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{dialog?.action==='inspect'?'פרטי הודעת WhatsApp':(actions[dialog?.action]?.title||'ניהול הודעה')}</DialogTitle></DialogHeader>
        {dialog&&<div className="space-y-3 text-sm">
          <p><strong>מקור:</strong> {dialog.row.source} · <strong>מצב:</strong> {statusNames[dialog.row.status]||dialog.row.status} · <strong>ספק:</strong> {dialog.row.requestedProvider==='wasender'?'WasenderAPI':dialog.row.requestedProvider==='green'?'Green API':'לפי ברירת המחדל'}</p>
          {full&&<>
            <p><strong>נמען:</strong> <span dir="ltr">{full.chatId}</span></p>
            {full.fileName&&<p><strong>שם מסמך:</strong> {full.fileName}</p>}
            <div className="max-h-36 overflow-auto bg-gray-50 rounded p-2 whitespace-pre-wrap">{full.text||'אין גוף הודעה'}</div>
            {full.providerMessageId&&<p dir="ltr"><strong>Provider ID: </strong>{full.providerMessageId}</p>}
          </>}
          {dialog.row.error&&<p className="rounded bg-amber-50 p-2">שגיאה אחרונה: {dialog.row.error}</p>}
          {dialog.action!=='inspect'&&<>
            <p className="text-gray-600">{actions[dialog.action]?.description}</p>
            {dialog.action==='retry'&&dialog.row.status==='unknown'&&
              <label className="flex gap-2 rounded border p-3 text-amber-800">
                <Checkbox checked={verifiedNotSent} onCheckedChange={v=>setVerifiedNotSent(v===true)}/>
                <span>בדקתי ידנית במערכת ספק WhatsApp ואימתתי שלא התקבלה הודעה זו. אני מאשר ניסיון חדש.</span>
              </label>}
            {dialog.action==='resolve'&&
              <label className="block space-y-1"><Label>אופן הטיפול</Label>
                <select className="border p-2 rounded w-full" value={resolution} onChange={e=>setResolution(e.target.value)}>
                  <option value="handled_outside">טופלה מחוץ למערכת</option>
                  <option value="no_longer_needed">כבר אינה רלוונטית</option>
                </select>
              </label>}
            {dialogNeedsNote&&<label className="block space-y-1">
              <Label>תיעוד סיבת הפעולה {dialog.row.status==='unknown'?'— חובה לפרט כיצד אומת שלא נשלחה':''}</Label>
              <Textarea value={note} onChange={e=>setNote(e.target.value)} rows={3} maxRows={6}
                placeholder="תיעוד לבדיקה ולביקורת..." />
            </label>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={close} disabled={busy}>חזור</Button>
              <Button onClick={applyAction} disabled={!canApply}>
                <Check className="h-4 w-4 ml-2"/>{busy?'שומר...':'אשר פעולה'}
              </Button>
            </div>
          </>}
          {dialog.action==='inspect'&&<Button variant="outline" onClick={close}>סגור</Button>}
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}
