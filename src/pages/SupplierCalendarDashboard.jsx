import React, { useState, useMemo, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, AlertCircle, Loader2, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import EventsCalendar from "@/components/admin/EventsCalendar";

export default function SupplierCalendarDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
    queryFn: () => base44.entities.Event.list(),
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

  // Get supplier events with assignment status
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

      return {
        ...event,
        serviceName: service.service_name,
        assignmentStatus,
        eventServiceId: assignment.id
      };
    }).filter(Boolean);
  }, [supplier, allEventServices, allEvents, allServices]);

  // Calendar events - mapped to match EventsCalendar format
  // Map supplier assignment statuses to EventsCalendar color statuses:
  // confirmed → in_progress (green), pending → pending (yellow), rejected → rejected (red)
  const calendarEvents = useMemo(() => {
    const statusToCalendarStatus = {
      confirmed: 'in_progress',  // green
      pending: 'pending',        // yellow
      rejected: 'rejected'       // red
    };
    return supplierEvents.map(ev => ({
      ...ev,
      status: statusToCalendarStatus[ev.assignmentStatus] || 'pending'
    }));
  }, [supplierEvents]);

  // Pending events for the list below the calendar
  const pendingEvents = useMemo(() => {
    return supplierEvents
      .filter(ev => ev.assignmentStatus === 'pending')
      .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
  }, [supplierEvents]);

  // Handle status change (reuse existing function from SupplierDashboard)
  const handleStatusChange = useCallback(async (eventServiceId, newStatus) => {
    if (!supplier) return;
    try {
      await base44.functions.invoke('updateSupplierStatus', {
        eventServiceId,
        newStatus
      });
      queryClient.invalidateQueries({ queryKey: ['eventServices'] });
    } catch (error) {
      console.error("Failed to update service status:", error);
      alert("שגיאה בעדכון הסטטוס. אנא נסה שוב.");
    }
  }, [supplier, queryClient]);

  // Calendar: click on event navigates to EventDetails
  const handleEventClick = useCallback((event) => {
    navigate(createPageUrl('EventDetails') + `?id=${event.id}`);
  }, [navigate]);

  // Calendar: click on date does nothing for suppliers
  const handleDateClick = useCallback(() => {
    // Suppliers cannot create events - do nothing
  }, []);

  const getStatusText = (status) => {
    const statusTexts = { pending: "ממתין לאישור", confirmed: "אישרתי", rejected: "לא יכול" };
    return statusTexts[status] || "לא ידוע";
  };

  const getStatusColor = (status) => {
    const colors = { pending: "bg-yellow-100 text-yellow-800 border-yellow-200", confirmed: "bg-green-100 text-green-800 border-green-200", rejected: "bg-red-100 text-red-800 border-red-200" };
    return colors[status] || "bg-gray-100 text-gray-800 border-gray-200";
  };

  if (eventsLoading) {
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
    <div className="space-y-4 sm:space-y-6">
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">
          שלום {user?.full_name || supplier?.supplier_name || "ספק"}
        </h1>
        {pendingEvents.length > 0 && (
          <p className="text-white/80">
            יש לך {pendingEvents.length} שיבוצים ממתינים לאישור
          </p>
        )}
      </div>

      {/* Calendar */}
      <EventsCalendar
        events={calendarEvents}
        onDateClick={handleDateClick}
        onEventClick={handleEventClick}
      />

      {/* Pending Events List */}
      {pendingEvents.length > 0 && (
        <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
          <CardHeader className="p-3 sm:p-6 pb-2">
            <CardTitle className="text-lg sm:text-xl text-gray-900 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              שיבוצים ממתינים לאישור
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0 space-y-3">
            {pendingEvents.map((event, index) => (
              <div
                key={`${event.id}-${event.eventServiceId}-${index}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 text-sm sm:text-base">
                    {event.event_name} - משפחת {event.family_name}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm text-gray-600 mt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(event.event_date), 'dd/MM/yyyy', { locale: he })}
                    </span>
                    {event.event_time && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {event.event_time}
                      </span>
                    )}
                    {event.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {event.location}
                      </span>
                    )}
                  </div>
                  <div className="text-xs sm:text-sm text-red-800 font-medium mt-1">
                    שירות: {event.serviceName}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => handleStatusChange(event.eventServiceId, 'confirmed')}
                    className="bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm"
                  >
                    <CheckCircle className="h-4 w-4 sm:ml-1" />
                    <span className="hidden sm:inline">אשר</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStatusChange(event.eventServiceId, 'rejected')}
                    className="border-red-500 text-red-600 hover:bg-red-50 text-xs sm:text-sm"
                  >
                    <XCircle className="h-4 w-4 sm:ml-1" />
                    <span className="hidden sm:inline">דחה</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(createPageUrl('EventDetails') + `?id=${event.id}`)}
                    className="border-red-200 text-red-800 hover:bg-red-50 text-xs sm:text-sm"
                  >
                    פרטים
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}