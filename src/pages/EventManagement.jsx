import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { PlusCircle, Loader2 } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { calculateEventFinancials } from '@/components/utils/eventFinancials';
import EventCard from '../components/events/EventCard';
import EventFilters from '../components/events/EventFilters';
import EventForm from '../components/events/EventForm';

import { updateExpiredEvents } from '@/functions/updateExpiredEvents';

export default function EventManagement() {
    const [filteredEvents, setFilteredEvents] = useState([]);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingEvent, setEditingEvent] = useState(null);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data: appSettings = [] } = useQuery({
        queryKey: ['appSettings'],
        queryFn: () => base44.entities.AppSettings.list(),
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000
    });

    // Note: updateExpiredEvents now runs in background — no blocking on initial load.
    const { data: events = [], isLoading: eventsLoading } = useQuery({
        queryKey: ['events'],
        queryFn: () => base44.entities.Event.list('-event_date'),
        staleTime: 2 * 60 * 1000,
        cacheTime: 5 * 60 * 1000
    });

    // Fire-and-forget: refresh expired events in the background after first paint
    useEffect(() => {
        let cancelled = false;
        const id = setTimeout(() => {
            if (cancelled) return;
            updateExpiredEvents()
                .then(() => queryClient.invalidateQueries({ queryKey: ['events'] }))
                .catch(error => console.warn("Failed to update expired events:", error));
        }, 1500);
        return () => { cancelled = true; clearTimeout(id); };
    }, [queryClient]);

    // Fetch Services and Payments to calculate totals correctly
    const { data: allServices = [] } = useQuery({
        queryKey: ['eventServices'],
        queryFn: () => base44.entities.EventService.list(),
        staleTime: 2 * 60 * 1000,
        cacheTime: 5 * 60 * 1000
    });

    const { data: allPayments = [] } = useQuery({
        queryKey: ['payments'],
        queryFn: () => base44.entities.Payment.list(),
        staleTime: 2 * 60 * 1000,
        cacheTime: 5 * 60 * 1000
    });

    // Pre-group services & payments by event_id ONCE — avoids O(n²) filter per card.
    const servicesByEvent = useMemo(() => {
        const m = new Map();
        for (const es of allServices) {
            if (!m.has(es.event_id)) m.set(es.event_id, []);
            m.get(es.event_id).push(es);
        }
        return m;
    }, [allServices]);

    const paymentsByEvent = useMemo(() => {
        const m = new Map();
        for (const p of allPayments) {
            if (!m.has(p.event_id)) m.set(p.event_id, []);
            m.get(p.event_id).push(p);
        }
        return m;
    }, [allPayments]);

    // Memoize VAT rate & exchange rate lookups (was recomputed for every event card).
    const { vatRate, exRate } = useMemo(() => {
        const vatRateSetting = appSettings.find(s => s.setting_key === 'vat_rate');
        const rS = appSettings.find(s => s.setting_key === 'usd_ils_exchange_rate');
        return {
            vatRate: vatRateSetting ? parseFloat(vatRateSetting.setting_value) / 100 : 0.18,
            exRate: rS ? parseFloat(rS.setting_value) || 3.6 : 3.6
        };
    }, [appSettings]);

    const calculateTotals = useCallback((event) => {
        const eventServices = servicesByEvent.get(event.id) || [];
        const payments = paymentsByEvent.get(event.id) || [];

        const financials = calculateEventFinancials(event, eventServices, payments, vatRate, exRate);

        return { 
            finalTotal: financials.finalTotal, 
            totalPaid: financials.totalPaid, 
            balance: financials.balance, 
            discountAmount: financials.discountAmount,
            currency: financials.currency
        };
    }, [servicesByEvent, paymentsByEvent, vatRate, exRate]);

    useEffect(() => {
        setFilteredEvents(events);
    }, [events]);

    const loadEvents = useCallback(async () => {
        queryClient.invalidateQueries({ queryKey: ['events'] });
        queryClient.invalidateQueries({ queryKey: ['eventServices'] });
        queryClient.invalidateQueries({ queryKey: ['payments'] });
    }, [queryClient]);
    
    const handleSave = useCallback(async (savedEvent) => {
        try {
            // EventForm כבר יצר/עדכן את האירוע - כאן רק מרעננים ומנווטים
            if (!editingEvent && savedEvent?.id) {
                navigate(createPageUrl(`EventDetails?id=${savedEvent.id}`));
            }
            setIsFormOpen(false);
            setEditingEvent(null);
            await loadEvents();
        } catch (error) {
            console.error("Failed to save event:", error);
        }
    }, [editingEvent, navigate, loadEvents]);

    const handleEdit = useCallback((event) => {
        setEditingEvent(event);
        setIsFormOpen(true);
    }, []);
    
    const handleDelete = useCallback(async (eventId) => {
        if (window.confirm("האם אתה בטוח שברצונך למחוק אירוע זה?")) {
            try {
                await base44.entities.Event.delete(eventId);
            } catch (error) {
                // If already deleted (not found), just refresh
                const errorMsg = error.message || JSON.stringify(error);
                if (!errorMsg.includes("not found")) {
                    console.error("Failed to delete event:", error);
                    alert("שגיאה במחיקת האירוע");
                }
            } finally {
                await loadEvents();
            }
        }
    }, [loadEvents]);

    const handleSelectEvent = useCallback((eventId) => {
        navigate(createPageUrl(`EventDetails?id=${eventId}`));
    }, [navigate]);
    
    return (
        <div className="p-2 sm:p-4 lg:p-8 max-w-full mx-auto w-full">
            <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                <CardHeader className="p-3 sm:p-6">
                    <div className="flex justify-between items-center gap-2">
                        <CardTitle className="text-xl sm:text-2xl">ניהול אירועים</CardTitle>
                        <Button onClick={() => { setEditingEvent(null); setIsFormOpen(true); }} size="sm" className="sm:h-9 sm:px-4">
                            <PlusCircle className="ml-1 sm:ml-2 h-4 w-4" />
                            <span className="hidden sm:inline">צור אירוע חדש</span>
                            <span className="sm:hidden">חדש</span>
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-3 sm:p-6">
                    <EventFilters events={events} setFilteredEvents={setFilteredEvents} />
                    
                    {eventsLoading ? (
                        <div className="flex justify-center items-center py-10">
                            <Loader2 className="h-8 w-8 animate-spin text-red-800" />
                        </div>
                    ) : (
                        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mt-6">
                            {filteredEvents.map(event => (
                                <EventCard 
                                    key={event.id} 
                                    event={event} 
                                    totals={calculateTotals(event)}
                                    onEdit={handleEdit} 
                                    onDelete={handleDelete} 
                                    onSelect={handleSelectEvent}
                                />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {isFormOpen && (
                <EventForm 
                    isOpen={isFormOpen} 
                    onClose={() => setIsFormOpen(false)} 
                    onSave={handleSave} 
                    event={editingEvent}
                />
            )}
        </div>
    );
}