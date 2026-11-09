import React,{useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {RefreshCw,CheckCircle2,PauseCircle} from 'lucide-react';
import {useLanguage} from '@/i18n/LanguageProvider';

// One owner-only, real production switch for additional supplier-reminder
// acknowledgement reply. NO testing controls, staging enrollment, API keys,
// webhooks, arbitrary handlers or manual provider sends in this UI.
export default function WhatsAppReminderAckSettings(){
  const {t: uiTranslate}=useLanguage();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 const [status,setStatus]=useState(null),[error,setError]=useState('');
 const [notice,setNotice]=useState('');
 async function load(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const r=await base44.functions.invoke('WhatsAppQueueAdmin',{
    action:'reminderV2Get'
   });
   if(!r.data?.success)throw Error(r.data?.error||'לא ניתן לבדוק את הגדרות התזכורות');
   setStatus(r.data);
  }catch(e){setStatus(null);setError(
   e?.response?.data?.error||e?.message||'בדיקת ההגדרות נכשלה');
  }finally{setBusy(false);}
 }
 async function change(enable){
  if(busy||!status||Boolean(status.enabled)===enable)return;
  if(enable&&!status.ready)return;
  if(!window.confirm(enable?
   'להוסיף את הכפתור ״קיבלתי״ לתזכורות אירוע חדשות שנשלחות לספקים דרך Green? לחיצה עליו תאשר קבלת תזכורת בלבד, ללא שינוי השיבוץ.':
   'לכבות את כפתור ״קיבלתי״ בתזכורות חדשות? תזכורות שכבר נשלחו ימשיכו לקבל תגובות, והודעות חתומות שממתינות לשליחה עשויות להצריך טיפול ידני.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await base44.functions.invoke('WhatsAppQueueAdmin',{
    action:enable?'reminderV2Enable':'reminderV2Disable',
    ...(enable?{confirmation:'ENABLE_GREEN_SUPPLIER_REMINDER_ACKNOWLEDGEMENT'}:{})
   });
   const data=result.data;
   if(!data?.success)throw Error(data?.error||'העדכון לא נשמר');
   setStatus(previous=>({...previous,...data}));
   setNotice(enable?'האפשרות הופעלה עבור תזכורות חדשות בלבד.':
    'האפשרות כובתה לתזכורות חדשות. תגובות להודעות שכבר נשלחו עדיין נקלטות.');
  }catch(e){setError(e?.response?.data?.error||e?.message||'העדכון נכשל');
  }finally{setBusy(false);}
 }
 return <details className="rounded-lg border p-4 space-y-3 text-sm" dir="rtl"
  open={open} onToggle={e=>{
   setOpen(e.currentTarget.open);
   if(e.currentTarget.open&&!status&&!busy)void load();
  }}>
  <summary className="cursor-pointer font-semibold text-base">
   אישור קבלת תזכורת — כפתור ״קיבלתי״
  </summary>
  <div className="space-y-3 pt-3">
   <p className="text-gray-600">
    בתזכורות אירוע לספקים אפשר להוסיף ״קיבלתי״ לצד הכניסה למערכת והפנייה למשרד.
    בלחיצה, המערכת רושמת שהתזכורת התקבלה ושולחת אישור חוזר ב־WhatsApp.
    הכפתור אינו מאשר או דוחה שיבוץ.
   </p>
   <div className="rounded-md bg-gray-50 p-3 flex flex-wrap gap-2 items-center">
    <span className="rounded border px-3 py-2 bg-white text-xs">{uiTranslate("קיבלתי")}</span>
    <span className="rounded border px-3 py-2 bg-white text-xs">{uiTranslate("כניסה למערכת")}</span>
    <span className="rounded border px-3 py-2 bg-white text-xs">{uiTranslate("פנייה למשרד")}</span>
    <p className="w-full text-xs text-gray-600">
     תצוגה לדוגמה בלבד. הכפתורים בפועל כפופים להגדרות כל תבנית והודעה.
    </p>
   </div>
   {status&&<div className="space-y-1">
    <p className="font-medium flex items-center gap-2">
     {status.enabled?<CheckCircle2 size={17} className="text-green-700"/>:
      <PauseCircle size={17} className="text-gray-500"/>}
     {status.enabled?'פעיל לתזכורות חדשות':'כבוי — תזכורות נשלחות כרגיל'}
    </p>
    {!status.ready&&<p className="text-xs text-amber-800">
     כדי להפעיל יש צורך בתור WhatsApp פעיל, ב־Green כספק הנבחר,
     בהפעלת הכפתורים הקיימים ובהגדרות תקינות. אין צורך בשינוי ידני של Webhook.
    </p>}
    {status.historicalInboundEnabled&&!status.enabled&&
     <p className="text-xs text-gray-600">
      לחיצות על תזכורות שכבר נשלחו נשארות מאובטחות וניתנות לקליטה.
     </p>}
   </div>}
   <div className="flex flex-wrap gap-2">
    <Button type="button" size="sm" variant="outline" onClick={load}
     disabled={busy}>
     <RefreshCw className="h-4 w-4 ml-1"/>{uiTranslate("רענן מצב")}
    </Button>
    {status&&(status.enabled?
     <Button type="button" size="sm" variant="outline" disabled={busy}
      onClick={()=>change(false)}>כבה בתזכורות חדשות</Button>:
     <Button type="button" size="sm" disabled={busy||!status.ready}
      onClick={()=>change(true)}>הפעל ״קיבלתי״ בתזכורות</Button>)}
   </div>
   {error&&<p role="alert" className="text-red-700">{error}</p>}
   {notice&&<p role="status" className="text-green-700">{notice}</p>}
  </div>
 </details>;
}
