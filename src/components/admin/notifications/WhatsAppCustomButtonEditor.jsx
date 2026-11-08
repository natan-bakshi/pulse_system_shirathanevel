import React from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Plus,Trash2,ArrowUp,ArrowDown} from 'lucide-react';

// Only a list of server-defined navigation actions; the URL entry is
// validated again on the backend and at Green transport. No code or custom
// business action can be authored by this UI.
const TYPES=[
 {value:'supplier_calendar',name:'לוח האירועים שלי',label:'כניסה למערכת',
  hint:'פותח את לוח האירועים האישי של הספק (נדרשת התחברות)'},
 {value:'supplier_dashboard',name:'השיבוצים שלי',label:'השיבוצים שלי',
  hint:'פותח את דף השיבוצים של הספק'},
 {value:'event_details',name:'קישור חכם לאירוע',label:'פרטי האירוע',
  hint:'פותח את האירוע שיצר את ההתראה, רק כשקיים זיהוי אירוע מאומת'},
 {value:'notification_settings',name:'הגדרות ההתראות שלי',label:'הגדרות',
  hint:'פותח את העדפות ההתראות של הנמען ב־Pulse'},
 {value:'office',name:'פנייה למשרד ב־WhatsApp',label:'פנייה למשרד',
  hint:'פותח צ׳אט עם המשרד עם מספר האסמכתא ותקציר ההודעה'},
 {value:'office_details',name:'תגובה מוכנה: צריך פרטים',label:'צריך פרטים',
  hint:'פותח הודעת WhatsApp מוכנה למשרד לבקשת פרטים, עם אסמכתא ותקציר האירוע. הספק לוחץ שלח בעצמו.'},
 {value:'office_callback',name:'תגובה מוכנה: בקשת שיחה',label:'תחזרו אליי',
  hint:'פותח הודעת WhatsApp מוכנה למשרד לבקשת שיחה, עם אסמכתא ותקציר האירוע. הספק לוחץ שלח בעצמו.'},
 {value:'external',name:'קישור חיצוני (כתובת ידנית)',label:'פתח קישור',
  hint:'פותח כתובת אתר מאובטחת שתודבק כאן, בלי להריץ פעולה במערכת'},
 {value:'copy_reference',name:'העתקת אסמכתת ההודעה',label:'העתק אסמכתא',
  hint:'מעתיק את אסמכתת ההודעה ללוח, בלי לשנות נתון במערכת'},
 {value:'call_office',name:'שיחת טלפון למשרד',label:'התקשר למשרד',
  hint:'פותח חייגן עם מספר המשרד המוגדר במערכת'}
];
export const newCustomSupplierButtons=()=>({
 kind:'custom',
 links:[{kind:'supplier_calendar',label:'כניסה למערכת',url:''},
  {kind:'office',label:'פנייה למשרד',url:''}],
 replyLabel:''
});
function canSmartEvent(template){
 return ['SUPPLIER_EVENT_REMINDER','SUPPLIER_PENDING_REMINDER'].includes(template?.type)||
  template?.trigger_type==='scheduled_check';
}
export default function WhatsAppCustomButtonEditor({
 value,onChange,template,busy=false
}){
 const links=value?.links||[],reply=value?.replyLabel||'';
 const canReply=template?.type==='SUPPLIER_EVENT_REMINDER';
 const canQuote=template?.type==='SUPPLIER_PENDING_REMINDER';
 const quoteEnabled=value?.quoteSource==='assignment_new';
 const total=links.length+(reply?1:0);
 const update=(nextLinks,replyLabel=reply)=>onChange({
  kind:'custom',links:nextLinks,replyLabel
 });
 const toggleQuote=checked=>onChange(checked?{
  kind:'custom',links:[],replyLabel:'',quoteSource:'assignment_new'
 }:{kind:'custom',links:[{kind:'supplier_calendar',
  label:'כניסה למערכת',url:''}],replyLabel:''});
 const updateLink=(index,patch)=>update(links.map((item,i)=>i===index?{...item,...patch}:item));
 const add=()=>update([...links,{kind:'supplier_calendar',
  label:'כניסה למערכת',url:''}]);
 const remove=index=>update(links.filter((_,i)=>i!==index));
 const swap=(a,b)=>{
  const arr=[...links];[arr[a],arr[b]]=[arr[b],arr[a]];update(arr);
 };
 return <div className="space-y-3 rounded-md border bg-gray-50 p-3" dir="rtl">
  <div>
   <p className="text-sm font-semibold">כפתורים מותאמים אישית</p>
   <p className="text-xs text-gray-600">
    בחר את היעד של כל כפתור, כתוב את שמו וקבע את הסדר.
    עד שלושה כפתורים בסך הכול, כולל כפתור תגובה.
   </p>
  </div>
  {canQuote&&<div className="rounded-md bg-white border p-3 space-y-2">
   <label className="flex items-center gap-2 text-sm font-medium">
    <input type="checkbox" checked={quoteEnabled} disabled={busy}
     onChange={e=>toggleQuote(e.target.checked)}/>
    ציטוט הודעת השיבוץ המקורית בתזכורת
   </label>
   <p className="text-xs text-gray-600">
    אם קיימת הודעת שיבוץ קודמת באותו צ׳אט ובאותו מספר Green,
    והיא מאומתת כי נמסרה או נקראה, התזכורת תישלח כתגובה מצוטטת ב־WhatsApp.
    ציטוט אינו נתמך יחד עם כפתורים אינטראקטיביים, ולכן אפשרות זו מחליפה
    את הכפתורים בתבנית. כשאין מקור מאומת התזכורת תישלח כטקסט רגיל.
   </p>
   <p className="text-xs text-amber-800">
    הפעלה יזומה: לציטוט עשויה להתווסף קריאת בדיקה אחת ל־Green לכל הודעה.
    לא חל על הודעות שכבר נוצרו בתור. Green מציינת שגם מזהה ציטוט
    שנראה תקין עלול להיכשל במסירה; השתמש רק לאחר בדיקת מסירה מבוקרת.
   </p>
  </div>}
  {!quoteEnabled&&links.map((link,index)=>{
   const choice=TYPES.find(item=>item.value===link.kind)||TYPES[0];
   return <div key={index} className="rounded-md border bg-white p-3 space-y-2">
    <div className="flex items-center justify-between gap-2">
     <span className="text-xs font-semibold">כפתור {index+1}</span>
     <div className="flex gap-1">
      <Button type="button" variant="ghost" size="sm" title="הזז למעלה"
       aria-label={'הזז כפתור '+(index+1)+' למעלה'}
       disabled={busy||index===0} onClick={()=>swap(index,index-1)}>
       <ArrowUp className="w-4 h-4"/>
      </Button>
      <Button type="button" variant="ghost" size="sm" title="הזז למטה"
       aria-label={'הזז כפתור '+(index+1)+' למטה'}
       disabled={busy||index===links.length-1} onClick={()=>swap(index,index+1)}>
       <ArrowDown className="w-4 h-4"/>
      </Button>
      <Button type="button" variant="ghost" size="sm" title="הסר כפתור"
       aria-label={'הסר כפתור '+(index+1)}
       disabled={busy||(links.length===1&&!reply)}
       onClick={()=>remove(index)}><Trash2 className="w-4 h-4"/></Button>
     </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
     <label className="space-y-1">
      <span className="text-xs">מה יקרה בלחיצה?</span>
      <select className="w-full rounded-md border bg-white p-2 text-sm"
       value={link.kind} disabled={busy}
       aria-label={'יעד כפתור '+(index+1)}
       onChange={e=>{
        const option=TYPES.find(t=>t.value===e.target.value)||TYPES[0];
        updateLink(index,{kind:option.value,label:option.label,url:''});
       }}>
       {TYPES.map(t=><option key={t.value} value={t.value}
        disabled={t.value==='event_details'&&!canSmartEvent(template)}>{t.name}</option>)}
      </select>
     </label>
     <label className="space-y-1">
      <span className="text-xs">מה יהיה כתוב על הכפתור?</span>
      <Input value={link.label} maxLength={25} disabled={busy}
       aria-label={'כיתוב כפתור '+(index+1)}
       onChange={e=>updateLink(index,{label:e.target.value})}
       placeholder="כיתוב קצר"/>
     </label>
    </div>
    {link.kind==='external'&&<label className="block space-y-1">
     <span className="text-xs">הדבק קישור מלא (HTTPS)</span>
     <Input type="url" inputMode="url" dir="ltr" value={link.url}
      aria-label={'קישור חיצוני כפתור '+(index+1)}
      maxLength={600} disabled={busy} placeholder="https://www.example.com/path"
      onChange={e=>updateLink(index,{url:e.target.value})}/>
     <span className="text-xs text-gray-500">
      כתובת חיצונית תיפתח בדפדפן. כתובות לא מאובטחות וקישורי מערכת פוגעניים ייחסמו בשמירה.
     </span>
    </label>}
    <p className="text-xs text-gray-600">{choice.hint}</p>
   </div>;
  })}
  {!quoteEnabled&&total<3&&<Button type="button" variant="outline" size="sm"
   disabled={busy} onClick={add}>
   <Plus className="w-4 h-4 ml-1"/> הוסף כפתור
  </Button>}
  {canReply&&<div className="rounded-md bg-white border p-3 space-y-2">
   <label className="flex items-center gap-2 text-xs font-medium">
    <input type="checkbox" checked={!!reply}
     disabled={busy||(!reply&&total>=3)}
     onChange={e=>update(links,e.target.checked?'קיבלתי':'')}/>
    הוסף כפתור תגובה: אישור קבלת התזכורת
   </label>
   {!!reply&&<label className="block space-y-1">
    <span className="text-xs">כיתוב כפתור התגובה</span>
    <Input maxLength={25} disabled={busy} value={reply}
     aria-label="שם כפתור אישור קבלת תזכורת"
     onChange={e=>update(links,e.target.value)} placeholder="קיבלתי"/>
   </label>}
   <p className="text-xs text-gray-600">
    התגובה מתעדת קבלת תזכורת ושולחת הודעת אישור, בלי לאשר או לדחות את השיבוץ.
    היא תופעל רק אם המנהל הפעיל בנפרד את כפתור ״קיבלתי״ המאובטח בתזכורות.
   </p>
   {!reply&&total>=3&&<p className="text-xs text-amber-800">
    כדי להוסיף תגובה יש להסיר קודם כפתור קישור אחד.
   </p>}
  </div>}
  <div className="space-y-2 rounded-md bg-white border p-3">
   <p className="text-xs font-semibold">כך יופיעו הכפתורים בהודעה</p>
   <div className="flex flex-wrap gap-2">
    {quoteEnabled&&<span className="rounded border px-3 py-2 text-xs bg-gray-50">
     ציטוט השיבוץ המקורי · הודעת טקסט ללא כפתורים
    </span>}
    {reply&&<span className="rounded border px-3 py-2 text-xs bg-gray-50">
     {reply||'קיבלתי'} · תגובה
    </span>}
    {links.map((item,index)=><span key={index}
     className="rounded border px-3 py-2 text-xs bg-gray-50">
     {item.label||'ללא שם'} · {item.kind==='copy_reference'?'העתקה':
      item.kind==='call_office'?'שיחת טלפון':'קישור'}
    </span>)}
   </div>
   <p className="text-xs text-gray-500">
    קישורים חכמים נבנים מנתוני האירוע בזמן יצירת ההתראה.
    אם חסרים הנתונים הנדרשים, תישלח הודעת טקסט רגילה ולא קישור שגוי.
    הכפתורים אינם עוקפים את הרשאות הגישה למערכת.
    תגובות מוכנות למשרד פותחות הודעה חדשה לעריכה ולשליחה ואינן מאשרות שיבוץ.
   </p>
  </div>
 </div>;
}
