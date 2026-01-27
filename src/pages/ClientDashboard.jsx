import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Users, Calendar, Clock, MapPin, Eye, Loader2, FileText } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { updateExpiredEvents } from '@/functions/updateExpiredEvents';
import { generateQuote } from '@/functions/generateQuote';


export default function ClientDashboard() {
  const [isGeneratingQuote, setIsGeneratingQuote] = useState(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // React Query for current user
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  // React Query for all events
  const { data: allEvents = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      try {
        await updateExpiredEvents();
      } catch (error) {
        console.warn("Failed to update expired events:", error);
      }
      return base44.entities.Event.list();
    },
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  // React Query for event services
  const { data: allEventServices = [] } = useQuery({
    queryKey: ['eventServices'],
    queryFn: () => base44.entities.EventService.list(),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  // React Query for payments
  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: () => base44.entities.Payment.list(),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  const loading = eventsLoading;

  // Determine user roles
  const isClient = useMemo(() => !!user, [user]);
  const isAdmin = useMemo(() => user?.role === 'admin', [user]);

  // Filter events for current client
  const clientEvents = useMemo(() => {
    if (!user || !user.email) return [];
    
    const userEmail = user.email.toLowerCase();
    const userPhone = user.phone;
    
    return allEvents.filter(event => {
      // Check if user created the event
      if (event.created_by === userEmail) {
        return true;
      }
      
      // Check in parents array
      if (event.parents && Array.isArray(event.parents)) {
        const foundParent = event.parents.find(parent => 
          (parent.email && parent.email.toLowerCase() === userEmail) ||
          (userPhone && parent.phone === userPhone)
        );
        if (foundParent) {
          return true;
        }
      }
      
      return false;
    });
  }, [allEvents, user]);

  // Calculate event details with financials
  const eventsWithDetails = useMemo(() => {
    return clientEvents.map((event) => {
      const eventServices = allEventServices.filter(es => es.event_id === event.id);
      const payments = allPayments.filter(p => p.event_id === event.id);
      
      let totalCostWithoutVat;
      if (event.all_inclusive && event.all_inclusive_price) {
          totalCostWithoutVat = event.all_inclusive_price;
          if (event.all_inclusive_includes_vat) {
              totalCostWithoutVat /= 1.18;
          }
      } else {
          totalCostWithoutVat = eventServices.reduce((sum, s) => {
              const serviceTotal = (s.custom_price || 0) * (s.quantity || 1);
              return sum + (s.includes_vat ? serviceTotal / 1.18 : serviceTotal);
          }, 0);
      }

      const vatAmount = totalCostWithoutVat * 0.18;
      const totalCostWithVat = totalCostWithoutVat + vatAmount;
      const discountAmount = event.discount_amount || 0;
      const finalTotal = totalCostWithVat - discountAmount;
      
      const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const balance = finalTotal - totalPaid;
      const progress = finalTotal > 0 ? (totalPaid / finalTotal) * 100 : 0;
      
      return {
        ...event,
        finalTotal,
        totalPaid,
        balance,
        progress,
        discount_amount: discountAmount,
      };
    }).sort((a, b) => new Date(b.event_date) - new Date(a.event_date));
  }, [clientEvents, allEventServices, allPayments]);

  // Function to handle generating/viewing a quote HTML
  const handleGenerateQuote = useCallback(async (eventId) => {
    setIsGeneratingQuote(eventId);
    try {
      const response = await generateQuote({ eventId: eventId });
      const html = response.data.html; 
      const newWindow = window.open();
      if (newWindow) {
        newWindow.document.write(html);
        newWindow.document.close();
      } else {
        alert("חוסם החלונות הקופצים מנע את פתיחת ההצעה. אנא אפשר חלונות קופצים עבור אתר זה.");
      }
    } catch (error) {
      console.error("Failed to generate quote:", error);
      alert("שגיאה ביצירת הצעת המחיר");
    } finally {
      setIsGeneratingQuote(null);
    }
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>;
  }

  if (!user) {
    return <div className="text-center p-8 text-white">יש להתחבר כדי לצפות בפרטים.</div>;
  }

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-2">שלום {user.full_name || 'לקוח/ה'}</h1>
        <p className="text-white/80">ברוך הבא לאזור האישי שלך</p>
        <p className="text-white/60 text-sm mt-2">מחובר עם: {user.email}</p>
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
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {eventsWithDetails.map((event) => (
            <Card key={event.id} className="bg-white/95 backdrop-blur-sm shadow-xl flex flex-col h-full">
              <CardHeader className="p-4">
                <div className="flex flex-wrap justify-between items-start gap-2">
                    <CardTitle className="text-lg text-gray-900 break-words">{event.event_name} - {event.family_name}</CardTitle>
                    <Badge className="bg-red-100 text-red-800 shrink-0">{event.status === 'quote' ? 'הצעת מחיר' : 'אירוע'}</Badge>
                </div>
                <p className="text-sm text-gray-600">{event.child_name && `לכבוד ${event.child_name}`}</p>
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
                  {(isClient || isAdmin) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerateQuote(event.id)}
                      disabled={isGeneratingQuote === event.id}
                      className="w-full border-red-200 text-red-800 hover:bg-red-50 h-auto py-2 whitespace-normal"
                    >
                      <FileText className="h-4 w-4 ml-2 shrink-0" />
                      הצג הצעת מחיר
                      {isGeneratingQuote === event.id && <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />}
                    </Button>
                  )}

                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}