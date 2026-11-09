import { cacheEventStatus } from '@/lib/eventStatus';
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {useSupplierAssignmentsFeed} from "@/hooks/useSupplierAssignmentsFeed";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Calendar, Clock, MapPin, AlertCircle, Search, Loader2 } from "lucide-react";
import { format, getYear, getMonth } from "date-fns";
import { he } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getEventDisplayName, getEventTitle } from '@/lib/eventDisplayName';
import {useLanguage} from '@/i18n/LanguageProvider';

const YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i);
const MONTHS = [
  { value: 0, label: "ינואר" }, { value: 1, label: "פברואר" }, { value: 2, label: "מרץ" },
  { value: 3, label: "אפריל" }, { value: 4, label: "מאי" }, { value: 5, label: "יוני" },
  { value: 6, label: "יולי" }, { value: 7, label: "אוגוסט" }, { value: 8, label: "ספטמבר" },
  { value: 9, label: "אוקטובר" }, { value: 10, label: "נובמבר" }, { value: 11, label: "דצמבר" }
];

export default function SupplierDashboard() {
  const {t,locale}=useLanguage();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [timeFilter, setTimeFilter] = useState("future");
  const [yearFilter, setYearFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Debouncing effect for search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const {user,supplier,supplierEvents,loading,feedError,reload} = useSupplierAssignmentsFeed();

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    const now = new Date();
    return supplierEvents
      .filter(event => {
        const eventDate = new Date(event.event_date);
        if (timeFilter === 'future' && eventDate < now) return false;
        if (timeFilter === 'past' && eventDate >= now) return false;
        return true;
      })
      .filter(event => {
        if (yearFilter !== 'all' && getYear(new Date(event.event_date)) !== parseInt(yearFilter)) return false;
        if (monthFilter !== 'all' && getMonth(new Date(event.event_date)) !== parseInt(monthFilter)) return false;
        return true;
      })
      .filter(event => {
        const search = debouncedSearchTerm.toLowerCase();
        return (
          event.event_name.toLowerCase().includes(search) ||
          getEventDisplayName(event).toLowerCase().includes(search) ||
          event.serviceName.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
  }, [supplierEvents, debouncedSearchTerm, timeFilter, yearFilter, monthFilter]);

  const handleStatusChange = useCallback(async (eventServiceId, newStatus) => {
    if (!supplier) return;
    try {
      const {data: result} = await base44.functions.invoke('updateSupplierStatus', {
        eventServiceId, newStatus
      });
      cacheEventStatus(result.eventId, result.newStatus);
      // The server rechecks membership/status. Never mutate cached event rows
      // from an optimistic, potentially stale browser assignment snapshot.
      queryClient.invalidateQueries({queryKey:['supplierAssignmentsFeed']});
    } catch (error) {
      console.error('Failed to update supplier status:', error);
      alert(t('שגיאה בעדכון הסטטוס. אנא נסה שוב.'));
    }
  }, [supplier, queryClient,t]);

  const getStatusText = useCallback((status) => {
    const statusTexts = { pending: "ממתין לאישור", confirmed: "אישרתי", rejected: "לא יכול" };
    return t(statusTexts[status] || "לא ידוע");
  }, [t]);

  const getStatusColor = useCallback((status) => {
    const colors = { pending: "bg-yellow-100 text-yellow-800 border-yellow-200", confirmed: "bg-green-100 text-green-800 border-green-200", rejected: "bg-red-100 text-red-800 border-red-200" };
    return colors[status] || "bg-gray-100 text-gray-800 border-gray-200";
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-white" />
      </div>
    );
  }

  if (feedError) {
    return <div className="max-w-xl mx-auto bg-white rounded-xl p-6 text-center space-y-3">
      <p role="alert">{t("לא ניתן לטעון כרגע את השיבוצים שלך. הנתונים לא הוחלפו ברשימה לא מאומתת.")}</p>
      <Button onClick={() => reload()}>{t("נסה שוב")}</Button>
    </div>;
  }

  if (!supplier) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-4">{t("שלום")} {user?.full_name || t("ספק")}</h1>
          <Card className="bg-white/95 backdrop-blur-sm shadow-xl max-w-md mx-auto">
            <CardContent className="p-6 text-center">
              <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
              <p className="text-gray-600">{t("לא נמצא פרופיל ספק התואם למשתמש זה.")}</p>
              <p className="text-sm text-gray-500 mt-2">{t("אנא פנה למנהל המערכת לעדכון הפרטים.")}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">{t("שלום")} {user?.full_name || supplier?.supplier_name || t("ספק")}</h1>
        {filteredEvents.length > 0 && (
          <p className="text-white/80">
            {t("יש לך")} {filteredEvents.filter(e => e.assignmentStatus === 'pending').length} {t("שיבוצים ממתינים לאישור")}
          </p>
        )}
      </div>
      
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardContent className="p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div className="relative">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t("חיפוש...")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-10"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
            <div className="flex bg-gray-100 p-1 rounded-lg">
              <Button onClick={() => setTimeFilter('future')} variant={timeFilter === 'future' ? 'primary' : 'ghost'} className="flex-1 bg-red-800 text-white text-xs sm:text-sm h-8 sm:h-9">{t("עתידיים")}</Button>
              <Button onClick={() => setTimeFilter('past')} variant={timeFilter === 'past' ? 'primary' : 'ghost'} className="flex-1 bg-red-800 text-white text-xs sm:text-sm h-8 sm:h-9">{t("עבר")}</Button>
            </div>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger><SelectValue placeholder={t("כל השנים")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("כל השנים")}</SelectItem>
                {YEARS.map(year => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger><SelectValue placeholder={t("כל החודשים")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("כל החודשים")}</SelectItem>
                {MONTHS.map(month => <SelectItem key={month.value} value={String(month.value)}>{new Intl.DateTimeFormat(locale==='en'?'en-US':'he-IL',{month:'long'}).format(new Date(2026,month.value,1))}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>


      {filteredEvents.length === 0 ? (
        <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
          <CardContent className="p-12 text-center">
            <Calendar className="h-16 w-16 text-gray-400 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-gray-600 mb-4">{t("לא נמצאו אירועים")}</h2>
            <p className="text-gray-500">{t("נסה לשנות את אפשרויות הסינון")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {filteredEvents.map((event, index) => (
            <Card key={`${event.id}-${index}`} className="bg-white/95 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-shadow duration-300">
              <CardHeader className="p-3 sm:p-6">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base sm:text-xl text-gray-900 break-words">
                      {getEventTitle(event)}
                    </CardTitle>
                    <p className="text-gray-600 mt-1">{event.child_name && `${t("שם החתן/כלה")}: ${event.child_name}`}</p>
                    <p className="text-lg font-semibold text-red-800 mt-2">{t("שירות:")} {event.serviceName}</p>
                    {event.supplierNote && (
                      <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-sm font-medium text-yellow-800">{t("הערה עבורך:")}</p>
                        <p className="text-yellow-700">{event.supplierNote}</p>
                      </div>
                    )}
                  </div>
                  <Badge className={`${getStatusColor(event.assignmentStatus)} border`}>
                    {getStatusText(event.assignmentStatus)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0">
                <div className="grid grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <span>{format(new Date(event.event_date), 'dd/MM/yyyy', { locale: he })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-500" />
                    <span>
                      {event.supplier_arrival_time ? (
                        <>
                          <span className="font-semibold">{t("שעת התייצבות:")} {event.event_time}</span>
                          {event.original_event_time && event.original_event_time !== event.event_time && (
                            <span className="text-xs text-gray-500 mr-2">{t("(האירוע מתחיל בשעה")} {event.original_event_time})</span>
                          )}
                        </>
                      ) : (
                        event.event_time
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-500" />
                    <span>{event.location}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-gray-500" />
                    <span>{event.guest_count} {t("אורחים")}</span>
                  </div>
                </div>
                {event.serviceDescription && (
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: event.serviceDescription }} />
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between items-center p-3 sm:p-6 pt-0 gap-2">
                {event.detailsAllowed && <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(createPageUrl('SupplierEventView') + `?id=${event.id}`)}
                  className="border-red-200 text-red-800 hover:bg-red-50 text-xs sm:text-sm"
                >
                  {t("צפה בפרטים")}
                </Button>}
                <div className="flex gap-1 sm:gap-2">
                  {event.assignmentStatus !== 'confirmed' && (
                    <Button
                      size="sm"
                      onClick={() => handleStatusChange(event.eventServiceId, 'confirmed')}
                      className="bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm"
                    >
                      {t("אשר")}
                    </Button>
                  )}
                  {event.assignmentStatus !== 'rejected' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusChange(event.eventServiceId, 'rejected')}
                      className="border-red-500 text-red-600 hover:bg-red-50 text-xs sm:text-sm"
                    >
                      {t("דחה")}
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
