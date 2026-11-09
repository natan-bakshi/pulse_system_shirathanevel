import React from 'react';
import {useLocation,Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {base44} from '@/api/base44Client';
import {CalendarDays,Clock3,MapPin,ArrowRight,Briefcase,ShieldCheck} from 'lucide-react';
import {createPageUrl} from '@/utils';
import {useLanguage} from '@/i18n/LanguageProvider';

// Safe, intentionally limited supplier view reached from a WhatsApp smart
// event link. Never read raw Event/EventService entities in the browser.
export default function SupplierEventView(){
  const {t}=useLanguage();
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
 return <div className="max-w-3xl mx-auto px-3 sm:px-5 py-6 space-y-5" dir={dir}>
  <Link className="inline-flex items-center gap-1 text-sm underline text-white"
   to={createPageUrl('SupplierCalendarDashboard')}>
   <ArrowRight className="w-4 h-4"/>{t("חזרה ללוח האירועים שלי")}
  </Link>
  {isLoading&&valid&&<div role="status" className="rounded-xl bg-white p-6">
   {t("מאמתים את הרשאת הגישה לאירוע…")}
  </div>}
  {(!valid||isError)&&<div role="alert" className="rounded-xl bg-white p-6 space-y-2">
   <h1 className="font-semibold text-lg">{t("לא ניתן לפתוח את האירוע")}</h1>
   <p className="text-sm text-gray-600">
    {t("האירוע אינו זמין בחשבון שלך, או שלא קיים עבורך שיבוץ פעיל. אם לדעתך זו טעות, פנה למשרד.")}
   </p>
  </div>}
  {e&&<div className="bg-white p-5 sm:p-7 rounded-xl shadow space-y-5">
   <div className="space-y-2">
    <p className="text-sm flex gap-2 items-center text-gray-500">
     <ShieldCheck className="w-4 h-4"/>{t("פרטי אירוע המורשים לצפייה כספק")}
    </p>
    <h1 className="text-2xl font-bold">{e.eventName||t('אירוע')}</h1>
    {e.familyName&&<p className="text-sm">{t("משפחת")} {e.familyName}</p>}
   </div>
   <div className="grid sm:grid-cols-2 gap-3 text-sm">
    <div className="flex items-start gap-2">
     <CalendarDays className="w-4 h-4 mt-0.5 text-gray-500"/>
     <span>{e.date||t('התאריך טרם נקבע')}</span>
    </div>
    <div className="flex items-start gap-2">
     <Clock3 className="w-4 h-4 mt-0.5 text-gray-500"/>
     <span>{e.time||t('שעת האירוע טרם נקבעה')}</span>
    </div>
    <div className="flex items-start gap-2 sm:col-span-2">
     <MapPin className="w-4 h-4 mt-0.5 text-gray-500"/>
     <span>{[e.location,e.city].filter(Boolean).join(' · ')||t('מיקום טרם נקבע')}</span>
    </div>
   </div>
   <div className="border-t pt-4 space-y-2">
    <h2 className="font-semibold flex gap-2 items-center">
     <Briefcase className="w-4 h-4"/>{t("השירותים שלי באירוע")}
    </h2>
    {(e.services||[]).map((s,i)=><div key={i} className="rounded-md border p-3 text-sm">
     <strong>{s.serviceName||t('שירות')}</strong>
     {s.arrivalTime&&<p className="text-gray-600 mt-1">
      {t("שעת התייצבות:")} {s.arrivalTime}
     </p>}
    </div>)}
   </div>
   <p className="text-xs text-gray-500">
    {t("המסך מציג רק פרטים הרלוונטיים לשיבוץ שלך. נתוני תשלום, מחירים, אנשי קשר של המשפחה ושירותים של ספקים אחרים אינם מוצגים.")}
   </p>
  </div>}
 </div>;
}
