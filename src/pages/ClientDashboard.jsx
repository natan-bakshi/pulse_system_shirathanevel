import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Calendar, Clock, MapPin, Eye, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { updateExpiredEvents } from '@/functions/updateExpiredEvents';
import { getEventTitle } from '@/lib/eventDisplayName';


export default function ClientDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // React Query for current user
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  // Server-authorized per-client summary. Never retrieve all raw Event,
  // EventService, Payment or AppSettings rows into the browser.
  const identity=typeof user?.email==='string'?user.email.trim().toLowerCase():'';
  const {data:feed,isLoading:feedLoading,isError:feedError,refetch:reload}=useQuery({
    queryKey:['clientDashboardFeed',user?.id||identity,identity],
    enabled:!!identity,
    queryFn:async()=>{
      const response=await base44.functions.invoke('clientDashboardFeed',{});
      const data=response?.data;
      if(data?.success!==true||!Array.isArray(data.events))
        throw Error('Could not load client event summary');
      return data;
    },
    staleTime:20*1000,
    cacheTime:60*1000,
    refetchOnWindowFocus:true,
    retry:1
  });

  // Retain the original asynchronous expired-event update, but re-read only
  // the authorized client summary after the server has completed its work.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      updateExpiredEvents()
        .then(() => queryClient.invalidateQueries({queryKey:['clientDashboardFeed']}))
        .catch(error => console.warn('Expired-event refresh pending:',error));
    }, 1500);
    return () => { cancelled = true; clearTimeout(id); };
  }, [queryClient]);

  const eventsWithDetails=feed?.events||[];
  // A missing email must show the logged-out/no-access state, not a spinner:
  // React Query may report isLoading on a disabled query.
  const loading=userLoading||(!!identity&&feedLoading);

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>;
  }

  if (!user) {
    return <div className="text-center p-8 text-white">יש להתחבר כדי לצפות בפרטים.</div>;
  }
  if (feedError) {
    return <div className="max-w-xl mx-auto bg-white rounded-xl p-6 text-center space-y-3">
      <p role="alert">לא ניתן לטעון את סיכום האירועים המאומת שלך. המערכת לא מציגה נתונים לא מאומתים.</p>
      <Button onClick={() => reload()}>נסה שוב</Button>
    </div>;
  }

  return (
    <div className="space-y-4 sm:space-y-6 w-full max-w-7xl mx-auto">
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">שלום {user.full_name || 'לקוח/ה'}</h1>
        <p className="text-white/80 text-sm sm:text-base">ברוך הבא לאזור האישי שלך</p>
        <p className="text-white/60 text-xs sm:text-sm mt-1 sm:mt-2">מחובר עם: {user.email}</p>
      </div>

      {eventsWithDetails.length === 0 ? (
        <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
          <CardContent className="p-12 text-center">
            <Calendar className="h-16 w-16 text-gray-400 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-gray-600 mb-4">לא נמצאו אירועים</h2>
            <p className="text-gray-500 mb-2">עדיין לא שויכו אירועים למשתמש שלך.</p>
            <p className="text-gray-500 text-sm">פנה/י למנהל/ת האירוע או וודא/י שהמייל שלך רשום נכון באירוע.</p>
            <p className="text-gray-400 text-xs mt-4">מייל שלך במערכת: {user.email}</p>
          </CardContent>
        </Card>
      ) : (
        <div data-tour="client-events-list" className="grid gap-3 sm:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {eventsWithDetails.map((event, idx) => (
            <Card key={event.id} data-tour={idx === 0 ? "client-event-card" : undefined} className="bg-white/95 backdrop-blur-sm shadow-lg sm:shadow-xl flex flex-col h-full">
              <CardHeader className="p-3 sm:p-4">
                <div className="flex flex-wrap justify-between items-start gap-2">
                    <CardTitle className="text-lg text-gray-900 break-words">{getEventTitle(event)}</CardTitle>
                    <Badge className="bg-red-100 text-red-800 shrink-0">{event.status === 'quote' ? 'הצעת מחיר' : 'אירוע'}</Badge>
                </div>
                <p className="text-sm text-gray-600">{event.child_name && `שם החתן/כלה: ${event.child_name}`}</p>
              </CardHeader>
              <CardContent className="flex-grow space-y-3 p-4 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 overflow-hidden"><Calendar className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{format(new Date(event.event_date), 'dd/MM/yyyy', { locale: he })}</span></div>
                  <div className="flex items-center gap-2 overflow-hidden"><Clock className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.event_time}</span></div>
                  <div className="flex items-center gap-2 overflow-hidden"><MapPin className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.location}</span></div>
                  <div className="flex items-center gap-2 overflow-hidden"><Users className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.guest_count} אורחים</span></div>
                </div>
                <div className="pt-4 border-t mt-2">
                  <div className="flex justify-between items-center text-xs text-gray-600 mb-1">
                    <span>סה"כ:</span>
                    <span className="font-semibold">₪{event.finalTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                  </div>
                  {(event.discount_amount || 0) > 0 && (
                    <div className="flex justify-between items-center text-xs text-red-600 mb-1">
                      <span>הנחה:</span>
                      <span>-₪{event.discount_amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-xs text-gray-600 mb-1">
                    <span>שולם:</span>
                    <span>₪{event.totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-bold mb-2">
                    <span>יתרה:</span>
                    <span className={event.balance > 0 ? "text-red-700" : "text-green-700"}>₪{event.balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-600 h-2 rounded-full" style={{width: `${Math.min(event.progress, 100)}%`}}></div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="p-4 pt-0">
                <div className="flex flex-col gap-2 w-full">
                  <Button className="w-full bg-red-800 hover:bg-red-700 h-auto py-2 whitespace-normal" onClick={() => navigate(createPageUrl(`EventDetails?id=${event.id}`))}>
                      <Eye className="h-4 w-4 ml-2 shrink-0" />
                      צפה בפרטי האירוע
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}