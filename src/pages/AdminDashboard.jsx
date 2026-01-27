import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Plus, ListChecks, Settings, Home, AlertTriangle, ArrowRight, Search, Filter } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { updateExpiredEvents } from '@/functions/updateExpiredEvents';

import StatCard from "../components/admin/StatCard";
import EventsCalendar from "../components/admin/EventsCalendar";
import CalendarSettings from "../components/admin/CalendarSettings";
import EventForm from "../components/events/EventForm";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const DEFAULT_VISIBLE_STATUSES = ["confirmed", "in_progress"];

export default function AdminDashboard() {
  const [showDashboardSettings, setShowDashboardSettings] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [formInitialDate, setFormInitialDate] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);
  const [assignmentSearchTerm, setAssignmentSearchTerm] = useState('');
  const [debouncedAssignmentSearch, setDebouncedAssignmentSearch] = useState('');
  const [assignmentSortBy, setAssignmentSortBy] = useState('event');

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Debouncing effect for assignment search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAssignmentSearch(assignmentSearchTerm), 300);
    return () => clearTimeout(timer);
  }, [assignmentSearchTerm]);

  // React Query for calendar settings
  const { data: calendarSettings } = useQuery({
    queryKey: ['calendarSettings'],
    queryFn: async () => {
      const settings = await base44.entities.AppSettings.filter({ setting_key: 'calendar_visible_statuses' });
      if (settings && settings.length > 0) {
        const savedStatuses = JSON.parse(settings[0].setting_value || "[]");
        return savedStatuses.length > 0 ? savedStatuses : DEFAULT_VISIBLE_STATUSES;
      }
      return DEFAULT_VISIBLE_STATUSES;
    },
    staleTime: 10 * 60 * 1000,
    cacheTime: 30 * 60 * 1000,
    onError: () => DEFAULT_VISIBLE_STATUSES
  });

  const { data: boardSettings = [] } = useQuery({
    queryKey: ['boardSettings'],
    queryFn: () => base44.entities.AppSettings.filter({ setting_key: 'show_events_board_tab' }),
    staleTime: 5 * 60 * 1000
  });

  const visibleStatuses = calendarSettings || DEFAULT_VISIBLE_STATUSES;

  const showEventsBoardTab = useMemo(() => {
    const setting = boardSettings.find((s) => s.setting_key === 'show_events_board_tab');
    return setting?.setting_value === 'true';
  }, [boardSettings]);

  // React Query for events
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['events', '-event_date'],
    queryFn: async () => {
      try {
        await updateExpiredEvents();
      } catch (error) {
        console.warn("Failed to update expired events:", error);
      }
      return base44.entities.Event.list('-event_date');
    },
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  // React Query for event services
  const { data: eventServices = [] } = useQuery({
    queryKey: ['eventServices'],
    queryFn: () => base44.entities.EventService.list(),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  // React Query for suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.list(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  // React Query for services
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => base44.entities.Service.list(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  const loading = eventsLoading;

  // Memoize filtered visible events
  const visibleEvents = useMemo(() => {
    return events.filter((event) =>
    visibleStatuses && Array.isArray(visibleStatuses) && visibleStatuses.includes(event.status)
    );
  }, [events, visibleStatuses]);

  // Memoize stats calculation
  const { stats, pendingAssignments, rejectedAssignments } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureVisibleEvents = visibleEvents.filter((event) => {
      const eventDate = new Date(event.event_date);
      eventDate.setHours(0, 0, 0, 0);
      return eventDate >= today;
    });

    const thisMonthVisibleEvents = futureVisibleEvents.filter((event) => {
      const eventDate = new Date(event.event_date);
      return eventDate.getMonth() === today.getMonth() &&
      eventDate.getFullYear() === today.getFullYear();
    });

    const allPending = [];
    const allRejected = [];

    eventServices.forEach((es) => {
      let supplierIds = [];
      let supplierStatuses = {};

      try {
        if (es.supplier_ids) {
          const parsedIds = JSON.parse(es.supplier_ids);
          if (Array.isArray(parsedIds)) {
            supplierIds = parsedIds;
          }
        }
      } catch (e) {
        supplierIds = [];
      }

      try {
        if (es.supplier_statuses) {
          const parsedStatuses = JSON.parse(es.supplier_statuses);
          if (typeof parsedStatuses === 'object' && parsedStatuses !== null) {
            supplierStatuses = parsedStatuses;
          }
        }
      } catch (e) {
        supplierStatuses = {};
      }

      supplierIds.forEach((supplierId) => {
        const status = supplierStatuses[supplierId] || 'pending';
        const event = events.find((e) => e.id === es.event_id);
        const supplier = suppliers.find((s) => s.id === supplierId);
        const service = services.find((s) => s.id === es.service_id);

        if (event && supplier && service) {
          const eventDate = new Date(event.event_date);
          eventDate.setHours(0, 0, 0, 0);
          const isFutureEvent = eventDate >= today && event.status !== 'completed' && event.status !== 'cancelled';

          if (isFutureEvent) {
            const assignmentData = {
              event,
              supplier,
              eventServiceId: es.id,
              serviceName: service.service_name,
              supplierId: supplierId
            };

            if (status === 'pending') {
              allPending.push(assignmentData);
            } else if (status === 'rejected') {
              allRejected.push(assignmentData);
            }
          }
        }
      });
    });

    return {
      stats: {
        futureEvents: futureVisibleEvents.length,
        thisMonthEvents: thisMonthVisibleEvents.length,
        pendingAssignments: allPending.length,
        rejectedAssignments: allRejected.length
      },
      pendingAssignments: allPending,
      rejectedAssignments: allRejected
    };
  }, [visibleEvents, events, eventServices, suppliers, services]);

  // Memoize upcoming events
  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events.
    filter((event) => {
      const eventDate = new Date(event.event_date);
      eventDate.setHours(0, 0, 0, 0);
      return eventDate >= today && visibleStatuses && Array.isArray(visibleStatuses) && visibleStatuses.includes(event.status);
    }).
    sort((a, b) => new Date(a.event_date) - new Date(b.event_date)).
    slice(0, 5);
  }, [events, visibleStatuses]);

  const handleCreateEvent = useCallback((initialDate) => {
    setFormInitialDate(initialDate || '');
    setEditingEvent(null);
    setShowEventForm(true);
  }, []);

  const handleDateClick = useCallback((dateStr) => {
    handleCreateEvent(dateStr);
  }, [handleCreateEvent]);

  const handleEventClick = useCallback((event) => {
    navigate(createPageUrl(`EventDetails?id=${event.id}`));
  }, [navigate]);

  const handleSaveEvent = useCallback(async () => {
    setShowEventForm(false);
    setEditingEvent(null);
    setFormInitialDate('');

    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: ['events'] });
    queryClient.invalidateQueries({ queryKey: ['eventServices'] });
  }, [queryClient]);

  const handleUpdateAssignmentStatus = useCallback(async (eventServiceId, supplierId, newStatus) => {
    try {
      const eventService = eventServices.find((es) => es.id === eventServiceId);
      if (!eventService) return;

      let supplierStatuses = {};
      try {
        supplierStatuses = JSON.parse(eventService.supplier_statuses || '{}');
      } catch (e) {
        supplierStatuses = {};
      }

      supplierStatuses[supplierId] = newStatus;

      await base44.entities.EventService.update(eventServiceId, {
        supplier_statuses: JSON.stringify(supplierStatuses)
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['eventServices'] });
    } catch (error) {
      console.error("Failed to update assignment status:", error);
      alert("שגיאה בעדכון סטטוס השיבוץ");
    }
  }, [eventServices, queryClient]);

  const getFilteredAndSortedAssignments = useCallback((assignments) => {
    // Filter by search term
    let filtered = assignments.filter((a) => {
      const searchLower = debouncedAssignmentSearch.toLowerCase();

      const familyName = a.event?.family_name?.toLowerCase() || '';
      const supplierName = a.supplier?.supplier_name?.toLowerCase() || '';
      const serviceName = a.serviceName?.toLowerCase() || '';
      const eventDateFormatted = a.event?.event_date ? format(new Date(a.event.event_date), "dd/MM/yyyy") : '';

      return (
        familyName.includes(searchLower) ||
        supplierName.includes(searchLower) ||
        serviceName.includes(searchLower) ||
        eventDateFormatted.includes(searchLower));

    });

    // Sort by selected criteria
    if (assignmentSortBy === 'event') {
      filtered.sort((a, b) => (a.event?.family_name || '').localeCompare(b.event?.family_name || '', 'he'));
    } else if (assignmentSortBy === 'supplier') {
      filtered.sort((a, b) => (a.supplier?.supplier_name || '').localeCompare(b.supplier?.supplier_name || '', 'he'));
    } else if (assignmentSortBy === 'service') {
      filtered.sort((a, b) => (a.serviceName || '').localeCompare(b.serviceName || '', 'he'));
    }

    return filtered;
  }, [debouncedAssignmentSearch, assignmentSortBy]);

  const filteredPendingAssignments = useMemo(() =>
  getFilteredAndSortedAssignments(pendingAssignments),
  [pendingAssignments, getFilteredAndSortedAssignments]
  );

  const filteredRejectedAssignments = useMemo(() =>
  getFilteredAndSortedAssignments(rejectedAssignments),
  [rejectedAssignments, getFilteredAndSortedAssignments]
  );

  const getStatusText = useCallback((status) => {
    const statusTexts = {
      quote: "הצעת מחיר",
      confirmed: "אירוע סגור",
      in_progress: "אירוע תפור",
      completed: "אירוע עבר",
      cancelled: "אירוע בוטל"
    };
    return statusTexts[status] || status;
  }, []);

  const getStatusColor = useCallback((status) => ({
    quote: "bg-yellow-100 text-yellow-800",
    confirmed: "bg-blue-100 text-blue-800",
    in_progress: "bg-green-100 text-green-800",
    completed: "bg-gray-100 text-gray-800",
    cancelled: "bg-red-100 text-red-800"
  })[status] || "bg-gray-100", []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>);

  }

  return (
    <div className="space-y-8">

      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">דשבורד ניהול</h1>
            <p className="text-white/80 mt-1">מבט כללי על האירועים והביצועים</p>
          </div>
          <div className="flex gap-2">
            {showEventsBoardTab &&
            <Button
              onClick={() => navigate(createPageUrl('EventManagement?tab=board'))}
              variant="ghost" className="text-red-700 px-3 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-1 whitespace-nowrap ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:text-accent-foreground h-9 hover:bg-white/20">


                <Calendar className="h-4 w-4 ml-2" />
                לוח אירועים
              </Button>
            }
            <Button
              onClick={() => setShowDashboardSettings(!showDashboardSettings)}
              variant="ghost" className="text-red-700 px-3 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-1 whitespace-nowrap ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:text-accent-foreground h-9 hover:bg-white/20">


              <Settings className="h-4 w-4 ml-2" />
              הגדרות דשבורד
            </Button>
            <Button
              onClick={() => handleCreateEvent('')}
              className="bg-red-800 hover:bg-red-700 text-white shadow-lg">

              <Plus className="h-4 w-4 ml-2" />
              אירוע חדש
            </Button>
          </div>
        </div>
        
        {showDashboardSettings &&
        <CalendarSettings
          onSettingsChange={(newStatuses) => {
            queryClient.invalidateQueries({ queryKey: ['calendarSettings'] });
          }}
          onClose={() => setShowDashboardSettings(false)} />

        }
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
        <StatCard title="עתידיים" value={stats.futureEvents} icon={Calendar} color="wine" />
        <StatCard title="החודש" value={stats.thisMonthEvents} icon={Clock} color="gold" />
        <StatCard title="ממתינים" value={stats.pendingAssignments} icon={Clock} color="wine" />
        <StatCard title="נדחו" value={stats.rejectedAssignments} icon={AlertTriangle} color="gold" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <EventsCalendar
            events={events.filter((event) => visibleStatuses.includes(event.status))}
            onEventClick={handleEventClick}
            onDateClick={handleDateClick} />

        </div>
        <div>
          <Card className="bg-white/95 backdrop-blur-sm shadow-xl max-h-[calc(100vh-12rem)] flex flex-col">
            <CardHeader>
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <ListChecks className="h-5 w-5" />
                אירועים קרובים
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-y-auto flex-grow">
              <div className="space-y-3">
                {upcomingEvents.length > 0 ? upcomingEvents.map((event) => {
                  return (
                    <button
                      key={event.id}
                      onClick={() => handleEventClick(event)}
                      className="block w-full p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer text-right">

                            <div className="flex justify-between items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <h4 className="font-medium text-gray-900 break-words">{event.event_name}</h4>
                                <p className="text-sm text-gray-600 break-words">משפחת {event.family_name}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <Calendar className="h-3 w-3 text-gray-400" />
                                  <span className="text-xs text-gray-500">
                                    {event.event_date ? format(new Date(event.event_date), "dd/MM/yyyy", { locale: he }) : 'N/A'}
                                  </span>
                                </div>
                                 <div className="flex items-center gap-2 mt-1">
                                  <Home className="h-3 w-3 text-gray-400" />
                                  <span className="text-xs text-gray-500">
                                    {event.city || 'לא צוין'}
                                  </span>
                                </div>
                              </div>
                              <Badge className={getStatusColor(event.status)}>
                                {getStatusText(event.status)}
                              </Badge>
                            </div>
                        </button>);

                }) :
                <p className="text-center text-gray-500 py-4">אין אירועים קרובים להצגה.</p>
                }
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {(filteredRejectedAssignments.length > 0 || filteredPendingAssignments.length > 0) &&
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
          <CardHeader>
            <div className="flex flex-col gap-4">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                ניהול שיבוצים
              </CardTitle>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                  placeholder="חיפוש לפי אירוע, ספק, שירות או תאריך..."
                  value={assignmentSearchTerm}
                  onChange={(e) => setAssignmentSearchTerm(e.target.value)}
                  className="pr-10" />

                </div>
                <div className="flex gap-2 items-center">
                  <Filter className="h-4 w-4 text-gray-500" />
                  <Button
                  variant={assignmentSortBy === 'event' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAssignmentSortBy('event')}>

                    לפי אירוע
                  </Button>
                  <Button
                  variant={assignmentSortBy === 'supplier' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAssignmentSortBy('supplier')}>

                    לפי ספק
                  </Button>
                  <Button
                  variant={assignmentSortBy === 'service' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAssignmentSortBy('service')}>

                    לפי שירות
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {filteredRejectedAssignments.length > 0 &&
            <div>
                  <h3 className="font-semibold text-lg mb-3 text-red-800 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    שיבוצים שנדחו ({filteredRejectedAssignments.length})
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {filteredRejectedAssignments.map(({ event, supplier, eventServiceId, serviceName, supplierId }) =>
                <div key={`rejected-${eventServiceId}-${supplierId}`} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 bg-red-50 rounded-lg border border-red-200 gap-2">
                        <div className="flex-1 min-w-0 w-full">
                          <Link to={createPageUrl(`EventDetails?id=${event.id}`)} className="font-semibold text-blue-600 hover:underline break-words block">
                            {event.family_name} - {format(new Date(event.event_date), "dd/MM/yy", { locale: he })}
                          </Link>
                          <p className="text-sm text-gray-600 break-words">ספק: {supplier.supplier_name}</p>
                          <p className="text-sm text-gray-500 break-words">שירות: {serviceName}</p>
                        </div>
                        <div className="flex gap-2 items-center mt-2 sm:mt-0">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7">
                                <Badge className="bg-red-100 text-red-800">נדחה</Badge>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => handleUpdateAssignmentStatus(eventServiceId, supplierId, 'pending')}>
                                שנה ל-בהמתנה
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUpdateAssignmentStatus(eventServiceId, supplierId, 'confirmed')}>
                                שנה ל-אושר
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                )}
                  </div>
                </div>
            }

              {filteredPendingAssignments.length > 0 &&
            <div>
                  <h3 className="font-semibold text-lg mb-3 text-yellow-800 flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    שיבוצים ממתינים ({filteredPendingAssignments.length})
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {filteredPendingAssignments.map(({ event, supplier, eventServiceId, serviceName, supplierId }) =>
                <div key={`pending-${eventServiceId}-${supplierId}`} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 bg-yellow-50 rounded-lg border border-yellow-200 gap-2">
                        <div className="flex-1 min-w-0 w-full">
                          <Link to={createPageUrl(`EventDetails?id=${event.id}`)} className="font-semibold text-blue-600 hover:underline break-words block">
                            {event.family_name} - {format(new Date(event.event_date), "dd/MM/yy", { locale: he })}
                          </Link>
                          <p className="text-sm text-gray-600 break-words">ספק: {supplier.supplier_name}</p>
                          <p className="text-sm text-gray-500 break-words">שירות: {serviceName}</p>
                        </div>
                        <div className="flex gap-2 items-center mt-2 sm:mt-0">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7">
                                <Badge className="bg-yellow-100 text-yellow-800">בהמתנה</Badge>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => handleUpdateAssignmentStatus(eventServiceId, supplierId, 'confirmed')}>
                                שנה ל-אושר
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUpdateAssignmentStatus(eventServiceId, supplierId, 'rejected')}>
                                שנה ל-נדחה
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                )}
                  </div>
                </div>
            }
            </div>
          </CardContent>
        </Card>
      }

      {showEventForm &&
      <EventForm
        isOpen={showEventForm}
        onClose={() => {
          setShowEventForm(false);
          setFormInitialDate('');
          setEditingEvent(null);
        }}
        onSave={handleSaveEvent}
        event={editingEvent}
        initialDate={formInitialDate} />

      }
    </div>);

}