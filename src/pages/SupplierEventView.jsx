import React from 'react';
import {useLocation,Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {base44} from '@/api/base44Client';
import {CalendarDays,Clock3,MapPin,ArrowRight,Briefcase,ShieldCheck,
  Phone,MessageCircle,Users,ClipboardList,UserRound,Navigation} from 'lucide-react';
import {createPageUrl} from '@/utils';
import {useLanguage} from '@/i18n/LanguageProvider';

// An authorized read-only operational card. The backend verifies the current
// supplier's own assignment before disclosing parent contact information.
// Never load unrestricted Event/EventService objects into the browser.
const STATUS={
 pending:{label:'ממתין לאישור',style:'bg-amber-50 text-amber-900 border-amber-200'},
 confirmed:{label:'מאושר',style:'bg-green-50 text-green-800 border-green-200'},
 approved:{label:'מאושר',style:'bg-green-50 text-green-800 border-green-200'},
 rejected:{label:'נדחה',style:'bg-rose-50 text-rose-800 border-rose-200'}
};
const section='rounded-xl bg-white p-4 sm:p-6 shadow-sm space-y-4';
export default function SupplierEventView(){
 const {t,dir}=useLanguage();
 const location=useLocation();
 const eventId=new URLSearchParams(location.search).get('id')||'';
 const valid=/^[A-Za-z0-9_-]{3,100}$/.test(eventId);
 const {data,isLoading,isError}=useQuery({
  queryKey:['supplierEventView',eventId],
  enabled:valid,
  queryFn:async()=>{
   const response=await base44.functions.invoke('supplierEventView',{eventId});
   if(!response.data?.success||!response.data.event)
    throw Error('Event not available');
   return response.data.event;
  },
  staleTime:15000,retry:false
 });
 const e=data;
 return <main className="max-w-4xl mx-auto px-3 sm:px-5 py-6 space-y-4" dir={dir}>
  <Link className="inline-flex items-center gap-2 text-sm underline text-white"
   to={createPageUrl('SupplierCalendarDashboard')}>
   <ArrowRight className="w-4 h-4"/>{t('חזרה ללוח האירועים שלי')}
  </Link>
  {isLoading&&valid&&<div role="status" className={section}>
   {t('מאמתים את הרשאת הגישה לאירוע…')}
  </div>}
  {(!valid||isError)&&<div role="alert" className={section}>
   <h1 className="font-semibold text-lg">{t('לא ניתן לפתוח את האירוע')}</h1>
   <p className="text-sm text-gray-600">{t('האירוע אינו זמין בחשבון שלך, או שלא קיים עבורך שיבוץ פעיל. אם לדעתך זו טעות, פנה למשרד.')}</p>
  </div>}
  {e&&<>
   <section className={section}>
    <div className="space-y-2">
     <p className="flex gap-2 items-center text-xs text-gray-500">
      <ShieldCheck className="w-4 h-4"/>{t('כרטיס אירוע לספק')}
     </p>
     <h1 className="text-xl sm:text-2xl font-bold text-gray-950 break-words">{e.eventName||t('אירוע')}</h1>
     {e.familyName&&<p className="text-base font-medium">{t('משפחת')} {e.familyName}</p>}
     {e.childName&&<p className="text-sm"><span className="font-semibold">{t('שם החתן/כלה:')}</span> {e.childName}</p>}
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm border-t pt-4">
     <div className="flex items-start gap-2">
      <CalendarDays className="w-4 h-4 mt-0.5 text-gray-500 shrink-0"/>
      <span>{e.date||t('התאריך טרם נקבע')}</span>
     </div>
     <div className="flex items-start gap-2">
      <Clock3 className="w-4 h-4 mt-0.5 text-gray-500 shrink-0"/>
      <span><strong>{t('שעת האירוע:')}</strong> {e.time||t('שעת האירוע טרם נקבעה')}</span>
     </div>
     <div className="flex items-start gap-2 sm:col-span-2">
      <MapPin className="w-4 h-4 mt-0.5 text-gray-500 shrink-0"/>
      <span><strong>{t('מיקום האירוע:')}</strong> {[e.location,e.city].filter(Boolean).join(' · ')||t('מיקום טרם נקבע')}</span>
     </div>
    </div>
   </section>
   <section className={section} aria-label={t('השירותים שלי באירוע')}>
    <h2 className="font-semibold text-lg flex gap-2 items-center">
     <Briefcase className="w-5 h-5"/>{t('השירותים שלי באירוע')}
    </h2>
    {(e.services||[]).map((s,i)=>{
     const status=STATUS[s.status]||{label:'לא ידוע',style:'bg-gray-50 text-gray-700 border-gray-200'};
     return <article key={i} className="rounded-lg border border-gray-200 p-4 space-y-3 text-sm">
      <div className="flex items-start justify-between flex-wrap gap-3">
       <h3 className="font-semibold text-base break-words">{s.serviceName||t('שירות')}</h3>
       <span className={'rounded-full border text-xs px-3 py-1 font-semibold '+status.style}>
        {t('סטטוס שיבוץ:')} {t(status.label)}
       </span>
      </div>
      {s.serviceDescription&&<div className="bg-gray-50 rounded-md px-3 py-2">
       <p className="font-semibold mb-1">{t('תיאור השירות:')}</p>
       <p className="whitespace-pre-wrap break-words leading-6">{s.serviceDescription}</p>
      </div>}
      {s.arrivalTime&&<p className="flex items-center gap-2 font-medium">
       <Clock3 className="w-4 h-4 text-red-700 shrink-0"/>
       <span>{t('שעת ההתייצבות שלי:')} <strong dir="auto">{s.arrivalTime}</strong></span>
      </p>}
      {s.standingTime&&s.standingTime!==s.arrivalTime&&<p>
       <strong>{t('שעת התייצבות לשירות:')}</strong> {s.standingTime}
      </p>}
      {s.meetingLocation&&<p className="flex items-start gap-2">
       <Navigation className="w-4 h-4 mt-0.5 text-red-700 shrink-0"/>
       <span><strong>{t('מקום ההתייצבות:')}</strong> {s.meetingLocation}</span>
      </p>}
      {(s.pickupPoints||[]).length>1&&<div className="bg-blue-50 rounded-md px-3 py-2 space-y-2">
       <p className="font-semibold">{t('נקודות איסוף והתייצבות')}</p>
       {s.pickupPoints.map((point,index)=><p key={index}>
        {s.pickupPoints.some(p=>p.unit!==1)&&<span>{t('רכב')} {point.unit} · </span>}
        {point.time&&<strong>{point.time} · </strong>}{point.location}
       </p>)}
      </div>}
      {s.supplierNote&&<div className="rounded-md border border-amber-200 bg-amber-50 p-3">
       <strong>{t('הערה עבורך:')}</strong>
       <p className="whitespace-pre-wrap break-words mt-1">{s.supplierNote}</p>
      </div>}
      {!s.arrivalTime&&!s.standingTime&&<p className="text-gray-500">{t('שעת ההתייצבות טרם הוגדרה; שעת האירוע מופיעה למעלה.')}</p>}
     </article>;
    })}
   </section>
   <section className={section} aria-label={t('אנשי קשר — הורים')}>
    <h2 className="font-semibold text-lg flex gap-2 items-center">
     <Users className="w-5 h-5"/>{t('אנשי קשר — הורים')}
    </h2>
    {e.parents?.length?<div className="grid sm:grid-cols-2 gap-3">
     {e.parents.map((parent,i)=><div key={i} className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm">
       <UserRound className="w-4 h-4 text-gray-500 shrink-0"/>
       <strong className="break-words">{parent.name||t('הורה')}</strong>
      </div>
      {parent.phone&&<p className="text-sm" dir="ltr">{parent.phone}</p>}
      {parent.dialNumber&&<div className="flex gap-2 flex-wrap">
       <a className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm font-medium hover:bg-gray-200"
        href={'tel:'+parent.dialNumber} aria-label={t('התקשר אל')+' '+(parent.name||t('הורה'))}>
        <Phone className="w-4 h-4"/>{t('שיחה')}
       </a>
       {parent.whatsappNumber&&<a className="inline-flex items-center gap-2 rounded-md bg-green-50 text-green-900 px-3 py-2 text-sm font-medium hover:bg-green-100"
        href={'https://wa.me/'+parent.whatsappNumber} target="_blank" rel="noopener noreferrer"
        aria-label={t('WhatsApp אל')+' '+(parent.name||t('הורה'))}>
        <MessageCircle className="w-4 h-4"/>WhatsApp
       </a>}
      </div>}
     </div>)}
    </div>:<p className="text-sm text-gray-500">{t('פרטי ההורים טרם הוזנו לאירוע.')}</p>}
   </section>
   <section className={section} aria-label={t('לוח הזמנים של האירוע')}>
    <h2 className="font-semibold text-lg flex gap-2 items-center">
     <ClipboardList className="w-5 h-5"/>{t('לוח הזמנים של האירוע')}
    </h2>
    {e.schedule?.length?<ol className="space-y-0">
     {e.schedule.map((item,i)=><li key={i} className="flex gap-4 border-s-2 border-gray-200 ps-4 pb-4 last:pb-0">
      <time className="font-semibold text-red-800 text-sm shrink-0" dir="ltr">{item.time||'—'}</time>
      <div className="text-sm min-w-0">
       <p className="font-medium whitespace-pre-wrap break-words">{item.activity}</p>
       {item.notes&&<p className="text-gray-600 whitespace-pre-wrap break-words mt-1">{item.notes}</p>}
      </div>
     </li>)}
    </ol>:<p className="text-sm text-gray-500">{t('לוח הזמנים טרם הוזן לאירוע.')}</p>}
   </section>
   <p className="text-xs text-white/90 px-2">
    {t('הפרטים מוצגים עבור השיבוץ שלך בלבד. תשלומים, מחירים, מידע ניהולי ושיבוצים של ספקים אחרים אינם מוצגים.')}
   </p>
  </>}
 </main>;
}
