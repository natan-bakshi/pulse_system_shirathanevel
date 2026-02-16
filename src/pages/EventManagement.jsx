import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlusCircle, Loader2, LayoutGrid, Table } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { calculateEventFinancials } from '@/components/utils/eventFinancials';
import EventCard from '../components/events/EventCard';
import EventFilters from '../components/events/EventFilters';
import EventForm from '../components/events/EventForm';
import EventsBoard from '../components/events/EventsBoard';
import { updateExpiredEvents } from '@/functions/updateExpiredEvents';

export default function EventManagement() {
    const location = useLocation();
    const urlParams = new URLSearchParams(location.search);
    const initialTab = urlParams.get('tab') || 'grid';
    
    const [filteredEvents, setFilteredEvents] = useState([]);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingEvent, setEditingEvent] = useState(null);
    const [activeTab, setActiveTab] = useState(initialTab);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Fetch app settings to check if events board is enabled
    const { data: appSettings = [] } = useQuery({
        queryKey: ['appSettings'],
        queryFn: () => base44.entities.AppSettings.list(),
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000
    });

    const showEventsBoardTab = useMemo(() => {
        const setting = appSettings.find(s => s.setting_key === 'show_events_board_tab');
        return setting?.setting_value === 'true';
    }, [appSettings]);

    const { data: events = [], isLoading: eventsLoading } = useQuery({
        queryKey: ['events'],
        queryFn: async () => {
            try {
                await updateExpiredEvents();
            } catch (error) {
                console.warn("Failed to update expired events:", error);
            }
            return base44.entities.Event.list('-event_date');
        },
        staleTime: 2 * 60 * 1000,
        cacheTime: 5 * 60 * 1000
    });

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

    const calculateTotals = useCallback((event) => {
        const eventServices = allServices.filter(es => es.event_id === event.id);
        const payments = allPayments.filter(p => p.event_id === event.id);
        
        const vatRateSetting = appSettings.find(s => s.setting_key === 'vat_rate');
        const vatRate = vatRateSetting ? parseFloat(vatRateSetting.setting_value) / 100 : 0.18;

        const financials = calculateEventFinancials(event, eventServices, payments, vatRate);

        return { 
            finalTotal: financials.finalTotal, 
            totalPaid: financials.totalPaid, 
            balance: financials.balance, 
            discountAmount: financials.discountAmount 
        };
    }, [allServices, allPayments, appSettings]);

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
        <div className="p-4 sm:p-6 lg:p-8 max-w-full mx-auto w-full">
            <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-2xl">ניהול אירועים</CardTitle>
                        <Button onClick={() => { setEditingEvent(null); setIsFormOpen(true); }}>
                            <PlusCircle className="ml-2 h-4 w-4" />
                            צור אירוע חדש
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="grid w-full max-w-md mb-6" style={{ gridTemplateColumns: showEventsBoardTab ? '1fr 1fr' : '1fr' }}>
                            <TabsTrigger value="grid" className="flex items-center gap-2">
                                <LayoutGrid className="h-4 w-4" />
                                תצוגת כרטיסים
                            </TabsTrigger>
                            {showEventsBoardTab && (
                                <TabsTrigger value="board" className="flex items-center gap-2">
                                    <Table className="h-4 w-4" />
                                    לוח אירועים
                                </TabsTrigger>
                            )}
                        </TabsList>

                        <TabsContent value="grid" className="mt-0">
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
                        </TabsContent>

                        {showEventsBoardTab && (
                            <TabsContent value="board" className="mt-0 min-w-0">
                                <EventsBoard />
                            </TabsContent>
                        )}
                    </Tabs>
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