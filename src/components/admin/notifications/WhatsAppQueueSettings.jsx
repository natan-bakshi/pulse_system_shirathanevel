import React, {useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Switch} from '@/components/ui/switch';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {RefreshCw,Save,Play,AlertTriangle} from 'lucide-react';
import WhatsAppQueueMessages from './WhatsAppQueueMessages';
import WhatsAppInteractiveDraftSettings from './WhatsAppInteractiveDraftSettings';
import WhatsAppWebhookCreditsEstimator from './WhatsAppWebhookCreditsEstimator';

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
  const reviewDeepLink=typeof window!=='undefined' &&
    new URLSearchParams(window.location.search).get('whatsappQueue')==='review';
  const [expanded,setExpanded]=useState(reviewDeepLink);
  // A collapsed settings panel must not run backend status/list queries.
  // The existing review deep link still opens the queue and its message list.
  const [messagesOpen,setMessagesOpen]=useState(reviewDeepLink);
  useEffect(()=>{
    if(reviewDeepLink)document.getElementById('whatsapp-queue')?.scrollIntoView({block:'start'});
  },[reviewDeepLink]);
  const [form,setForm]=useState(defaults),[view,setView]=useState(null);
  const [units,setUnits]=useState({wasender:'seconds',green:'seconds'});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [metrics,setMetrics]=useState(null);
  const [sourceAudit,setSourceAudit]=useState(null);
  const [inboundAudit,setInboundAudit]=useState(null);
  const [unknownCallbackAudit,setUnknownCallbackAudit]=useState(null);
  const [unknownRecoveryCleanup,setUnknownRecoveryCleanup]=useState(null);
  const [unknownRecoveryReview,setUnknownRecoveryReview]=useState(null);
  const [inboundDetail,setInboundDetail]=useState(null);
  const [interactiveReadiness,setInteractiveReadiness]=useState(null);
  const [qaReadiness,setQaReadiness]=useState(null);
  const [greenWebhookSettings,setGreenWebhookSettings]=useState(null);
  const [officeReference,setOfficeReference]=useState('');
  const [officeLookup,setOfficeLookup]=useState(null);
  const [refreshSignal,setRefreshSignal]=useState(0);
  const apply=data=>{setView(data);if(data?.config)setForm(data.config);};
  const read=async()=>{
    const res=await base44.functions.invoke('WhatsAppQueueAdmin',{action:'status'});
    if(!res.data?.success)throw Error(res.data?.error||'קריאת התור נכשלה');
    apply(res.data);setRefreshSignal(n=>n+1);
  };
  useEffect(()=>{
    if(!expanded)return;
    let alive=true;
    base44.functions.invoke('WhatsAppQueueAdmin',{action:'status'})
      .then(r=>{if(alive&&r.data?.success)apply(r.data);})
      .catch(()=>{if(alive)setError('לא ניתן לטעון את תור WhatsApp. בדוק שהפונקציות פורסמו.');});
    return()=>{alive=false;};
  },[expanded]);
  async function run(action,params={}){
    // Never leave a previously decrypted structural preview visible when a
    // different owner review starts or fails: it would refer to the wrong row.
    if(action==='unknownRecoveryStructureReview')setUnknownRecoveryReview(null);
    if(action==='configure'&&view&&!view.config.enabled&&form.enabled&&
      !window.confirm('הפעלת התור משנה את מסלול ה־WhatsApp לכל המערכת. ודא שאוטומציות הרקע ועובד התור פורסמו ונבדקו. להמשיך?'))return;
    setBusy(true);setError('');setNotice('');
    try{
      const res=await base44.functions.invoke('WhatsAppQueueAdmin',{action,...params});
      if(action==='metrics'){
        if(!res.data?.success)throw Error(res.data?.error||'חישוב מדדי התור נכשל');
        setMetrics(res.data.metrics);
        setNotice('מדידה היסטורית עודכנה ללא שליחת WhatsApp. זהו מדגם בלבד.');
        return;
      }
      if(action==='officeReferenceLookup'){
        if(!res.data?.success)throw Error(res.data?.error||'לא ניתן לאתר את אסמכתת השיבוץ');
        setOfficeLookup(res.data.lookup);
        setNotice('השיבוץ אותר לפי אסמכתא בלבד, ללא שליחת הודעות או שינוי נתונים.');
        return;
      }
      if(action==='greenWebhookSettingsAudit'){
        if(!res.data?.success)throw Error(res.data?.error||'בדיקת הגדרות Green API נכשלה');
        setGreenWebhookSettings(res.data.settings);
        setNotice('הגדרות Green נבדקו באמצעות קריאת API אחת בלבד. לא שונו הגדרות ולא נשלחו הודעות.');
        return;
      }
      if(action==='greenButtonQaReadiness'){
        if(!res.data?.success)throw Error(res.data?.error||'בדיקת מוכנות הניסוי נכשלה');
        setQaReadiness(res.data.qa);
        setNotice('נבדקו תנאי ניסוי כפתורים למספר אחד ללא שליחה וללא פנייה ל־Green API.');
        return;
      }
      if(action==='interactiveReadiness'){
        if(!res.data?.success)throw Error(res.data?.error||'בדיקת מוכנות כפתורים נכשלה');
        setInteractiveReadiness(res.data.readiness);
        setNotice('בדיקת מוכנות בוצעה לקריאה בלבד, ללא פנייה לספק WhatsApp.');
        return;
      }
      if(action==='inboundInspect'){
        if(!res.data?.success)throw Error(res.data?.error||'בדיקת רשומת תגובה נכשלה');
        setInboundDetail(res.data.inspection);
        setNotice('בדיקת רשומה הושלמה לקריאה בלבד. לא בוצע שינוי בנתונים.');
        return;
      }
      if(action==='unknownRecoveryStructureReview'){
        if(!res.data?.success)throw Error(res.data?.error||'בדיקת מבנה ההודעה המוצפנת אינה זמינה');
        setUnknownRecoveryReview(res.data.review);
        setNotice('מבנה הודעה מוצפנת אומת בשרת. לא הוצג תוכן אישי ולא השתנה שיבוץ.');
        return;
      }
      if(action==='unknownRecoveryExpiryCleanup'){
        if(!res.data?.success)throw Error(res.data?.error||'ניקוי מידע מוצפן נכשל');
        setUnknownRecoveryCleanup(res.data.cleanup);
        setUnknownRecoveryReview(null);
        setUnknownCallbackAudit(null);
        setNotice('נבדק ניקוי ממוקד של נתונים מוצפנים שתוקפם פג. יש לטעון את יומן הבירור מחדש.');
        return;
      }
      if(action==='unknownCallbackAudit'){
        if(!res.data?.success)throw Error(res.data?.error||'בדיקת אירועים לא מזוהים נכשלה');
        setUnknownCallbackAudit(res.data.audit);
        setUnknownRecoveryReview(null);
        setNotice('נבדקו רשומות בירור אנונימיות בלבד, ללא שינוי שיבוץ או שליחת הודעה.');
        return;
      }
      if(action==='inboundAudit'){
        if(!res.data?.success)throw Error(res.data?.error||'בדיקת תגובות הספקים נכשלה');
        setInboundDetail(null);
        setInboundAudit(res.data.audit);
        setNotice('בדיקת תגובות נכנסות הסתיימה ללא שליחת הודעות או שינוי שיבוצים.');
        return;
      }
      if(action==='sourceAudit'){
        if(!res.data?.success)throw Error(res.data?.error||'בדיקת התאמה נכשלה');
        setSourceAudit(res.data.audit);
        setNotice('בדיקת מקור מול תור הסתיימה ללא שליחת הודעה. מדגם בלבד, ללא אימות מסירה.');
        return;
      }
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
  return <details id="whatsapp-queue" open={expanded}
    onToggle={event=>setExpanded(event.currentTarget.open)}
    className="rounded-lg border bg-white p-4" dir="rtl">
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
        <span>זמינות: <strong>{!view.config?.enabled?'התור כבוי':view.config?.paused?'התור מושהה':
          view.workerBusy?'העובד מטפל בהודעות':(view.dueReadyCount||0)>0?
            ((view.nextAllowedInMs||0)>0?'הודעות זמינות, בהמתנה למרווח הספק':'הודעות זמינות — העובד יכול לטפל בהן'):
          (view.scheduledForFutureCount||0)>0?'כל הממתינות במדגם מתוזמנות לעתיד':
          view.historyTruncated?'לא נמצאו הודעות זמינות במדגם':'התור ריק — ההודעה הבאה אינה ממתינה לתור קיים'}</strong></span>
        <span>מוכנות כעת: <strong>{view.dueReadyCount||0}</strong> · מתוזמנות לעתיד: <strong>{view.scheduledForFutureCount||0}</strong></span>
        {(view.dueReadyCount||0)>0&&(view.nextAllowedInMs||0)>0&&
          <span>המתנת ספק נוכחי: {(view.nextAllowedInMs/1000).toFixed(2)} שניות</span>}
        {view.lastWorkerAt&&<span>טיפול אחרון בהודעות: {new Date(view.lastWorkerAt).toLocaleString('he-IL')}</span>}
        {view.lastWatchdogAt
          ?<span className={view.watchdogLate?'text-red-700 font-semibold':''}>
            בדיקת התאוששות מתוזמנת: {new Date(view.lastWatchdogAt).toLocaleString('he-IL')}
            {view.watchdogLate?' · לא נצפתה בדיקה חדשה במשך מעל 15 דקות':''}
          </span>
          :<span className="text-amber-700">טרם התקבלה חותמת מעקב של בדיקת ההתאוששות (לא הוכחת תקלה)</span>}
        {view.lastWorkerWakeReason&&<span>מקור התעוררות: <strong>{({outbox_create:'הודעה חדשה',continue:'המשך אצווה',watchdog:'בדיקת התאוששות',manual:'הפעלה ידנית',unattributed:'לא זוהה'})[view.lastWorkerWakeReason]||'לא זוהה'}</strong></span>}
        {view.lastBatchCount!=null&&<span>ניסיונות בריצה האחרונה: <strong>{view.lastBatchCount}</strong></span>}
        {view.lastBatchElapsedMs!=null&&<span>משך ריצה אחרונה: <strong>{(view.lastBatchElapsedMs/1000).toFixed(1)} שניות</strong></span>}
        {view.lastError&&<span className="text-red-700">תקלה: {view.lastError}</span>}
      </div>}
      {view?.duplicateAssignmentVersions?.count>0 && <p role="status" className="text-sm border rounded p-3 text-amber-800">
        זוהו {view.duplicateAssignmentVersions.count} זוגות או קבוצות של הודעות שיבוץ עם אותה גרסת עדכון עסקית במדגם.
        אלה אירועים היסטוריים המחייבים בדיקת מקור מול תור; אין לשלוח מחדש או למחוק הודעות.
        לפירוט לחץ על "בדיקת התאמה מקור ↔ תור" בהמשך.
        {view.duplicateAssignmentVersions.sampleTruncated && ' הנתונים מוגבלים ל־500 הרשומות האחרונות.'}
      </p>}
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
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('metrics')}>מדידת ביצועי התור</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('sourceAudit')}>בדיקת התאמה מקור ↔ תור (ללא שליחה)</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('inboundAudit')}>בדיקת תגובות WhatsApp (ללא שליחה)</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('unknownCallbackAudit')}>בדיקת כפתורים לא מזוהים (קריאה בלבד)</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('greenButtonQaReadiness')}>מוכנות ניסוי כפתורים למספר אחד (ללא שליחה)</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('interactiveReadiness')}>מוכנות תוכנית הכפתורים המלאה (ללא שליחה)</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('greenWebhookSettingsAudit')}>בדוק הגדרות Green API (קריאה אחת, ללא שינוי)</Button>
        <Button size="sm" variant="outline" disabled={busy||!form.enabled||form.paused}
          onClick={()=>window.confirm('להפעיל עובד תור כעת? הפעולה עשויה לשלוח הודעות אמיתיות.')&&run('kick')}>
          <Play className="h-4 w-4 ml-2"/>הפעל עובד עכשיו
        </Button>
      </div>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice&&<p role="status" className="text-sm text-green-700">{notice}</p>}
      {greenWebhookSettings&&<details open className="rounded border p-3 text-sm" dir="rtl">
        <summary className="cursor-pointer font-medium">מיפוי Green API הקיים — בדיקת GetSettings לקריאה בלבד</summary>
        <div className="pt-3 space-y-2 text-xs">
          <p className="text-gray-600">בדיקה יזומה אחת בלבד; לא משנה כתובת Webhook, מרווחי שליחה או סוגי התראות. אין כאן אישור שהכפתורים נתמכים בחשבון.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>Webhook מוגדר: {greenWebhookSettings.webhookConfigured?'כן':'לא'}</span>
            <span>טכנולוגיית קליטה: {greenWebhookSettings.webhookDeliveryMode==='push_configured'?'Push':'Polling או ללא הגדרה'}</span>
            <span>התראות נכנסות: {greenWebhookSettings.notificationFlags?.incomingWebhook==='yes'?'פעילות':greenWebhookSettings.notificationFlags?.incomingWebhook==='no'?'כבויות':'לא ידוע'}</span>
            <span>סוד Webhook: {greenWebhookSettings.webhookTokenConfigured?'מוגדר':'לא מוגדר'}</span>
            <span>קטגוריות פעילות: {greenWebhookSettings.activeCategories??'לא ידוע'}</span>
            <span>השהיית Green API (בנפרד ממרווח התור): {greenWebhookSettings.sendDelayMs===null?'לא ידוע':greenWebhookSettings.sendDelayMs+' מילישניות'}</span>
          </div>
          {greenWebhookSettings.existingWebhookMustBePreserved&&<p className="text-amber-800 font-medium">קיימת כתובת Webhook! אסור להחליף אותה בלי לוודא שממשיכים לטפל בכל ההתראות שכבר מגיעות אליה.</p>}
          {greenWebhookSettings.endpointProtocol==='non_https_or_invalid'&&<p className="text-amber-800">כתובת Webhook קיימת אינה כתובת HTTPS תקינה — נדרש בירור.</p>}
          <div className="flex flex-wrap gap-2">
            {Object.entries(greenWebhookSettings.notificationFlags||{}).map(([key,value])=><span key={key} className="rounded border px-2 py-1">{key}: {value==='yes'?'כן':value==='no'?'לא':'לא ידוע'}</span>)}
          </div>
          <p className="text-gray-600">מפתחות, כתובות Webhook, מספרי טלפון ופרטי חשבון אינם מוצגים או מועברים לדפדפן. הבדיקה אינה שולחת הודעות WhatsApp ואינה בודקת קליטת כפתור אמיתית.</p>
        </div>
      </details>}
      {qaReadiness&&<details open className="rounded border p-3 text-sm" dir="rtl">
        <summary className="font-medium cursor-pointer">ניסוי כפתורים למספר אחד — {qaReadiness.checks?.filter(x=>!x.ready).length||0} תנאים חסרים</summary>
        <div className="space-y-2 pt-3 text-xs">
          <p className="font-medium text-amber-800">{qaReadiness.readyForQa?'תנאי התצורה לניסוי מוכנים, אך עדיין דרושות בדיקת ספק והוכחת קליטה חיה.':'הניסוי עדיין חסום; אין כפתורים פעילים ואין שינוי בשליחות הרגילות.'}</p>
          <ul className="space-y-1">
            {(qaReadiness.checks||[]).map(check=><li key={check.key}>
              {check.ready?'✓':'○'} {({owner_queue_gate:'אישור הפעלה במנגנון התור',send_env_gate:'אישור שליחה ניסיונית בשרת',inbound_env_gate:'אישור קליטת תגובות בשרת',owner_env_gate:'אישור מנהל־העל בשרת',provider_beta_verified:'אימות יכולות הכפתורים בחשבון Green',one_qa_chat:'מספר בדיקה יחיד בשרת',green_credentials:'פרטי חיבור Green תקינים',signing_secret:'מפתח חתימת כפתורים',webhook_bearer:'סוד אימות Webhook',office_draft_saved:'טיוטת שלושה כפתורים ומספר משרד'})[check.key]||check.key}
            </li>)}
          </ul>
          <p className="text-gray-600">גם כשהתצורה מוכנה, יש לוודא שכתובת ה־Webhook הקיימת וצרכני ההודעות האחרים נשמרים. אין אפשרות להפעיל את הניסוי דרך הבדיקה הזאת. כל שאר הספקים ממשיכים במסלול השליחה הרגיל.</p>
        </div>
      </details>}
      {interactiveReadiness&&<details className="rounded border p-3 text-sm" dir="rtl">
        <summary className="font-medium cursor-pointer">מוכנות כפתורים — {interactiveReadiness.blockers?.length||0} תנאים עדיין לא הושלמו</summary>
        <div className="pt-3 space-y-2">
          <p className="text-amber-800 font-medium">הכפתורים אינם פעילים. אין אפשרות להפעיל אותם מהבדיקה הזו.</p>
          <p className="text-xs text-gray-700">מדיניות קליטה שאושרה: רק לחיצה מזוהה על כפתורי אישור/דחייה תטופל כשיבוץ. הודעות ידניות, קוליות, תמונות ותגובות רגילות מסוננות ללא קריאות למסד. כפתור ״פנייה למשרד״ פותח טיוטת WhatsApp עם אסמכתא ואינו מאשר או דוחה שיבוץ. פורמט כפתור חדש ולא מזוהה ייבדק ולא יימחק אוטומטית. מדיניות זו אינה משנה חיבורי WhatsApp אחרים.</p>
          <p className="text-xs text-gray-600">הבדיקה קוראת רק תצורה מקומית ומחזירה סימוני מוכנות. היא אינה מאמתת בפועל את התמיכה בחשבון Green API ואינה שולחת הודעות.</p>
          {interactiveReadiness.unexpectedControlFlagEnabled&&<p role="alert" className="text-red-700 font-medium">דגל ההפעלה נשמר כפעיל באופן לא צפוי. מנגנון השליחה עדיין אינו מחובר בייצור; נדרש בירור לפני כל שינוי.</p>}
          <ul className="space-y-1 text-xs">
            {(interactiveReadiness.checks||[]).map(x=><li key={x.code}>
              <strong className={x.passed?'text-green-700':'text-amber-800'}>{x.passed?'תקין':'לא הושלם'}</strong> · {x.label}
            </li>)}
          </ul>
          <p className="text-xs text-gray-600">יש לאמת בנפרד קבלת הודעה אמיתית, קישור לשיבוץ, אימות ספק ומניעת כפילויות לפני אישור הפעלה. לא מוצגים מפתחות או מספרי טלפון.</p>
        </div>
      </details>}
      {unknownCallbackAudit&&<details open className="rounded border p-3 text-sm" dir="rtl">
        <summary className="font-medium cursor-pointer">תגובות Green לא מזוהות — {unknownCallbackAudit.pendingReview||0} ממתינות לבירור במדגם</summary>
        <div className="space-y-2 pt-3 text-xs">
          <p className="text-amber-800 font-medium">זוהי רשומת בירור של פורמט שאינו נתמך, ולא אישור או דחיית ספק. אין טיפול אוטומטי חוזר ואין אפשרות לשנות כאן שיבוץ.</p>
          <p className="text-gray-600">מוצגים לכל היותר 40 רישומים. כברירת מחדל נשמרות רק טביעות HMAC. אפשרות עתידית לשמירת מידע מינימלי מוצפן אינה מופעלת; אם תופעל לאחר אישור נפרד, התוכן לא ייחשף במסך הזה. לא מוצגים מספרי טלפון, תוכן הודעות, מפתחות או פרטי כפתורים. אפילו אירוע מוצפן אינו מאשר או דוחה ספק ואינו ACK מוצלח.</p>
          {unknownCallbackAudit.sampleTruncated&&<p className="text-amber-800">המדגם מוגבל ל־40 הרשומות האחרונות.</p>}
          {unknownCallbackAudit.retentionSample&&<p className="text-gray-700">במדגם הנוכחי: {unknownCallbackAudit.retentionSample.encryptedInSample||0} רשומות מוצפנות; {unknownCallbackAudit.retentionSample.expiredInSample||0} רשומות שתוקפן פג; {unknownCallbackAudit.retentionSample.invalidExpiryInSample||0} עם תאריך תפוגה לא תקין; {unknownCallbackAudit.retentionSample.expiringWithin12hInSample||0} יפוגו בתוך 12 שעות. זו אינה בדיקת כלל הרשומות.</p>}
          {!!unknownCallbackAudit.retentionSample?.invalidExpiryInSample&&<p className="text-red-700">נמצאו תאריכי תפוגה לא תקינים במדגם. ניקוי אוטומטי לפי תאריך לא יכלול אותן; נדרש בירור מנהל לפני הפעלה חיה.</p>}
          {unknownCallbackAudit.list?.length?<ul className="space-y-1">
            {unknownCallbackAudit.list.map((entry,index)=><li key={entry.reference+'-'+index} className="rounded border p-2">
              <span>טביעת זיהוי: {entry.reference}</span> · <span>{entry.format==='unrecognized_interactive'?'תגובה אינטראקטיבית לא מוכרת':'הודעה נכנסת לא מזוהה'}</span> · <span>נרשם: {entry.receivedAt||'לא ידוע'}</span> · <span>דורש בירור ידני</span> · <span>{entry.encryptedRecoveryRecorded?'קיים מידע מוצפן, לשימוש מורשה בלבד':'טביעת זיהוי בלבד'}</span>
              {entry.encryptedRecoveryRecorded&&entry.reviewRecordId&&entry.encryptedRecoveryExpiresAt&&Date.parse(entry.encryptedRecoveryExpiresAt)>Date.now()&&<Button size="sm" variant="outline" disabled={busy}
                onClick={()=>run('unknownRecoveryStructureReview',{id:entry.reviewRecordId,reference:entry.reference})}>בדוק מבנה בלבד (ללא חשיפת תוכן)</Button>}
            </li>)}
          </ul>:<p className="text-gray-600">לא נמצאו רשומות בירור במדגם.</p>}
          <p className="text-gray-600">ניקוי ידני של מידע מוצפן שפג תוקפו אינו מחליף מדיניות מחיקה אוטומטית מאושרת; אין הוכחת מחיקה מגיבויי Base44.</p>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={()=>window.confirm('לנקות לכל היותר 20 רשומות מוצפנות שתוקפן פג? זו פעולה בלתי הפיכה בשדות ההצפנה של הרשומה הפעילה. רשומות HMAC נשארות, וגיבויים אינם נמחקים אוטומטית.')&&run('unknownRecoveryExpiryCleanup')}>
            נקה מידע מוצפן שפג תוקפו (פעולה ידנית)
          </Button>
        </div>
      </details>}
      {unknownRecoveryReview&&<section className="text-xs rounded border p-3 space-y-1" dir="rtl" aria-label="בירור מבנה תגובה מוצפנת">
        <strong>בדיקת מבנה — אסמכתת HMAC {unknownRecoveryReview.reference}</strong>
        <p>סוג מבנה: {unknownRecoveryReview.class==='list_like'?'בחירה מרשימה':unknownRecoveryReview.class==='interactive_like'?'תגובה אינטראקטיבית':'לא ידוע'}. מזהה בחירה נמצא: {unknownRecoveryReview.hasSelectionIdentifierHint?'כן':'לא'}. הפניה להודעת מקור נמצאה: {unknownRecoveryReview.hasOriginalMessageReferenceHint?'כן':'לא'}.</p>
        <p className="text-amber-800">זו אבחנה טכנית בלבד, ללא שמות, מספרי טלפון, תוכן ההודעה או מזהי כפתורים. היא אינה מאשרת או דוחה שיבוץ ואינה מהווה אישור קליטה מול Green.</p>
      </section>}
      {unknownRecoveryCleanup&&<p className="text-xs rounded border p-2" dir="rtl">נבדקו {unknownRecoveryCleanup.scanned} רשומות שפג תוקפן. ניקוי מאומת של {unknownRecoveryCleanup.scrubbed} שדות הצפנה. תוצאות לא מאומתות: {unknownRecoveryCleanup.unverified}. {unknownRecoveryCleanup.incomplete?'ייתכן שנדרש בירור או ניקוי נוסף.':'המקבץ הנוכחי הושלם.'} שים לב: תאריכי תפוגה פגומים לא נכללים בסינון, וייתכנו רשומות נוספות מחוץ למדגם. גיבויים אינם נחשבים מחוקים.</p>}
      {inboundAudit&&<details className="rounded border p-3 text-sm" dir="rtl">
        <summary className="font-medium cursor-pointer">תגובות כפתורים — בדיקת קליטה פנימית (לא פעיל בפרודקשן)</summary>
        <div className="pt-3 space-y-2">
          <p className="text-xs text-gray-600">מדגם של עד 100 רשומות בלבד. הכפתורים עדיין כבויים; הבדיקה אינה שולחת הודעות ואינה משנה שיבוצים.</p>
          {inboundAudit.registrationBlocked&&<p role="alert" className="text-amber-800 font-semibold">רישום תגובות חדשות חסום עקב תוצאת שמירה לא ודאית. נדרש בירור ידני. אין לנסות שליחה/טיפול חוזר אוטומטי.</p>}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <span>נקלטו במדגם: {inboundAudit.sampleCount||0}</span>
            <span>ממתינות: {inboundAudit.totals?.pending||0}</span>
            <span>בטיפול: {inboundAudit.totals?.processing||0}</span>
            <span>בוצעו: {inboundAudit.totals?.applied||0}</span>
            <span>נדחו: {inboundAudit.totals?.rejected||0}</span>
            <span>דורשות בירור: {inboundAudit.totals?.needs_review||0}</span>
            <span>נעילת טיפול שפגה: {inboundAudit.expiredProcessing||0}</span>
          </div>
          {inboundAudit.sampleTruncated&&<p className="text-xs text-amber-700">המדגם מוגבל ל־100 הרשומות האחרונות.</p>}
          {!!inboundAudit.review?.length&&<ul className="text-xs list-disc list-inside space-y-1">
            {inboundAudit.review.map(x=><li key={x.id} className="flex gap-2 items-center flex-wrap">
              <span>{x.id} · {x.provider} · {x.reason==='expired_processing'?'נעילה שפגה — בירור ידני':'תוצאה לבדיקה'}</span>
              <Button variant="outline" size="sm" disabled={busy}
                onClick={()=>run('inboundInspect',{id:x.id})}>בדוק רשומה (ללא שינוי)</Button>
            </li>)}
          </ul>}
          {inboundDetail&&<section className="border rounded p-3 text-xs space-y-2" aria-label="בירור רשומת WhatsApp">
            <strong>בירור רשומה {inboundDetail.receiptId}</strong>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>ספק: {inboundDetail.provider}</span>
              <span>מצב: {inboundDetail.state}</span>
              <span>סטטוס שיבוץ נוכחי: {inboundDetail.currentStatus}</span>
              <span>הסטטוס הצפוי: {inboundDetail.expectedStatus}</span>
              <span>גרסת שיבוץ: {inboundDetail.currentRevision}</span>
              <span>נעילה שפגה: {inboundDetail.expiredClaim?'כן':'לא'}</span>
              <span>חסימת רישום: {inboundDetail.registrationBlocked?'כן':'לא'}</span>
            </div>
            {inboundDetail.stateMatchesExpected&&<p className="text-amber-800">מצב השיבוץ תואם לתגובה, אך אין בכך הוכחה שהתגובה הזו היא שביצעה את העדכון.</p>}
            {inboundDetail.registrationBlocked&&<p className="text-amber-800">נדרשת בדיקה של רשומת ההגנה החוסמת קליטה חדשה. אין לשחרר נעילה אוטומטית.</p>}
            <p className="text-amber-800">נדרש בירור ידני מול נתוני הספק והמסד. אין טיפול חוזר אוטומטי או שינוי שיבוץ מתוך בדיקה זו.</p>
            <Button variant="outline" size="sm" onClick={()=>setInboundDetail(null)}>סגור פרטים</Button>
          </section>}
          <p className="text-xs text-gray-600">אין כאן פעולה לאישור, דחייה או שליחה מחדש. מצב ״בוצע״ מתייחס לרישום פעולה עסקית בלבד, לא למסירת הודעת WhatsApp.</p>
        </div>
      </details>}
      {sourceAudit&&<section aria-label="בדיקת התאמה WhatsApp למקור" className="rounded-lg border p-3 space-y-2 text-sm">
        <strong>התאמת מקור ↔ תור — {sourceAudit.sampledInApp} התראות ו־{sourceAudit.sampledOutbox} הודעות במדגם</strong>
        <p className="text-xs text-gray-600">זו בדיקה לקריאה בלבד. הודעת WhatsApp ללא קישור ל־Outbox עשויה להיות ישנה או הודעת Push בלבד — אין בכך הוכחה לכשל. "התקבל אצל הספק" אינו אישור מסירה.</p>
        {sourceAudit.businessReminders?.available?<details className="rounded border p-2" open>
          <summary className="cursor-pointer font-medium">תזכורות עסקיות שטרם הגיעו לתור הספק — {sourceAudit.businessReminders.whatsappWaiting} הודעות WhatsApp במדגם</summary>
          <p className="text-xs pt-2">ממתינות לתאריך או לתנאי: {sourceAudit.businessReminders.scheduledFuture} עתידיות; {sourceAudit.businessReminders.scheduledDue} הגיע מועדן. הגעת המועד אינה הוכחה לכשל — יש לבדוק גם את עובד התזכורות.</p>
          <p className="text-xs">עם מזהה עסקי: {sourceAudit.businessReminders.withBusinessKey}; רשומות ותיקות ללא מזהה עסקי: {sourceAudit.businessReminders.legacyWithoutBusinessKey}. אלה אינן נשלחות שוב אוטומטית באבחון.</p>
          {sourceAudit.businessReminders.sampleTruncated&&<p className="text-xs text-amber-700">הנתונים מוגבלים למדגם האחרון, ולא לכלל התזכורות.</p>}
          <ul className="list-disc list-inside text-xs pt-1">{(sourceAudit.businessReminders.byTemplate||[]).map(x=><li key={x.templateType}>{x.templateType}: {x.count}</li>)}</ul>
        </details>:<p className="text-xs text-amber-700">לא ניתן לקרוא כרגע את תזכורות המקור. זה אינו אומר שאין תזכורות ממתינות.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="rounded border p-2">כפילויות שיבוץ שאותרו במדגם: <strong>{sourceAudit.duplicateAssignments?.length||0}</strong></div>
          <div className="rounded border p-2">אישור ספק בלי עדכון התראה: <strong>{sourceAudit.acceptedWithoutMirror?.length||0}</strong></div>
          <div className="rounded border p-2">תוצאה לא ידועה מול סימון נשלח: <strong>{sourceAudit.unknownWithSentMirror?.length||0}</strong></div>
          <div className="rounded border p-2">התראות מסומנות ללא קישור במדגם: <strong>{sourceAudit.unlinkedSentFlag?.length||0}</strong></div>
        </div>
        {[
          ['שתי הודעות לאותו שיבוץ (אותו מועד עדכון)',sourceAudit.duplicateAssignments],
          ['אישור ספק שאינו משתקף בהתראה',sourceAudit.acceptedWithoutMirror],
          ['תוצאה לא ידועה אך ההודעה מסומנת כנשלחה',sourceAudit.unknownWithSentMirror],
          ['דיווח היסטורי ללא קישור במדגם (לא הוכחת אובדן)',sourceAudit.unlinkedSentFlag]
        ].map(([label,rows])=><details key={label} className="border rounded p-2">
          <summary className="cursor-pointer font-medium">{label} — עד {rows?.length||0} פריטים</summary>
          <ul className="list-disc list-inside pt-2 space-y-1 text-xs">
            {(rows||[]).map((item,i)=><li key={item.inAppId||item.eventServiceId||i}>{item.jobIds?`שיבוץ ${item.eventServiceId} · ספק ${item.supplierId} · הודעות ${item.jobIds.join(', ')} · סטטוסים ${item.statuses?.join(', ')}`:`התראה ${item.inAppId} ${item.jobId?'· הודעה '+item.jobId:''} ${item.templateType?'· '+item.templateType:''}`}</li>)}
          </ul>
        </details>)}
        <p className="text-xs text-amber-700">אין כאן לחצן שליחה מחדש. תוצאה לא ידועה מחייבת בדיקה אצל ספק WhatsApp כדי למנוע כפילויות.</p>
      </section>}
      {metrics&&<section aria-label="מדדי ביצועי WhatsApp" className="rounded-lg border p-3 space-y-2 text-sm">
        <strong>מדדי ביצועי התור — {metrics.sampled} רשומות אחרונות, לא כלל ההיסטוריה</strong>
        <p className="text-xs text-gray-500">נמדד מתוך חותמות זמן הקיימות ב־Outbox. המתנה מכוונת לשעות שקט אינה נחשבת לעיכוב תור. אישור API אינו אישור מסירה. מדידה מפורטת זמינה רק להודעות שנוצרו לאחר שדרוג מערכת המדדים.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {[
            ['המתנה בתור לאחר מועד היעד',metrics.timings?.queueWait],
            ['זמן טיפול לאחר תחילת ניסיון',metrics.timings?.providerProcessing],
            ['סה״כ מרגע שההודעה הייתה מוכנה',metrics.timings?.afterDue]
          ].map(([label,sample])=><div key={label} className="rounded border p-2">
            <div className="font-medium">{label}</div>
            <div>חציון: {sample?.p50Ms==null?'אין נתון':(sample.p50Ms/1000).toFixed(1)+' שניות'}</div>
            <div>95%: {sample?.p95Ms==null?'אין נתון':(sample.p95Ms/1000).toFixed(1)+' שניות'}</div>
            <div className="text-xs text-gray-500">מדגם תקין: {sample?.count||0}</div>
          </div>)}
        </div>
        <details className="rounded border p-2">
          <summary className="cursor-pointer font-medium">פירוט הסיבות לעיכוב — {metrics.detailedTimingCount||0} הודעות עם נתוני מדידה חדשים</summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-3">
            {[
              ['המתנה להודעות קודמות',metrics.timings?.backlogWait],
              ['ויסות קצב הספק',metrics.timings?.pacingWait],
              ['זמן עד שהעובד הגיע להודעה',metrics.timings?.workerLag],
              ['עבודה בשרת לפני ניסיון השליחה',metrics.timings?.claimToTransport],
              ['זמן פעולת השליחה (כולל הכנת קובץ)',metrics.timings?.transportDuration],
              ['שמירת תוצאת השליחה במסד',metrics.timings?.persistence]
            ].map(([label,item])=><div key={label} className="rounded border p-2">
              <div className="font-medium">{label}</div>
              <div>חציון: {item?.p50Ms==null?'טרם נמדד':(item.p50Ms/1000).toFixed(2)+' שניות'}</div>
              <div>95%: {item?.p95Ms==null?'טרם נמדד':(item.p95Ms/1000).toFixed(2)+' שניות'}</div>
              <div className="text-xs text-gray-500">רשומות: {item?.count||0}</div>
            </div>)}
          </div>
          <p className="pt-2 text-xs text-gray-500">תחילת ניסיון ועד תוצאה כוללת גם כתיבת תוצאות. פעולת השליחה כוללת גם הכנת קישור חתום למסמך, ולכן אינה זמן רשת HTTP טהור.</p>
          <p className="text-xs text-gray-500">מקורות התעוררות: {Object.entries(metrics.byWakeReason||{}).map(([reason,count])=>reason+': '+count).join(' · ')||'טרם נאסף מידע'}</p>
        </details>
        <p>ממתינות לאחר מועד היעד: <strong>{metrics.dueStillQueued}</strong> · עתידיות: <strong>{metrics.scheduledForFuture}</strong> · תוצאה לא ידועה: <strong>{metrics.unknownCount}</strong></p>
        {!!metrics.missingAttemptTimestamp&&<p className="text-amber-700">ב־{metrics.missingAttemptTimestamp} רשומות חסרה חותמת תחילת ניסיון — מדדי זמני התור לגביהן אינם זמינים.</p>}
        <table className="w-full text-right text-xs">
          <thead><tr><th>ספק</th><th>ניסיונות במדגם</th><th>חציון המתנה בתור</th><th>חציון ריצה עד רישום תוצאה</th><th>פעולת שליחה בלבד</th></tr></thead>
          <tbody>{Object.entries(metrics.byProvider||{}).map(([provider,item])=><tr key={provider} className="border-t">
            <td>{provider==='wasender'?'WasenderAPI':provider==='green'?'Green API':provider}</td>
            <td>{item.count}</td>
            <td>{item.queueWait?.p50Ms==null?'חסר':(item.queueWait.p50Ms/1000).toFixed(1)+' שניות'}</td>
            <td>{item.providerProcessing?.p50Ms==null?'חסר':(item.providerProcessing.p50Ms/1000).toFixed(1)+' שניות'}</td>
            <td>{item.transportDuration?.p50Ms==null?'טרם נמדד':(item.transportDuration.p50Ms/1000).toFixed(2)+' שניות'}</td>
          </tr>)}</tbody>
        </table>
        <details className="border rounded p-2">
          <summary className="cursor-pointer font-medium">פירוט זמני התור לפי סוג הודעה (מדגם היסטורי)</summary>
          <p className="text-xs text-gray-600 py-2">
            נמדד לאחר מועד היעד של ההודעה, ללא המתנה מכוונת לשעות שקט.
            תוצאה של חמש דקות יכולה להעיד על התעוררות Watchdog מאוחרת — אך אינה מוכיחה לבדה מה גרם לה.
            זמן פעולת הספק מחושב רק כשהיו חותמות Transport מפורטות.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs min-w-[580px]">
              <thead><tr><th>סוג הודעה</th><th>ניסיונות</th><th>חציון המתנה בתור</th>
                <th>95% מהזמן לאחר היעד</th><th>חציון פעולת ספק</th></tr></thead>
              <tbody>{Object.entries(metrics.bySource||{})
                .sort((a,b)=>b[1].count-a[1].count).slice(0,20).map(([source,item])=><tr key={source} className="border-t">
                  <td>{source}</td><td>{item.count}</td>
                  <td>{item.queueWait?.p50Ms==null?'אין נתון':(item.queueWait.p50Ms/1000).toFixed(1)+' שניות'}</td>
                  <td>{item.afterDue?.p95Ms==null?'אין נתון':(item.afterDue.p95Ms/1000).toFixed(1)+' שניות'}</td>
                  <td>{item.transportDuration?.p50Ms==null?'לא נמדד':(item.transportDuration.p50Ms/1000).toFixed(2)+' שניות'}</td>
                </tr>)}</tbody>
            </table>
          </div>
        </details>
      </section>}
      <details className="border rounded p-3 text-sm" dir="rtl">
        <summary className="cursor-pointer font-medium">איתור שיבוץ לפי אסמכתא מפנייה ב־WhatsApp (ללא שליחה)</summary>
        <div className="pt-3 space-y-3">
          <p className="text-xs text-gray-600">כשהספק פונה למשרד עם אסמכתת ההודעה, אפשר למצוא את האירוע והשירות המקוריים. החיפוש מוגבל לאסמכתא מדויקת אחת, ונשלח רק בלחיצה.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px] max-w-sm space-y-1">
              <Label htmlFor="wa-office-reference">אסמכתת הודעה</Label>
              <Input id="wa-office-reference" aria-label="אסמכתת הודעת שיבוץ"
                value={officeReference} maxLength={128} disabled={busy}
                placeholder="מזהה ההודעה אחרי המילה אסמכתא"
                onChange={event=>{setOfficeReference(event.target.value);setOfficeLookup(null);}}/>
            </div>
            <Button variant="outline" size="sm" disabled={busy||!/^[A-Za-z0-9_-]{3,128}$/.test(officeReference)}
              onClick={()=>run('officeReferenceLookup',{reference:officeReference})}>
              אתר הודעת שיבוץ
            </Button>
          </div>
          {officeLookup&&<section role="status" className="border rounded p-3 space-y-2 text-xs" aria-label="פרטי הודעת שיבוץ לפי אסמכתא">
            <strong>אסמכתא: {officeLookup.reference}</strong>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span>אירוע: {officeLookup.eventName||'לא זמין'}</span>
              <span>תאריך: {officeLookup.eventDate||'לא זמין'}</span>
              <span>שירות: {officeLookup.serviceName||'לא זמין'}</span>
              <span>ספק: {officeLookup.supplierName||'לא זמין'}</span>
              <span>סטטוס ספק נוכחי: {({pending:'ממתין',confirmed:'מאושר',rejected:'נדחה'})[officeLookup.supplierStatus]||'לא ידוע'}</span>
              <span>מצב הודעת המקור: {officeLookup.messageStatus}</span>
            </div>
            {officeLookup.originState==='current_revision'
              ?<p className="text-green-700">האסמכתא קשורה לגרסת השיבוץ האחרונה ביומן.</p>
              :<p className="text-amber-800">לא אומתה גרסת שיבוץ עדכנית ({officeLookup.originState}). ייתכן שמדובר בהודעה ישנה או ברשומה היסטורית.</p>}
            <p className="text-gray-600">אסמכתה וסטטוס אינם הוכחה למסירת הודעה, ללחיצה על כפתור או לזהות שולח הפנייה. אין כאן שינוי שיבוץ או ניסיון שליחה חוזר.</p>
          </section>}
        </div>
      </details>
      <div className="border-t pt-4"><WhatsAppWebhookCreditsEstimator /></div>
      <div className="border-t pt-4"><WhatsAppInteractiveDraftSettings /></div>
      <div className="border-t pt-4 space-y-3">
        <Button type="button" size="sm" variant="outline" aria-expanded={messagesOpen}
          aria-controls="whatsapp-queue-messages-panel" onClick={()=>setMessagesOpen(open=>!open)}>
          {messagesOpen?'סגור רשימת הודעות':'פתח רשימת הודעות בתור'}
        </Button>
        {messagesOpen&&<div id="whatsapp-queue-messages-panel">
          <WhatsAppQueueMessages refreshSignal={refreshSignal}/>
        </div>}
        {!messagesOpen&&<p className="text-xs text-gray-500">רשימת ההודעות נטענת רק בלחיצה — ללא בקשת נתונים מיותרת.</p>}
      </div>
      <p className="text-xs text-gray-500">הודעה שהתקבלה אצל ספק WhatsApp אינה בהכרח הודעה שנמסרה לנמען. במצב לא ידוע יש לאמת אצל הספק לפני שליחה מחדש.</p>
      {(totals.unknown||0)>0&&<p className="text-sm text-amber-700 flex gap-2">
        <AlertTriangle className="h-4 w-4"/>תוצאה לא ידועה אינה נשלחת שוב אוטומטית.</p>}
    </div>
  </details>;
}
