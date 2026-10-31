import React,{useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Switch} from '@/components/ui/switch';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {RefreshCw,Save,Play,AlertTriangle} from 'lucide-react';
import WhatsAppQueueMessages from './WhatsAppQueueMessages';
import WhatsAppLiveButtonSettings from './WhatsAppLiveButtonSettings';
import WhatsAppSupplierNoticeButtons from './WhatsAppSupplierNoticeButtons';

// Production operations only. Previous pilot receiver/records are preserved
// server-side for valid historical replies, with no active QA controls here.
const DEFAULT={enabled:false,paused:false,wasenderIntervalMs:7000,greenIntervalMs:7000,maxMessagesPerRun:16};
const count=v=>Number(v)||0;
const showDate=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('he-IL'):'לא זמין';
const Header=({children})=><h3 className="font-semibold">{children}</h3>;
function IntervalEditor({name,value,onChange,disabled}){
 return <label className="block space-y-1 text-sm">
  <span className="font-medium">{name} — מרווח בין הודעות (שניות)</span>
  <Input aria-label={'מרווח '+name} type="number" min="0" max="300" step="0.1"
   disabled={disabled} value={value/1000} onChange={e=>{
    const number=Number(e.target.value);
    if(Number.isFinite(number))onChange(Math.round(Math.max(0,Math.min(300,number))*1000));
   }}/>
 </label>;
}
export default function WhatsAppQueueSettings(){
 const reviewDeepLink=typeof window!=='undefined'&&
  new URLSearchParams(window.location.search).get('whatsappQueue')==='review';
 const [expanded,setExpanded]=useState(reviewDeepLink);
 const [form,setForm]=useState(DEFAULT),[view,setView]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [messagesOpen,setMessagesOpen]=useState(reviewDeepLink),[refreshSignal,setRefreshSignal]=useState(0);
 const [productionCheck,setProductionCheck]=useState(null);
 const [greenConnection,setGreenConnection]=useState(null),[greenWebhookSettings,setGreenWebhookSettings]=useState(null);
 const [officeReference,setOfficeReference]=useState(''),[officeLookup,setOfficeLookup]=useState(null);
 const [metrics,setMetrics]=useState(null),[sourceAudit,setSourceAudit]=useState(null);
 const [inboundAudit,setInboundAudit]=useState(null),[inboundDetail,setInboundDetail]=useState(null);
 const [unknownCallbackAudit,setUnknownCallbackAudit]=useState(null);
 const [unknownRecoveryReview,setUnknownRecoveryReview]=useState(null),[unknownRecoveryCleanup,setUnknownRecoveryCleanup]=useState(null);
 const apply=data=>{setView(data);if(data?.config)setForm(data.config);};
 async function read(){
  const r=await base44.functions.invoke('WhatsAppQueueAdmin',{action:'status'});
  if(!r.data?.success)throw Error(r.data?.error||'קריאת המצב נכשלה');
  apply(r.data);setRefreshSignal(x=>x+1);
 }
 useEffect(()=>{
  if(reviewDeepLink)document.getElementById('whatsapp-queue')?.scrollIntoView({block:'start'});
 },[reviewDeepLink]);
 useEffect(()=>{
  if(!expanded)return;
  let alive=true;
  base44.functions.invoke('WhatsAppQueueAdmin',{action:'status'})
   .then(r=>{if(alive&&r.data?.success)apply(r.data);else if(alive)setError('לא ניתן לטעון מצב WhatsApp');})
   .catch(()=>{if(alive)setError('לא ניתן לטעון מצב WhatsApp');});
  return()=>{alive=false;};
 },[expanded]);
 async function run(action,params={}){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  if(action==='unknownRecoveryStructureReview')setUnknownRecoveryReview(null);
  if(action==='greenWebhookSettingsAudit')setGreenWebhookSettings(null);
  if(action==='greenInstanceStateAudit')setGreenConnection(null);
  try{
   const r=await base44.functions.invoke('WhatsAppQueueAdmin',{action,...params});
   const data=r.data||{};
   if(!data.success)throw Error(data.error||'הפעולה נכשלה');
   if(action==='status'){apply(data);setRefreshSignal(x=>x+1);}
   else if(action==='configure'){
    apply(data);setRefreshSignal(x=>x+1);setNotice('הגדרות השליחה נשמרו.');
   }else if(action==='kick'){
    await read();setNotice('עובד התור הופעל. הודעות ממתינות עשויות להישלח.');
   }else if(action==='greenInstanceStateAudit')setGreenConnection(data.connection);
   else if(action==='greenWebhookSettingsAudit')setGreenWebhookSettings(data.settings);
   else if(action==='officeReferenceLookup')setOfficeLookup(data.lookup);
   else if(action==='metrics')setMetrics(data.metrics);
   else if(action==='sourceAudit')setSourceAudit(data.audit);
   else if(action==='inboundAudit'){setInboundAudit(data.audit);setInboundDetail(null);}
   else if(action==='inboundInspect')setInboundDetail(data.inspection);
   else if(action==='unknownCallbackAudit'){setUnknownCallbackAudit(data.audit);setUnknownRecoveryReview(null);}
   else if(action==='unknownRecoveryStructureReview')setUnknownRecoveryReview(data.review);
   else if(action==='unknownRecoveryExpiryCleanup')setUnknownRecoveryCleanup(data.cleanup);
   else if(action==='diagnose'){
    const issues=(data.checks||[]).filter(x=>!x.ok).map(x=>x.step);
    if(!data.success||issues.length||data.failedStep)
     setError('נמצאה בעיית תור: '+(issues.join(', ')||data.failedStep||'לא ידועה'));
    else setNotice('התור תקין.');
   }
  }catch(e){setError(e?.response?.data?.error||e?.message||'הפעולה נכשלה');}
  finally{setBusy(false);}
 }
 async function saveQueue(){
  if(!view||busy)return;
  if(view.config.enabled!==form.enabled&&!window.confirm(form.enabled?
   'הפעלת התור מאפשרת שליחת הודעות WhatsApp ממתינות. להמשיך?':
   'כיבוי התור עשוי להפעיל מסלול שליחה חלופי. להמשיך?'))return;
  await run('configure',form);
 }
 async function toggleButtons(enable){
  if(busy||!view||!window.confirm(enable?
   'להפעיל כפתורי אישור, דחייה ופנייה למשרד בשיבוצים חדשים דרך Green?':
   'לכבות כפתורים בשיבוצים חדשים? תגובות להודעות שכבר נשלחו ימשיכו להיקלט.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const r=await base44.functions.invoke('greenAssignmentProductionAdmin',{
    action:enable?'enable':'disable',
    ...(enable?{confirmation:'ENABLE_GREEN_ASSIGNMENT_BUTTONS_FOR_ALL_NEW_ASSIGNMENTS'}:{})
   });
   if(!r.data?.success)throw Error(r.data?.error||'העדכון נכשל');
   setView(v=>({...v,interactiveButtonsEnabled:enable}));
   setProductionCheck(null);
   setNotice(enable?'כפתורים הופעלו להודעות חדשות.':'כפתורים חדשים כובו. תגובות ישנות נשמרות.');
  }catch(e){setError(e?.response?.data?.error||e?.message||'עדכון הכפתורים נכשל');}
  finally{setBusy(false);}
 }
 async function checkButtons(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const r=await base44.functions.invoke('greenAssignmentProductionAdmin',{action:'status'});
   if(!r.data?.success)throw Error(r.data?.error||'הבדיקה נכשלה');
   setProductionCheck(r.data);
   setView(v=>v?{...v,interactiveButtonsEnabled:r.data.enabled}:v);
  }catch(e){setError(e?.response?.data?.error||e?.message||'בדיקת הכפתורים נכשלה');}
  finally{setBusy(false);}
 }
 const totals=view?.totals||{},queued=count(totals.queued)+count(totals.retry_wait);
 const failures=count(totals.failed)+count(totals.unknown);
 const queueStatus=!view?'לא נטען':!view.config.enabled?'כבוי':view.config.paused?'מושהה':view.workerBusy?'שולח הודעות':queued?'ממתינות הודעות':'התור ריק';
 const buttonStatus=!view?'לא נטען':!view.interactiveButtonsEnabled?'כבויים':view.activeProvider!=='green'?'Green אינו פעיל':'פעילים';
 const dirty=!!view&&JSON.stringify(form)!==JSON.stringify(view.config);
 return <details id="whatsapp-queue" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}
  className="rounded-lg border bg-white p-4" dir="rtl">
  <summary className="cursor-pointer font-semibold text-base">WhatsApp — ניהול שליחה והודעות</summary>
  <div className="pt-4 space-y-5">
   {error&&<p role="alert" className="text-sm text-red-700 border rounded p-2">{error}</p>}
   {notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
   <section className="space-y-3" aria-label="מצב WhatsApp">
    <div className="flex justify-between items-center gap-2">
     <Header>מצב המערכת</Header>
     <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('status')}>
      <RefreshCw className="h-4 w-4 ml-1"/>רענן מצב
     </Button>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
     {[['ספק שליחה',!view?'—':view.activeProvider==='wasender'?'WasenderAPI':'Green API'],
       ['מצב תור',queueStatus],['ממתינות',queued],['דורשות טיפול',failures]].map(([label,value])=>
      <div className="border rounded p-3" key={label}>
       <p className="text-xs text-gray-500">{label}</p><strong>{value}</strong>
      </div>)}
    </div>
    {view&&<div className="text-xs text-gray-600 flex flex-wrap gap-3">
     <span>אושרו אצל ספק השליחה: {count(totals.accepted)}</span>
     <span>עבודה אחרונה: {showDate(view.lastWorkerAt)}</span>
     <span>מוכנות כעת: {count(view.dueReadyCount)} · מתוזמנות לעתיד: {count(view.scheduledForFutureCount)}</span>
     {view.dueReadyCount>0&&view.nextAllowedInMs>0&&<span>מרווח שליחה שנותר: {(view.nextAllowedInMs/1000).toFixed(1)} שניות</span>}
     {view.watchdogLate&&<span className="text-amber-800">התאוששות התור מתעכבת</span>}
     {view.lastError&&<span className="text-red-700">שגיאה: {view.lastError}</span>}
    </div>}
    {view?.duplicateAssignmentVersions?.count>0&&<p role="alert" className="text-xs text-amber-800">
     נמצאו {view.duplicateAssignmentVersions.count} שיבוצים כפולים במדגם. ניתן לבדוק אותם בכלים המתקדמים בלי שליחה נוספת.
    </p>}
   </section>
   <section className="border-t pt-4 space-y-3" aria-label="שליחה וקצב">
    <Header>שליחה וקצב</Header>
    <div className="flex flex-wrap gap-5 text-sm">
     <label className="flex gap-2 items-center">
      <Switch checked={!!form.enabled} disabled={busy||!view}
       onCheckedChange={enabled=>setForm(p=>({...p,enabled}))}/>הפעל תור הודעות
     </label>
     <label className="flex gap-2 items-center">
      <Switch checked={!!form.paused} disabled={busy||!view}
       onCheckedChange={paused=>setForm(p=>({...p,paused}))}/>השהה שליחות חדשות
     </label>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
     <IntervalEditor name="Green API" value={form.greenIntervalMs} disabled={busy||!view}
      onChange={value=>setForm(p=>({...p,greenIntervalMs:value}))}/>
     <IntervalEditor name="WasenderAPI" value={form.wasenderIntervalMs} disabled={busy||!view}
      onChange={value=>setForm(p=>({...p,wasenderIntervalMs:value}))}/>
    </div>
    <details className="rounded border p-3 text-sm">
     <summary className="cursor-pointer font-medium">מגבלת עומס לעובד התור</summary>
     <div className="space-y-1 max-w-xs pt-3">
      <Label htmlFor="wa-batch">מספר הודעות מרבי בריצה</Label>
      <Input id="wa-batch" type="number" min="1" max="30" step="1"
       value={form.maxMessagesPerRun} disabled={busy||!view}
       onChange={e=>setForm(p=>({...p,maxMessagesPerRun:Number(e.target.value)}))}/>
     </div>
    </details>
    <Button size="sm" disabled={busy||!dirty} onClick={saveQueue}>
     <Save className="h-4 w-4 ml-1"/>שמור הגדרות שליחה
    </Button>
    {dirty&&<p className="text-xs text-amber-800">יש שינויים שלא נשמרו.</p>}
   </section>
   <section className="border-t pt-4 space-y-3" aria-label="כפתורי WhatsApp">
    <div className="flex justify-between items-center"><Header>כפתורי WhatsApp לספקים</Header><strong className="text-sm">{buttonStatus}</strong></div>
    <p className="text-sm text-gray-600">
     שיבוצים: אישור, דחייה ופנייה למשרד; קישור ללוח הספק בגוף ההודעה.
     תזכורות מתאימות: כפתורי כניסה למערכת ופנייה למשרד.
    </p>
    <Button size="sm" variant={view?.interactiveButtonsEnabled?'outline':'default'}
     disabled={busy||!view} onClick={()=>toggleButtons(!view.interactiveButtonsEnabled)}>
     {view?.interactiveButtonsEnabled?'כבה כפתורים בהודעות חדשות':'הפעל כפתורים בהודעות חדשות'}
    </Button>
    <WhatsAppLiveButtonSettings active={!!view?.interactiveButtonsEnabled}/>
    <WhatsAppSupplierNoticeButtons active={!!view?.interactiveButtonsEnabled}/>
    <details className="rounded border p-3 text-sm">
     <summary className="cursor-pointer font-medium">בדיקת מוכנות הכפתורים</summary>
     <div className="pt-3 space-y-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={checkButtons}>בדוק מוכנות שליחה</Button>
      {productionCheck&&<p className={productionCheck.sendReady?'text-green-800':'text-amber-800'}>
       {productionCheck.sendReady?'הכפתורים מוכנים.':'חסרים תנאים להפעלת הכפתורים.'}
       {!productionCheck.sendReady&&productionCheck.checks&&
        ' '+Object.entries(productionCheck.checks).filter(([,ok])=>!ok)
         .map(([key])=>({queue:'התור כבוי או מושהה',outboundOwnerSwitch:'כפתורים כבויים',
          greenProvider:'Green אינו ספק השליחה',
          verifiedGreenInteractive:'אימות Green אינו מוכן'})[key]||key).join(' · ')}
      </p>}
     </div>
    </details>
   </section>
   <section className="border-t pt-4 space-y-2" aria-label="ניהול הודעות">
    <div className="flex justify-between items-center gap-2">
     <Header>הודעות ותקלות</Header>
     <Button size="sm" variant="outline" aria-expanded={messagesOpen}
      aria-controls="whatsapp-queue-messages-panel"
      onClick={()=>setMessagesOpen(x=>!x)}>
      {messagesOpen?'סגור רשימה':'פתח ניהול הודעות'}
     </Button>
    </div>
    <p className="text-sm text-gray-600">צפייה בהודעות, ביטול הודעות ממתינות וטיפול בכשלים. ניסיון חוזר רק כשהמערכת מתירה זאת.</p>
    {messagesOpen&&<div id="whatsapp-queue-messages-panel">
     <WhatsAppQueueMessages refreshSignal={refreshSignal}/>
    </div>}
   </section>
   <section className="border-t pt-4 space-y-2">
    <details className="border rounded p-3 text-sm">
     <summary className="cursor-pointer font-medium">איתור שיבוץ לפי אסמכתא שהתקבלה במשרד</summary>
     <div className="pt-3 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
       <div className="max-w-sm flex-1 min-w-[200px] space-y-1">
        <Label htmlFor="wa-office-reference">אסמכתת ההודעה</Label>
        <Input id="wa-office-reference" maxLength={128} value={officeReference}
         disabled={busy} placeholder="הדבק אסמכתא"
         onChange={e=>{setOfficeReference(e.target.value.trim());setOfficeLookup(null);}}/>
       </div>
       <Button size="sm" variant="outline" disabled={busy||!/^[A-Za-z0-9_-]{3,128}$/.test(officeReference)}
        onClick={()=>run('officeReferenceLookup',{reference:officeReference})}>מצא שיבוץ</Button>
      </div>
      {officeLookup&&<div role="status" className="border rounded p-3 space-y-1">
       <p><strong>אירוע:</strong> {officeLookup.eventName||'לא ידוע'}</p>
       <p><strong>תאריך:</strong> {officeLookup.eventDate||'לא זמין'}</p>
       <p><strong>שירות:</strong> {officeLookup.serviceName||'לא ידוע'}</p>
       <p><strong>ספק:</strong> {officeLookup.supplierName||'לא ידוע'}</p>
       <p><strong>מצב השיבוץ:</strong> {({pending:'ממתין',approved:'מאושר',rejected:'נדחה'})[officeLookup.supplierStatus]||'לא ידוע'}</p>
       {officeLookup.originState!=='current_revision'&&<p className="text-amber-800">ייתכן שמדובר באסמכתא ישנה.</p>}
      </div>}
     </div>
    </details>
   </section>
   <section className="border-t pt-4 space-y-3" aria-label="ניהול מתקדם">
    <details className="rounded border p-3 text-sm">
     <summary className="cursor-pointer font-medium">חיבור Green וקליטת תגובות</summary>
     <div className="pt-3 space-y-3">
      <div className="flex gap-2 flex-wrap">
       <Button size="sm" variant="outline" disabled={busy}
        onClick={()=>run('greenInstanceStateAudit')}>בדוק חיבור Green</Button>
       <Button size="sm" variant="outline" disabled={busy}
        onClick={()=>run('greenWebhookSettingsAudit')}>בדוק קליטת תגובות (Webhook)</Button>
      </div>
      {greenConnection&&<p>מצב Green: <strong>{({authorized:'מחובר',notAuthorized:'לא מחובר',
       starting:'באתחול',sleepMode:'מצב שינה',blocked:'חסום',suspended:'מוגבל'})[greenConnection.state]||'לא ידוע'}</strong></p>}
      {greenWebhookSettings&&<div role="status" className="rounded bg-gray-50 p-3 space-y-1">
       <p>Webhook: {greenWebhookSettings.webhookConfigured?'מוגדר':'חסר'}</p>
       <p>קליטת תגובות: {greenWebhookSettings.incomingNotificationsEnabled?'פעילה':'לא מאומתת'}</p>
       <p>אימות Webhook: {greenWebhookSettings.webhookTokenConfigured?'מוגדר':'חסר'}</p>
      </div>}
      <p className="text-xs text-gray-600">הפעולות הן לקריאה בלבד, ללא שליחת הודעות או שינוי הגדרות.</p>
     </div>
    </details>
    <details className="rounded border p-3 text-sm">
     <summary className="cursor-pointer font-medium">אבחון תקלות וביצועים</summary>
     <div className="pt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
       <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('diagnose')}>בדוק תקינות התור</Button>
       <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('metrics')}>זמני שליחה</Button>
       <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('sourceAudit')}>בדוק כפילויות ותזכורות</Button>
       <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('inboundAudit')}>תגובות ספקים</Button>
       <Button size="sm" variant="outline" disabled={busy} onClick={()=>run('unknownCallbackAudit')}>תגובות לא מזוהות</Button>
      </div>
      {metrics&&<div className="border rounded p-3 space-y-1">
       <strong>ביצועי שליחה — {metrics.sampled||0} הודעות במדגם</strong>
       <p>חציון המתנה: {metrics.timings?.queueWait?.p50Ms==null?'אין נתון':(metrics.timings.queueWait.p50Ms/1000).toFixed(1)+' שניות'}</p>
       <p>95% מהזמן לאחר מועד ההודעה: {metrics.timings?.afterDue?.p95Ms==null?'אין נתון':(metrics.timings.afterDue.p95Ms/1000).toFixed(1)+' שניות'}</p>
      </div>}
      {sourceAudit&&<div className="border rounded p-3 space-y-1">
       <strong>התאמה בין הודעות למקור</strong>
       <p>כפילויות שיבוץ במדגם: {sourceAudit.duplicateAssignments?.length||0}</p>
       <p>תוצאות לא ידועות שסומנו כנשלחו: {sourceAudit.unknownWithSentMirror?.length||0}</p>
       <p>תזכורות WhatsApp שממתינות במקור: {sourceAudit.businessReminders?.whatsappWaiting??'לא זמין'}</p>
      </div>}
      {inboundAudit&&<div className="border rounded p-3 space-y-2">
       <strong>תגובות ספקים — {inboundAudit.sampleCount||0} במדגם</strong>
       <p>בוצעו: {inboundAudit.totals?.applied||0} · נדחו: {inboundAudit.totals?.rejected||0} · דורשות בירור: {inboundAudit.totals?.needs_review||0}</p>
       {inboundAudit.registrationBlocked&&<p className="text-amber-800">קליטת תגובות חסומה — נדרש בירור.</p>}
       {(inboundAudit.review||[]).map(entry=><div key={entry.id} className="flex gap-2 items-center">
        <span className="text-xs">{entry.id} · {entry.reason}</span>
        <Button size="sm" variant="outline" disabled={busy}
         onClick={()=>run('inboundInspect',{id:entry.id})}>פרטי תגובה</Button>
       </div>)}
       {inboundDetail&&<p className="text-xs">רשומה {inboundDetail.receiptId}: {inboundDetail.state}, שיבוץ {inboundDetail.currentStatus}</p>}
      </div>}
      {unknownCallbackAudit&&<div className="border rounded p-3 space-y-2">
       <strong>תגובות לא מזוהות: {unknownCallbackAudit.pendingReview||0} ממתינות לבירור</strong>
       {(unknownCallbackAudit.list||[]).map(entry=><div className="border-t pt-2" key={entry.reference}>
        <p className="text-xs">{entry.reference} · {entry.format==='unrecognized_interactive'?'כפתור לא מזוהה':'אירוע לא מזוהה'}</p>
        {entry.encryptedRecoveryRecorded&&entry.reviewRecordId&&
         entry.encryptedRecoveryExpiresAt&&Date.parse(entry.encryptedRecoveryExpiresAt)>Date.now()&&
         <Button variant="outline" size="sm" disabled={busy}
          onClick={()=>run('unknownRecoveryStructureReview',{id:entry.reviewRecordId,reference:entry.reference})}>בדוק מבנה ללא תוכן אישי</Button>}
       </div>)}
       {unknownRecoveryReview&&<p className="text-xs">מבנה: {unknownRecoveryReview.class}</p>}
       <details className="border rounded p-2">
        <summary className="cursor-pointer text-xs">תחזוקת רשומות מוצפנות שפג תוקפן</summary>
        <div className="pt-2 space-y-2">
         <p className="text-xs text-gray-600">ניקוי שדות מוצפנים ברשומות שפג תוקפן בלבד. אינו משנה שיבוצים.</p>
         <Button size="sm" variant="outline" disabled={busy}
          onClick={()=>window.confirm('לנקות עד 20 רשומות מוצפנות שפג תוקפן? הפעולה בלתי הפיכה ברשומה הפעילה.')&&run('unknownRecoveryExpiryCleanup')}>נקה רשומות שפג תוקפן</Button>
         {unknownRecoveryCleanup&&<p>נוקו: {unknownRecoveryCleanup.scrubbed||0}</p>}
        </div>
       </details>
      </div>}
     </div>
    </details>
    <details className="rounded border p-3 text-sm">
     <summary className="cursor-pointer font-medium">הפעלה ידנית של עובד התור</summary>
     <p className="text-xs text-gray-600 pt-2">לשימוש כשיש הודעות שממתינות. הפעולה יכולה לשלוח הודעות אמיתיות.</p>
     <Button size="sm" variant="outline" disabled={busy||!view?.config?.enabled||view?.config?.paused}
      onClick={()=>window.confirm('להפעיל עובד תור עכשיו? הודעות אמיתיות עשויות להישלח.')&&run('kick')}>
      <Play className="h-4 w-4 ml-1"/>הפעל עובד תור
     </Button>
    </details>
   </section>
   {count(totals.unknown)>0&&<p className="text-sm text-amber-800 flex gap-2 items-center">
    <AlertTriangle className="h-4 w-4"/>הודעות במצב לא ידוע אינן נשלחות שוב אוטומטית. נדרש אימות מול ספק השליחה.
   </p>}
  </div>
 </details>;
}
