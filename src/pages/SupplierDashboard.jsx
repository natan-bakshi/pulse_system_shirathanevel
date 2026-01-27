import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

const YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i);
const MONTHS = [
  { value: 0, label: "ינואר" }, { value: 1, label: "פברואר" }, { value: 2, label: "מרץ" },
  { value: 3, label: "אפריל" }, { value: 4, label: "מאי" }, { value: 5, label: "יוני" },
  { value: 6, label: "יולי" }, { value: 7, label: "אוגוסט" }, { value: 8, label: "ספטמבר" },
  { value: 9, label: "אוקטובר" }, { value: 10, label: "נובמבר" }, { value: 11, label: "דצמבר" }
];

export default function SupplierDashboard() {
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

  // React Query for current user
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  // React Query for all suppliers
  const { data: allSuppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.list(),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  // React Query for all events
  const { data: allEvents = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      try {
        const { updateExpiredEvents } = await import('@/functions/updateExpiredEvents');
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

  // React Query for services
  const { data: allServices = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => base44.entities.Service.list(),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  const loading = eventsLoading;

  // Find matching supplier for current user
  const supplier = useMemo(() => {
    if (!user) return null;
    
    const userEmail = user.email?.toLowerCase();
    const userPhone = user.phone;
    
    return allSuppliers.find(s => 
      (userEmail && Array.isArray(s.contact_emails) && s.contact_emails.some(email => email.toLowerCase() === userEmail)) ||
      (userPhone && s.phone === userPhone)
    );
  }, [user, allSuppliers]);

  // Get supplier events with details
  const supplierEvents = useMemo(() => {
    if (!supplier) return [];
    
    const supplierAssignments = allEventServices.filter(es => {
      let ids = [];
      try { 
        if (es.supplier_ids) ids = JSON.parse(es.supplier_ids);
        if (!Array.isArray(ids)) ids = [];
      } catch (e) { ids = []; }
      return ids.includes(supplier.id);
    });
    
    return supplierAssignments.map(assignment => {
      const event = allEvents.find(e => e.id === assignment.event_id);
      const service = allServices.find(s => s.id === assignment.service_id);
      if (!event || !service) return null;

      let statuses = {};
      try { 
        if (assignment.supplier_statuses) statuses = JSON.parse(assignment.supplier_statuses);
        if (typeof statuses !== 'object' || statuses === null) statuses = {};
      } catch (e) { statuses = {}; }
      const assignmentStatus = statuses[supplier.id] || 'pending';

      let supplierNotesData = {};
      try { 
        if (assignment.supplier_notes) supplierNotesData = JSON.parse(assignment.supplier_notes);
        if (typeof supplierNotesData !== 'object' || supplierNotesData === null) supplierNotesData = {};
      } catch(e) { supplierNotesData = {}; }
      const noteForSupplier = supplierNotesData[supplier.id] || '';

      return {
        ...event,
        serviceName: service.service_name,
        serviceDescription: service.description,
        assignmentStatus,
        eventServiceId: assignment.id,
        supplierNote: noteForSupplier
      };
    }).filter(Boolean);
  }, [supplier, allEventServices, allEvents, allServices]);

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
          event.family_name.toLowerCase().includes(search) ||
          event.serviceName.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
  }, [supplierEvents, debouncedSearchTerm, timeFilter, yearFilter, monthFilter]);

  const handleStatusChange = useCallback(async (eventServiceId, newStatus) => {
    if (!supplier) return;
    try {
      // Find the event for this service
      const assignment = allEventServices.find(es => es.id === eventServiceId);
      const eventId = assignment?.event_id;

      // Get current status before update
      let currentStatuses = {};
      try {
        currentStatuses = JSON.parse(assignment?.supplier_statuses || '{}');
      } catch (e) {
        currentStatuses = {};
      }
      const previousStatus = currentStatuses[supplier.id];

      await base44.functions.invoke('updateSupplierStatus', {
        eventServiceId,
        newStatus
      });

      // Sync with Google Calendar - DISABLED
      /* if (eventId) {
        try {
          if (newStatus === 'confirmed' && previousStatus !== 'confirmed') {
            // Create calendar event when supplier confirms
            await base44.functions.invoke('syncGoogleCalendar', {
              action: 'create',
              eventId: eventId,
              eventServiceId: eventServiceId,
              supplierId: supplier.id,
              userType: 'supplier'
            });
          } else if (newStatus !== 'confirmed' && previousStatus === 'confirmed') {
            // Delete calendar event when supplier status changes from confirmed
            await base44.functions.invoke('syncGoogleCalendar', {
              action: 'delete',
              eventId: eventId,
              eventServiceId: eventServiceId,
              supplierId: supplier.id,
              userType: 'supplier'
            });
          }
        } catch (calendarError) {
          console.warn("Calendar sync failed:", calendarError);
          // Don't block the status change if calendar sync fails
        }
      } */
      
      // Invalidate cache
      queryClient.invalidateQueries({ queryKey: ['eventServices'] });
    } catch (error) {
      console.error("Failed to update service status:", error);
      alert("שגיאה בעדכון הסטטוס. אנא נסה שוב.");
    }
  }, [supplier, queryClient, allEventServices]);

  const getStatusText = useCallback((status) => {
    const statusTexts = { pending: "ממתין לאישור", confirmed: "אישרתי", rejected: "לא יכול" };
    return statusTexts[status] || "לא ידוע";
  }, []);

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

  if (!supplier) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-4">שלום {user?.full_name || "ספק"}</h1>
          <Card className="bg-white/95 backdrop-blur-sm shadow-xl max-w-md mx-auto">
            <CardContent className="p-6 text-center">
              <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
              <p className="text-gray-600">לא נמצא פרופיל ספק התואם למשתמש זה.</p>
              <p className="text-sm text-gray-500 mt-2">אנא פנה למנהל המערכת לעדכון הפרטים.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-2">שלום {user?.full_name || supplier?.supplier_name || "ספק"}</h1>
        {filteredEvents.length > 0 && (
          <p className="text-white/80">
            יש לך {filteredEvents.filter(e => e.assignmentStatus === 'pending').length} שיבוצים ממתינים לאישור
          </p>
        )}
      </div>
      
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="חיפוש לפי שם אירוע, משפחה או שירות..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-10"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex bg-gray-100 p-1 rounded-lg">
              <Button onClick={() => setTimeFilter('future')} variant={timeFilter === 'future' ? 'primary' : 'ghost'} className="flex-1 bg-red-800 text-white">אירועים עתידיים</Button>
              <Button onClick={() => setTimeFilter('past')} variant={timeFilter === 'past' ? 'primary' : 'ghost'} className="flex-1 bg-red-800 text-white">אירועי עבר</Button>
            </div>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger><SelectValue placeholder="כל השנים" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל השנים</SelectItem>
                {YEARS.map(year => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger><SelectValue placeholder="כל החודשים" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל החודשים</SelectItem>
                {MONTHS.map(month => <SelectItem key={month.value} value={String(month.value)}>{month.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>


      {filteredEvents.length === 0 ? (
        <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
          <CardContent className="p-12 text-center">
            <Calendar className="h-16 w-16 text-gray-400 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-gray-600 mb-4">לא נמצאו אירועים</h2>
            <p className="text-gray-500">נסה לשנות את אפשרויות הסינון</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {filteredEvents.map((event, index) => (
            <Card key={`${event.id}-${index}`} className="bg-white/95 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-shadow duration-300">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-xl text-gray-900">
                      {event.event_name} - משפחת {event.family_name}
                    </CardTitle>
                    <p className="text-gray-600 mt-1">{event.child_name && `לכבוד ${event.child_name}`}</p>
                    <p className="text-lg font-semibold text-red-800 mt-2">שירות: {event.serviceName}</p>
                    {event.supplierNote && (
                      <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-sm font-medium text-yellow-800">הערה עבורך:</p>
                        <p className="text-yellow-700">{event.supplierNote}</p>
                      </div>
                    )}
                  </div>
                  <Badge className={`${getStatusColor(event.assignmentStatus)} border`}>
                    {getStatusText(event.assignmentStatus)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <span>{format(new Date(event.event_date), 'dd/MM/yyyy', { locale: he })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-500" />
                    <span>{event.event_time}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-500" />
                    <span>{event.location}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-gray-500" />
                    <span>{event.guest_count} אורחים</span>
                  </div>
                </div>
                {event.serviceDescription && (
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: event.serviceDescription }} />
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between items-center">
                <Button
                  variant="outline"
                  onClick={() => navigate(createPageUrl('EventDetails') + `?id=${event.id}`)}
                  className="border-red-200 text-red-800 hover:bg-red-50"
                >
                  צפה בפרטים
                </Button>
                <div className="flex gap-2">
                  {event.assignmentStatus !== 'confirmed' && (
                    <Button
                      onClick={() => handleStatusChange(event.eventServiceId, 'confirmed')}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      אשר
                    </Button>
                  )}
                  {event.assignmentStatus !== 'rejected' && (
                    <Button
                      variant="outline"
                      onClick={() => handleStatusChange(event.eventServiceId, 'rejected')}
                      className="border-red-500 text-red-600 hover:bg-red-50"
                    >
                      דחה
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