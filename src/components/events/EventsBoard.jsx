import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, Loader2, Settings, Save, X, ArrowRight, Edit, Trash2, UserPlus, Filter, Table2, GripVertical, Plus, Copy, HelpCircle, Check, Search } from 'lucide-react';
import { format, startOfMonth, endOfMonth, isBefore, startOfDay } from 'date-fns';
import { he } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ContactPicker from '@/components/ui/ContactPicker';


export default function EventsBoard() {
    const currentDate = new Date();
    const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
    const [collapsedMonths, setCollapsedMonths] = useState({});
    const [editingAssignment, setEditingAssignment] = useState(null);
    const [editingService, setEditingService] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [copiedId, setCopiedId] = useState(null); 
    const [activeTab, setActiveTab] = useState('assignment'); 

    const [statusFilters, setStatusFilters] = useState(() => {
        try {
            const saved = localStorage.getItem('eventsBoard_statusFilters');
            if (saved !== null) return JSON.parse(saved);
            return ["confirmed", "in_progress", "completed"];
        } catch {
            return ["confirmed", "in_progress", "completed"];
        }
    });
    const [hidePastEventsInCurrentMonth, setHidePastEventsInCurrentMonth] = useState(() => {
        const saved = localStorage.getItem('eventsBoard_hidePastEvents');
        if (saved !== null) return saved === 'true';
        return true;
    });
    const [isStickyEnabled, setIsStickyEnabled] = useState(() => {
        const saved = localStorage.getItem('eventsBoard_sticky');
        if (saved !== null) return saved !== 'false';
        return false;
    });

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [tempCategories, setTempCategories] = useState([]);
    const [isSavingSettings, setIsSavingSettings] = useState(false);

    const [showNewSupplierDialog, setShowNewSupplierDialog] = useState(false);
    const [isSavingNewSupplier, setIsSavingNewSupplier] = useState(false);
    const [newSupplier, setNewSupplier] = useState({
        supplier_name: '',
        contact_person: '',
        phone: '',
        contact_emails: ['']
    });

    useEffect(() => {
        localStorage.setItem('eventsBoard_statusFilters', JSON.stringify(statusFilters));
    }, [statusFilters]);

    useEffect(() => {
        localStorage.setItem('eventsBoard_sticky', isStickyEnabled);
    }, [isStickyEnabled]);

    useEffect(() => {
        localStorage.setItem('eventsBoard_hidePastEvents', hidePastEventsInCurrentMonth);
    }, [hidePastEventsInCurrentMonth]);
    const [supplierSearchInDialog, setSupplierSearchInDialog] = useState('');
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    useEffect(() => {
        const style = document.createElement('style');
        style.textContent = `
               #component-preview-container > .min-h-screen.flex.overflow-x-hidden > * {
                   min-width: 0 !important;
               }
               body, html {
                   overflow-x: hidden !important;
               }
           `;
        document.head.appendChild(style);

        return () => {
            document.head.removeChild(style);
        };
    }, []);

    useEffect(() => {
        const today = startOfDay(new Date());
        const initialCollapsed = {};

        for (let month = 0; month < 12; month++) {
            const monthEnd = endOfMonth(new Date(selectedYear, month));
            if (isBefore(monthEnd, today)) {
                initialCollapsed[month] = true;
            }
        }

        setCollapsedMonths(initialCollapsed);
    }, [selectedYear]);

    const { data: appSettings = [] } = useQuery({
        queryKey: ['appSettings'],
        queryFn: () => base44.entities.AppSettings.list(),
        staleTime: 5 * 60 * 1000
    });

    const { data: allServices = [] } = useQuery({
        queryKey: ['services'],
        queryFn: () => base44.entities.Service.list(),
        staleTime: 5 * 60 * 1000
    });

    const { data: events = [], isLoading: eventsLoading } = useQuery({
        queryKey: ['events', selectedYear],
        queryFn: () => base44.entities.Event.list('-event_date'),
        staleTime: 2 * 60 * 1000
    });

    const { data: eventServices = [] } = useQuery({
        queryKey: ['eventServices'],
        queryFn: () => base44.entities.EventService.list(),
        staleTime: 2 * 60 * 1000
    });

    const { data: suppliers = [] } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => base44.entities.Supplier.list(),
        staleTime: 5 * 60 * 1000
    });

    const selectedCategories = useMemo(() => {
        const setting = appSettings.find(s => s.setting_key === 'events_board_categories');
        if (!setting) return [];
        try {
            return JSON.parse(setting.setting_value);
        } catch {
            return [];
        }
    }, [appSettings]);

    useEffect(() => {
        setTempCategories(selectedCategories);
    }, [selectedCategories, isSettingsOpen]);

    const boardColumns = useMemo(() => {
        return selectedCategories;
    }, [selectedCategories]);

    const availableCategories = useMemo(() => {
        const categories = allServices
            .map(s => s.category)
            .filter(cat => cat && cat.trim() !== '');
        return [...new Set(categories)].sort();
    }, [allServices]);

    const toggleCategory = useCallback((category) => {
        setTempCategories(current =>
            current.includes(category)
                ? current.filter(c => c !== category)
                : [...current, category]
        );
    }, []);

    const handleDragEnd = useCallback((result) => {
        if (!result.destination) return;

        const items = Array.from(tempCategories);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);

        setTempCategories(items);
    }, [tempCategories]);

    const handleSaveBoardSettings = useCallback(async () => {
        setIsSavingSettings(true);
        try {
            const existingSettings = appSettings.find(s => s.setting_key === 'events_board_categories');
            const value = JSON.stringify(tempCategories);

            if (existingSettings) {
                await base44.entities.AppSettings.update(existingSettings.id, { setting_value: value });
            } else {
                await base44.entities.AppSettings.create({ setting_key: 'events_board_categories', setting_value: value });
            }

            queryClient.invalidateQueries({ queryKey: ['appSettings'] });
            setIsSettingsOpen(false);
        } catch (error) {
            console.error("Failed to save settings:", error);
            alert("שגיאה בשמירת ההגדרות.");
        } finally {
            setIsSavingSettings(false);
        }
    }, [tempCategories, appSettings, queryClient]);

    const handleCreateSupplier = useCallback(async () => {
        setIsSavingNewSupplier(true);
        try {
            const supplierData = {
                supplier_name: newSupplier.supplier_name,
                contact_person: newSupplier.contact_person,
                phone: newSupplier.phone,
                contact_emails: newSupplier.contact_emails.filter(email => email.trim() !== ''),
                is_active: true
            };

            const createdSupplier = await base44.entities.Supplier.create(supplierData);

            setNewSupplier({
                supplier_name: '',
                contact_person: '',
                phone: '',
                contact_emails: ['']
            });
            setShowNewSupplierDialog(false);
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });

            if (editingService) {
                setEditingService(prev => ({
                    ...prev,
                    supplierIds: [...prev.supplierIds, createdSupplier.id],
                    supplierStatuses: { ...prev.supplierStatuses, [createdSupplier.id]: 'pending' }
                }));
            }

            alert("הספק נוצר בהצלחה");
        } catch (error) {
            console.error("Failed to create supplier:", error);
            alert("שגיאה ביצירת הספק");
        } finally {
            setIsSavingNewSupplier(false);
        }
    }, [newSupplier, queryClient, editingService]);

    const eventsByMonth = useMemo(() => {
        const yearStart = new Date(selectedYear, 0, 1);
        const yearEnd = new Date(selectedYear, 11, 31);

        let yearEvents = events.filter(event => {
            if (!event.event_date) return false;
            const eventDate = new Date(event.event_date);
            return eventDate >= yearStart && eventDate <= yearEnd;
        });

        if (searchTerm.trim()) {
            const search = searchTerm.toLowerCase();
            yearEvents = yearEvents.filter(event =>
                event.family_name?.toLowerCase().includes(search) ||
                event.event_name?.toLowerCase().includes(search) ||
                event.child_name?.toLowerCase().includes(search)
            );
        }

        if (statusFilters.length > 0) {
            yearEvents = yearEvents.filter(event => statusFilters.includes(event.status));
        }

        yearEvents.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

        const grouped = {};
        for (let month = 0; month < 12; month++) {
            const monthStart = startOfMonth(new Date(selectedYear, month));
            const monthEnd = endOfMonth(new Date(selectedYear, month));

            let monthEvents = yearEvents.filter(event => {
                const eventDate = new Date(event.event_date);
                return eventDate >= monthStart && eventDate <= monthEnd;
            });

            const currentMonth = currentDate.getMonth();
            const currentYear = currentDate.getFullYear();
            if (month === currentMonth && selectedYear === currentYear && hidePastEventsInCurrentMonth) {
                const today = startOfDay(new Date());
                monthEvents = monthEvents.filter(event => {
                    if (!event.event_date) return false;
                    const eventDate = startOfDay(new Date(event.event_date));
                    return !isBefore(eventDate, today);
                });
            }

            grouped[month] = monthEvents;
        }

        return grouped;
    }, [events, selectedYear, searchTerm, statusFilters, hidePastEventsInCurrentMonth, currentDate]);

    const getEventCategoryServices = (eventId, category) => {
        const categoryServiceIds = allServices
            .filter(s => s.category === category)
            .map(s => s.id);

        const categoryEventServices = eventServices.filter(
            es => es.event_id === eventId && categoryServiceIds.includes(es.service_id)
        );

        if (categoryEventServices.length === 0) return [];

        return categoryEventServices.map(es => {
            const service = allServices.find(s => s.id === es.service_id);

            let supplierIds = [];
            try {
                const parsed = JSON.parse(es.supplier_ids || '[]');
                supplierIds = Array.isArray(parsed) ? parsed : [];
            } catch {
                supplierIds = [];
            }

            let supplierStatuses = {};
            try {
                supplierStatuses = JSON.parse(es.supplier_statuses || '{}');
            } catch {
                supplierStatuses = {};
            }

            let supplierNotes = {};
            try {
                supplierNotes = JSON.parse(es.supplier_notes || '{}');
            } catch {
                supplierNotes = {};
            }

            const assignedSuppliers = supplierIds
                .map(supplierId => {
                    const supplier = suppliers.find(s => s.id === supplierId);
                    if (!supplier) return null;
                    return {
                        id: supplierId,
                        name: supplier.supplier_name,
                        status: supplierStatuses[supplierId] || 'pending',
                        notes: supplierNotes[supplierId] || ''
                    };
                })
                .filter(Boolean);

            return {
                serviceId: es.service_id,
                serviceName: service?.service_name || 'שירות לא ידוע',
                suppliers: assignedSuppliers,
                eventServiceData: es,
                minSuppliers: (es.min_suppliers !== undefined && es.min_suppliers !== null)
                    ? es.min_suppliers
                    : (service?.default_min_suppliers || 0)
            };
        });
    };

    const toggleMonth = (month) => {
        setCollapsedMonths(prev => ({
            ...prev,
            [month]: !prev[month]
        }));
    };

    const handleEditAssignment = useCallback((eventService, supplier, eventName, serviceName) => {
        setEditingAssignment({
            eventServiceId: eventService.id,
            supplierId: supplier.id,
            supplierName: supplier.name,
            currentStatus: supplier.status,
            currentNotes: supplier.notes,
            eventName,
            serviceName
        });
    }, []);

    const handleSaveAssignment = useCallback(async () => {
        if (!editingAssignment) return;

        setIsSaving(true);
        try {
            const eventService = eventServices.find(es => es.id === editingAssignment.eventServiceId);
            if (!eventService) return;

            let supplierStatuses = {};
            let supplierNotes = {};

            try {
                supplierStatuses = JSON.parse(eventService.supplier_statuses || '{}');
                supplierNotes = JSON.parse(eventService.supplier_notes || '{}');
            } catch (e) {
                console.error('Error parsing supplier data:', e);
            }

            supplierStatuses[editingAssignment.supplierId] = editingAssignment.currentStatus;
            supplierNotes[editingAssignment.supplierId] = editingAssignment.currentNotes;

            await base44.entities.EventService.update(editingAssignment.eventServiceId, {
                supplier_statuses: JSON.stringify(supplierStatuses),
                supplier_notes: JSON.stringify(supplierNotes)
            });

            await base44.functions.invoke('checkEventStatus', { eventId: eventService.event_id }).catch(console.error);
            queryClient.invalidateQueries({ queryKey: ['eventServices'] });
            setEditingAssignment(null);
        } catch (error) {
            console.error('Failed to save assignment:', error);
            alert('שגיאה בשמירת השיבוץ');
        } finally {
            setIsSaving(false);
        }
    }, [editingAssignment, eventServices, queryClient]);

    const handleOpenServiceEdit = useCallback((eventServiceData, eventName, category) => {
        const service = allServices.find(s => s.id === eventServiceData.service_id);

        let supplierIds = [];
        let supplierStatuses = {};
        let supplierNotes = {};

        try {
            supplierIds = JSON.parse(eventServiceData.supplier_ids || '[]');
            supplierStatuses = JSON.parse(eventServiceData.supplier_statuses || '{}');
            supplierNotes = JSON.parse(eventServiceData.supplier_notes || '{}');
        } catch (e) {
            console.error('Error parsing supplier data:', e);
        }

        let units = [];
        try {
            const parsedTransport = JSON.parse(eventServiceData.pickup_point);
            units = Array.isArray(parsedTransport) ? parsedTransport : [];
        } catch (e) {
            units = [{
                pickupPoints: [{
                    time: eventServiceData.standing_time || '',
                    location: eventServiceData.pickup_point || '',
                    contact: eventServiceData.on_site_contact_details || { name: '', phone: '' }
                }]
            }];
        }

        const quantity = eventServiceData.quantity || 1;
        if (units.length < quantity) {
            while (units.length < quantity) {
                units.push({ pickupPoints: [{ time: '', location: '', contact: { name: '', phone: '' } }] });
            }
        }

        setEditingService({
            eventServiceId: eventServiceData.id,
            eventName,
            serviceName: service?.service_name || 'שירות לא ידוע',
            category,
            supplierIds,
            supplierStatuses,
            supplierNotes,
            serviceNotes: eventServiceData.client_notes || '',
            units: units,
            minSuppliers: (eventServiceData.min_suppliers !== undefined && eventServiceData.min_suppliers !== null)
                ? eventServiceData.min_suppliers
                : (service?.default_min_suppliers || 0)
        });
        setActiveTab('assignment');
    }, [allServices]);

    const handleSaveService = useCallback(async () => {
        if (!editingService) return;

        setIsSaving(true);
        try {
            const currentEventService = eventServices.find(es => es.id === editingService.eventServiceId);
            if (!currentEventService) {
                alert('השירות לא נמצא - ייתכן שהוא נמחק. הרשימה תתרענן.');
                queryClient.invalidateQueries({ queryKey: ['eventServices'] });
                setEditingService(null);
                setIsSaving(false);
                return;
            }

            await base44.entities.EventService.update(editingService.eventServiceId, {
                supplier_ids: JSON.stringify(editingService.supplierIds),
                supplier_statuses: JSON.stringify(editingService.supplierStatuses),
                supplier_notes: JSON.stringify(editingService.supplierNotes),
                client_notes: editingService.serviceNotes,
                pickup_point: JSON.stringify(editingService.units),
                standing_time: editingService.units[0]?.pickupPoints[0]?.time || '', 
                on_site_contact_details: editingService.units[0]?.pickupPoints[0]?.contact || { name: '', phone: '' }, 
                min_suppliers: parseInt(editingService.minSuppliers) || 0
            });

            await base44.functions.invoke('checkEventStatus', { eventId: events.find(e => e.event_name === editingService.eventName)?.id }).catch(console.error);
            queryClient.invalidateQueries({ queryKey: ['eventServices'] });
            setEditingService(null);
        } catch (error) {
            console.error('Failed to save service:', error);
            alert('שגיאה בשמירת השירות');
        } finally {
            setIsSaving(false);
        }
    }, [editingService, queryClient, eventServices]);

    const handleToggleSupplier = useCallback((supplierId) => {
        setEditingService(prev => {
            if (!prev) return prev;

            const newSupplierIds = prev.supplierIds.includes(supplierId)
                ? prev.supplierIds.filter(id => id !== supplierId)
                : [...prev.supplierIds, supplierId];

            const newStatuses = { ...prev.supplierStatuses };
            const newNotes = { ...prev.supplierNotes };

            if (!prev.supplierIds.includes(supplierId)) {
                newStatuses[supplierId] = 'pending';
            } else {
                delete newStatuses[supplierId];
                delete newNotes[supplierId];
            }

            return {
                ...prev,
                supplierIds: newSupplierIds,
                supplierStatuses: newStatuses,
                supplierNotes: newNotes
            };
        });
    }, []);

    const filteredSuppliersInDialog = useMemo(() => {
        return suppliers.filter(supplier =>
            supplier.supplier_name.toLowerCase().includes(supplierSearchInDialog.toLowerCase())
        );
    }, [suppliers, supplierSearchInDialog]);

    const handleEventClick = useCallback((eventId) => {
        navigate(createPageUrl(`EventDetails?id=${eventId}`));
    }, [navigate]);

    const handleCopyTransportDetails = useCallback((service, event) => {
        const date = format(new Date(event.event_date), 'dd/MM/yyyy');
        const eventLocation = event.location || '';
        const serviceName = service.serviceName;

        let units = [];
        try {
            units = JSON.parse(service.eventServiceData.pickup_point);
            if (!Array.isArray(units)) throw new Error();
        } catch {
            units = [{
                pickupPoints: [{
                    time: service.eventServiceData.standing_time || '',
                    location: service.eventServiceData.pickup_point || '',
                    contact: service.eventServiceData.on_site_contact_details || { name: '', phone: '' }
                }]
            }];
        }

        let fullText = "";

        units.forEach((unit, uIdx) => {
            if (fullText) fullText += "\n\n";
            if (units.length > 1) fullText += `--- רכב ${uIdx + 1} ---\n`;

            unit.pickupPoints.forEach((point, pIdx) => {
                const time = point.time || '';
                const loc = point.location || '';
                const cName = point.contact?.name || '';
                const cPhone = point.contact?.phone || '';

                if (pIdx === 0) {
                    fullText += `${date}`;
                    if (time) fullText += ` בשעה ${time}`;
                    fullText += ` ${serviceName}`;
                    if (loc) fullText += ` מ${loc}`;
                    if (eventLocation) fullText += ` ל${eventLocation}`;
                    if (cName) fullText += `. איש קשר: ${cName}${cPhone ? ' ' + cPhone : ''}`;
                } else {
                    fullText += `\nנקודת איסוף נוספת:`;
                    if (time) fullText += ` בשעה ${time}`;
                    if (loc) fullText += ` ב${loc},`;
                    if (cName) fullText += ` איש קשר במקום: ${cName}${cPhone ? ' ' + cPhone : ''}`;
                }
            });
        });

        navigator.clipboard.writeText(fullText).then(() => {
            setCopiedId(service.eventServiceData.id);
            setTimeout(() => setCopiedId(null), 2000); 
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    }, []);

    const getStatusColor = (status) => {
        switch (status) {
            case 'confirmed': return 'bg-green-100 text-green-800';
            case 'pending': return 'bg-yellow-100 text-yellow-800';
            case 'rejected': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const toggleAllMonths = useCallback(() => {
        const allCollapsed = Object.keys(collapsedMonths).length === 12 && Object.values(collapsedMonths).every(v => v === true);
        if (allCollapsed) {
            setCollapsedMonths({});
        } else {
            const allCollapsedState = {};
            for (let i = 0; i < 12; i++) {
                allCollapsedState[i] = true;
            }
            setCollapsedMonths(allCollapsedState);
        }
    }, [collapsedMonths]);

    const handleWheel = useCallback((e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            setZoomLevel(prev => {
                const delta = e.deltaY > 0 ? -0.05 : 0.05;
                const newZoom = prev + delta;
                return Math.min(Math.max(newZoom, 0.6), 1.5);
            });
        }
    }, []);

    if (boardColumns.length === 0) {
        return (
            <div className="text-center py-16">
                <Settings className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">לא נבחרו עמודות ללוח</h3>
                <p className="text-gray-600 mb-4">
                    עבור לעמוד ההגדרות כדי לבחור אילו שירותים יוצגו כעמודות בלוח האירועים
                </p>
            </div>
        );
    }

    return (
        <div className="w-full max-w-full min-w-0 overflow-x-hidden space-y-4" onWheel={handleWheel}>
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4 max-w-full">
                <div className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1 w-full">
                        <Label className="text-xs text-gray-600 mb-1">חיפוש</Label>
                        <Input
                            placeholder="חיפוש לפי שם משפחה, אירוע או ילד..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="text-sm"
                        />
                    </div>
                    <div className="flex items-end">
                        <div className="flex flex-col gap-1">
                            <Label className="text-xs text-gray-600">הגדרות</Label>
                            <Button variant="outline" onClick={() => setIsSettingsOpen(true)} className="h-10 px-3">
                                <Settings className="h-4 w-4 ml-2" />
                                ניהול לוח
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader><DialogTitle>הגדרות לוח אירועים</DialogTitle></DialogHeader>
                    <div className="space-y-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex flex-col gap-2 p-3 bg-gray-50 rounded-lg border">
                                <Label htmlFor="sticky-mode" className="font-semibold flex items-center gap-2"><Table2 className="h-4 w-4" />הקפאת עמודות</Label>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-600">הקפא את עמודות התאריך והשם בגלילה</span>
                                    <Switch id="sticky-mode" checked={isStickyEnabled} onCheckedChange={setIsStickyEnabled} />
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 p-3 bg-gray-50 rounded-lg border">
                                <Label className="font-semibold flex items-center gap-2"><Filter className="h-4 w-4" />סינון לפי סטטוס</Label>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className="w-full justify-between text-right font-normal bg-white">
                                            <span>{statusFilters.length === 0 ? "כל הסטטוסים" : `נבחרו ${statusFilters.length} סטטוסים`}</span>
                                            <ChevronDown className="h-4 w-4 opacity-50" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="w-[240px]" align="end">
                                        <DropdownMenuLabel>בחר סטטוסים להצגה</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {[{ value: 'quote', label: 'הצעת מחיר' }, { value: 'confirmed', label: 'אירוע סגור' }, { value: 'in_progress', label: 'אירוע תפור' }, { value: 'completed', label: 'אירוע עבר' }, { value: 'cancelled', label: 'אירוע בוטל' }].map((status) => (
                                            <div key={status.value} className="flex items-center px-2 py-1.5 hover:bg-gray-100 cursor-pointer" onClick={(e) => {
                                                e.preventDefault();
                                                setStatusFilters(prev => prev.includes(status.value) ? prev.filter(s => s !== status.value) : [...prev, status.value]);
                                            }}>
                                                <Checkbox id={`status-${status.value}`} checked={statusFilters.includes(status.value)} className="ml-2" />
                                                <span className="text-sm">{status.label}</span>
                                            </div>
                                        ))}
                                        {statusFilters.length > 0 && (
                                            <><DropdownMenuSeparator /><div className="p-2 text-center text-xs text-red-600 cursor-pointer hover:bg-red-50" onClick={() => setStatusFilters([])}>נקה הכל</div></>
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                        <div>
                            <Label className="mb-3 block font-semibold">קטגוריות להצגה</Label>
                            {availableCategories.length === 0 ? (<p className="text-sm text-gray-400 py-4 bg-gray-50 rounded text-center">לא נמצאו קטגוריות.</p>) : (
                                <><div className="mb-4 p-4 bg-gray-50 rounded-lg border"><div className="flex flex-wrap gap-2">{availableCategories.filter(cat => !tempCategories.includes(cat)).map(category => (<Badge key={category} variant="outline" className="cursor-pointer hover:bg-blue-50 transition-colors px-3 py-1.5 text-sm bg-white" onClick={() => toggleCategory(category)}><Plus className="h-3 w-3 mr-1" />{category}</Badge>))}</div></div>
                                    {tempCategories.length > 0 && (<div className="p-4 bg-blue-50/50 rounded-lg border border-blue-100"><DragDropContext onDragEnd={handleDragEnd}><Droppable droppableId="categories">{(provided) => (<div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">{tempCategories.map((category, index) => (<Draggable key={category} draggableId={category} index={index}>{(provided, snapshot) => (<div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className={`flex items-center gap-3 p-3 bg-white rounded-lg border transition-all ${snapshot.isDragging ? 'shadow-lg border-blue-400 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'}`}><GripVertical className="h-5 w-5 text-gray-400 cursor-grab" /><span className="flex-1 font-medium">{category}</span><Badge variant="secondary" className="text-xs">{index + 1}</Badge><button onClick={() => toggleCategory(category)} className="p-1.5 hover:bg-red-50 rounded-full transition-colors text-gray-400 hover:text-red-500"><X className="h-4 w-4" /></button></div>)}</Draggable>))}{provided.placeholder}</div>)}</Droppable></DragDropContext></div>)}
                                </>
                            )}
                        </div>
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setIsSettingsOpen(false)} disabled={isSavingSettings}>ביטול</Button><Button onClick={handleSaveBoardSettings} disabled={isSavingSettings} className="bg-red-800 hover:bg-red-700">{isSavingSettings ? (<Loader2 className="h-4 w-4 ml-2 animate-spin" />) : (<Save className="h-4 w-4 ml-2" />)}שמור הגדרות</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="flex items-center justify-between bg-gradient-to-l from-red-50 to-white p-4 rounded-xl shadow-md border border-red-100 max-w-full">
                <Button variant="outline" size="sm" onClick={toggleAllMonths} className="border-gray-300 text-gray-700 hover:bg-gray-50">{Object.values(collapsedMonths).filter(v => v === true).length === 12 ? 'פתח הכל' : 'סגור הכל'}</Button>
                <div className="flex items-center gap-4"><Button variant="outline" size="sm" onClick={() => setSelectedYear(selectedYear - 1)} className="border-red-300 text-red-700 hover:bg-red-50">← {selectedYear - 1}</Button><h2 className="text-2xl font-bold text-red-800 px-4">{selectedYear}</h2><Button variant="outline" size="sm" onClick={() => setSelectedYear(selectedYear + 1)} className="border-red-300 text-red-700 hover:bg-red-50">{selectedYear + 1} →</Button></div>
                <div className="text-xs text-gray-500">Ctrl + גלגלת = זום</div>
            </div>

            {eventsLoading ? (
                <div className="flex justify-center items-center py-16"><Loader2 className="h-8 w-8 animate-spin text-red-800" /></div>
            ) : (
                <div className="space-y-3 max-w-full">
                    {Array.from({ length: 12 }, (_, monthIndex) => {
                        const monthEvents = eventsByMonth[monthIndex] || [];
                        const isCollapsed = collapsedMonths[monthIndex];
                        const monthName = format(new Date(2024, monthIndex, 1), 'MMMM', { locale: he });
                        const isCurrentMonth = monthIndex === currentDate.getMonth() && selectedYear === currentDate.getFullYear();

                        return (
                            <div key={monthIndex} className="bg-white rounded-xl shadow-lg border-2 border-gray-100 hover:shadow-xl transition-shadow duration-200 w-full max-w-full min-w-0 overflow-hidden">
                                <div className="w-full flex items-center px-6 py-3 bg-gradient-to-l from-red-800 to-red-700 text-white rounded-t-xl cursor-pointer select-none" onClick={() => toggleMonth(monthIndex)}>
                                    <div className="flex items-center gap-3 ml-auto"><span className="text-base font-bold">{monthName} {String(monthIndex + 1).padStart(2, '0')}</span><span className="text-xs bg-white/25 px-3 py-1 rounded-full font-medium">{monthEvents.length}</span>
                                        {isCurrentMonth && (<Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setHidePastEventsInCurrentMonth(!hidePastEventsInCurrentMonth); }} className="text-white hover:bg-white/20 text-xs mr-4">{hidePastEventsInCurrentMonth ? 'הצג אירועי עבר' : 'הסתר אירועי עבר'}</Button>)}
                                    </div>
                                    <div className="flex items-center gap-3">{isCollapsed ? (<ChevronDown className="h-5 w-5" />) : (<ChevronUp className="h-5 w-5" />)}</div>
                                </div>

                                {!isCollapsed && (
                                    monthEvents.length === 0 ? (
                                        <div className="p-8 text-center text-gray-400 text-sm bg-gray-50"><div className="inline-block px-4 py-2 rounded-lg bg-white border border-gray-200">אין אירועים לחודש זה</div></div>
                                    ) : (
                                        <div className="relative w-full border-t border-gray-100" style={{ maxWidth: '100vw' }}>
                                            <div className="overflow-x-auto overflow-y-auto max-h-[70vh]" style={{ scrollbarWidth: 'thin', scrollbarColor: '#e53e3e #fee2e2', direction: 'rtl', maxWidth: 'calc(100vw - 3rem)' }}>
                                                <table className="border-collapse" style={{ minWidth: 'max-content', borderSpacing: 0, zoom: zoomLevel }}>
                                                    <thead className="bg-gradient-to-b from-red-50 via-red-50 to-red-100/50 border-b-2 border-red-200 sticky top-0 z-30">
                                                        <tr>
                                                            <th className={`px-4 py-3 text-right text-xs font-bold text-red-900 border-l border-red-200 bg-red-50 w-[80px] ${isStickyEnabled ? 'sticky right-0 z-40 shadow-[2px_0_8px_-2px_rgba(185,28,28,0.15)]' : ''}`}>תאריך</th>
                                                            <th className={`px-4 py-3 text-right text-xs font-bold text-red-900 border-l border-red-200 bg-red-50 w-[140px] ${isStickyEnabled ? 'sticky right-[80px] z-40 shadow-[2px_0_8px_-2px_rgba(185,28,28,0.15)]' : ''}`}>משפחה</th>
                                                            {boardColumns.map(category => (<th key={category} className="px-4 py-3 text-center text-xs font-bold text-red-900 border-l border-red-200 min-w-[200px] bg-gradient-to-b from-red-50 via-red-50 to-red-100/50">{category}</th>))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {monthEvents.map((event, idx) => (
                                                            <tr key={event.id} className={`border-b border-gray-100 hover:bg-red-50/30 transition-all duration-200 ${event.status === 'in_progress' ? 'bg-green-50/40 hover:bg-green-100/50 border-r-4 border-r-green-400' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                                                                <td onClick={() => handleEventClick(event.id)} className={`px-4 py-3 text-sm font-semibold text-gray-900 border-l border-gray-100 whitespace-nowrap cursor-pointer hover:text-red-700 hover:bg-red-50/50 transition-all ${isStickyEnabled ? 'sticky right-0 z-20 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]' : ''}`} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>{format(new Date(event.event_date), 'dd/MM')}</td>
                                                                <td onClick={() => handleEventClick(event.id)} className={`px-4 py-3 text-sm font-bold text-gray-900 border-l border-gray-100 cursor-pointer hover:text-red-700 hover:bg-red-50/50 transition-all ${isStickyEnabled ? 'sticky right-[80px] z-20 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]' : ''}`} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}><div className="flex flex-col gap-0.5"><span className="hover:underline">{event.family_name}</span>{event.event_time && (<span className="text-xs text-gray-500 font-normal">{event.event_time}</span>)}{event.location && (<span className="text-xs text-gray-500 font-normal">{event.location}</span>)}{event.concept && (<span className="text-xs text-gray-500 font-normal text-red-600">{event.concept}</span>)}</div></td>
                                                                {boardColumns.map(category => {
                                                                    const categoryServices = getEventCategoryServices(event.id, category);
                                                                    return (
                                                                        <td key={category} className="px-3 py-3 border-l border-gray-100 align-top" style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                                                                            {categoryServices.length === 0 ? (<div className="text-xs text-gray-300 text-center py-3">-</div>) : (
                                                                                <div className="space-y-2">
                                                                                    {categoryServices.map(service => {
                                                                                        const required = service.minSuppliers !== undefined ? service.minSuppliers : 0;
                                                                                        const missingCount = Math.max(0, required - service.suppliers.length);
                                                                                        return (
                                                                                            <div key={service.serviceId} className="bg-white rounded-lg border border-gray-200 p-2.5 hover:border-red-300 hover:shadow-md transition-all">
                                                                                                
                                                                                                {/* חלוקת הכותרת והאייקונים - תיקון בעיית הכפתורים המקוננים */}
                                                                                                <div className="flex items-center justify-between mb-2">
                                                                                                    <button onClick={() => handleOpenServiceEdit(service.eventServiceData, event.event_name, category)} className="text-xs font-bold text-gray-900 hover:text-red-700 transition-colors text-right flex-1">{service.serviceName}</button>
                                                                                                    <div className="flex items-center gap-1 shrink-0 mr-2">
                                                                                                        {category === 'נסיעות' && (
                                                                                                            <button onClick={(e) => { e.stopPropagation(); handleCopyTransportDetails(service, event); }} className="p-1 hover:bg-gray-100 rounded" title="העתק פרטי נסיעה">
                                                                                                                {copiedId === service.eventServiceData.id ? (<Check className="h-3.5 w-3.5 text-green-600 animate-in zoom-in" />) : (<Copy className="h-3.5 w-3.5 text-gray-400 hover:text-blue-600 transition-colors" />)}
                                                                                                            </button>
                                                                                                        )}
                                                                                                        <button onClick={() => handleOpenServiceEdit(service.eventServiceData, event.event_name, category)} className="p-1 hover:bg-gray-100 rounded"><Edit className="h-3.5 w-3.5 text-gray-400 hover:text-red-600 transition-colors" /></button>
                                                                                                    </div>
                                                                                                </div>

                                                                                                {/* תצוגת נתוני נסיעה בתוך הריבוע בלוח */}
                                                                                                {category === 'נסיעות' && (() => {
                                                                                                    let displayUnits = [];
                                                                                                    try {
                                                                                                        displayUnits = JSON.parse(service.eventServiceData.pickup_point);
                                                                                                        if (!Array.isArray(displayUnits)) throw new Error();
                                                                                                    } catch {
                                                                                                        displayUnits = [{ pickupPoints: [{ time: service.eventServiceData.standing_time, location: service.eventServiceData.pickup_point, contact: service.eventServiceData.on_site_contact_details }] }];
                                                                                                    }
                                                                                                    
                                                                                                    const hasData = displayUnits.some(u => u.pickupPoints.some(p => p.time || p.location));
                                                                                                    if (!hasData) return null;

                                                                                                    return (
                                                                                                        <div className="text-[10px] text-indigo-800 px-2 py-1.5 bg-indigo-50 rounded-md mt-1 border-r-2 border-indigo-400 space-y-1.5 max-w-[180px]">
                                                                                                            {displayUnits.map((unit, uIdx) => (
                                                                                                                <div key={uIdx} className={uIdx > 0 ? "pt-1 border-t border-indigo-200" : ""}>
                                                                                                                    {displayUnits.length > 1 && <div className="font-bold underline mb-0.5">רכב {uIdx + 1}:</div>}
                                                                                                                    {unit.pickupPoints.map((point, pIdx) => (
                                                                                                                        <div key={pIdx} className="leading-tight">
                                                                                                                            {point.time && <span className="font-semibold">{point.time} </span>}
                                                                                                                            {point.location && <span>מ{point.location} </span>}
                                                                                                                        </div>
                                                                                                                    ))}
                                                                                                                </div>
                                                                                                            ))}
                                                                                                        </div>
                                                                                                    );
                                                                                                })()}

                                                                                                {service.suppliers.length === 0 && missingCount === 0 ? (<div className="text-xs text-gray-400 italic text-center py-2 bg-gray-50 rounded-md border border-gray-100">לא נדרש שיבוץ</div>) : null}
                                                                                                {missingCount > 0 && (<div className="flex items-center gap-1 mb-1.5 px-1 bg-amber-50 rounded border border-amber-100 py-1" title="נדרש שיבוץ"><UserPlus className="h-3.5 w-3.5 text-amber-600" /><span className="text-[10px] text-amber-700 font-medium">חסרים {missingCount}</span></div>)}
                                                                                                {service.suppliers.length > 0 ? (<div className="space-y-1.5">{service.suppliers.map(supplier => (<div key={supplier.id} className="space-y-1"><button onClick={() => handleEditAssignment(service.eventServiceData, supplier, event.event_name, service.serviceName)} className={`w-full text-xs px-2.5 py-2 rounded-md text-center transition-all hover:scale-[1.03] hover:shadow-md font-semibold ${getStatusColor(supplier.status)}`}>{supplier.name}</button>{supplier.notes && (<div className="text-xs text-amber-800 px-2 py-1 bg-amber-50 rounded-md border-r-2 border-amber-400">{supplier.notes}</div>)}</div>))}</div>) : null}
                                                                                                {service.eventServiceData.client_notes && (<div className="text-xs text-blue-800 px-2 py-1.5 bg-blue-50 rounded-md mt-2 border-r-2 border-blue-400">📌 {service.eventServiceData.client_notes}</div>)}
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                        </td>
                                                                    );
                                                                })}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {editingAssignment && (
                <Dialog open={!!editingAssignment} onOpenChange={() => setEditingAssignment(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>עריכת שיבוץ ספק</DialogTitle></DialogHeader><div className="space-y-4 py-4"><div className="space-y-2 bg-gray-50 p-3 rounded-lg"><div className="text-sm text-gray-700"><span className="font-semibold">אירוע:</span> {editingAssignment.eventName}</div><div className="text-sm text-gray-700"><span className="font-semibold">שירות:</span> {editingAssignment.serviceName}</div><div className="text-sm text-gray-700"><span className="font-semibold">ספק:</span> {editingAssignment.supplierName}</div></div><div className="space-y-2"><Label htmlFor="status">סטטוס שיבוץ</Label><Select value={editingAssignment.currentStatus} onValueChange={(value) => setEditingAssignment(prev => ({ ...prev, currentStatus: value }))}><SelectTrigger id="status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending"><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-yellow-400"></div><span>ממתין לאישור</span></div></SelectItem><SelectItem value="confirmed"><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-green-500"></div><span>אושר</span></div></SelectItem><SelectItem value="rejected"><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500"></div><span>נדחה</span></div></SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="notes">הערות שיבוץ</Label><Textarea id="notes" value={editingAssignment.currentNotes} onChange={(e) => setEditingAssignment(prev => ({ ...prev, currentNotes: e.target.value }))} placeholder="הוסף הערות לשיבוץ זה..." rows={4} className="resize-none" /></div></div><DialogFooter><Button variant="outline" onClick={() => setEditingAssignment(null)} disabled={isSaving}><X className="h-4 w-4 ml-2" />ביטול</Button><Button onClick={handleSaveAssignment} disabled={isSaving} className="bg-red-800 hover:bg-red-700">{isSaving ? (<Loader2 className="h-4 w-4 ml-2 animate-spin" />) : (<Save className="h-4 w-4 ml-2" />)}שמור שינויים</Button></DialogFooter></DialogContent></Dialog>
            )}

            <Dialog open={showNewSupplierDialog} onOpenChange={setShowNewSupplierDialog}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>יצירת ספק חדש</DialogTitle></DialogHeader><div className="space-y-4"><div className="flex items-end gap-2"><div className="flex-1"><Label>שם הספק</Label><Input value={newSupplier.supplier_name} onChange={(e) => setNewSupplier(prev => ({ ...prev, supplier_name: e.target.value }))} placeholder="שם הספק" /></div><ContactPicker onContactSelect={(contactData) => { setNewSupplier(prev => ({ ...prev, supplier_name: contactData.name || prev.supplier_name, contact_person: contactData.name || prev.contact_person, phone: contactData.phone || prev.phone, contact_emails: contactData.email ? [contactData.email] : prev.contact_emails })); }} className="mb-1" /></div><div><Label>איש קשר</Label><Input value={newSupplier.contact_person} onChange={(e) => setNewSupplier(prev => ({ ...prev, contact_person: e.target.value }))} placeholder="שם איש הקשר" /></div><div><Label>טלפון</Label><Input value={newSupplier.phone} onChange={(e) => setNewSupplier(prev => ({ ...prev, phone: e.target.value }))} placeholder="מספר טלפון" /></div><div><Label>אימייל</Label><Input type="email" value={newSupplier.contact_emails[0]} onChange={(e) => setNewSupplier(prev => ({ ...prev, contact_emails: [e.target.value] }))} placeholder="כתובת אימייל" /></div></div><DialogFooter><Button variant="outline" onClick={() => setShowNewSupplierDialog(false)} disabled={isSavingNewSupplier}>ביטול</Button><Button onClick={handleCreateSupplier} disabled={isSavingNewSupplier} className="bg-red-800 hover:bg-red-700">{isSavingNewSupplier ? (<><Loader2 className="h-4 w-4 ml-2 animate-spin" />שומר...</>) : ('צור ספק')}</Button></DialogFooter></DialogContent></Dialog>

            {editingService && (
    <Dialog open={!!editingService} onOpenChange={() => setEditingService(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>ניהול שירות ופרטי נסיעה</DialogTitle></DialogHeader>
            <div className="flex border-b mb-4">
                <button onClick={() => setActiveTab('assignment')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'assignment' ? 'border-red-800 text-red-800' : 'border-transparent text-gray-500'}`}>ניהול שיבוץ</button>
                {editingService.category === 'נסיעות' && (
                    <button onClick={() => setActiveTab('transport')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'transport' ? 'border-red-800 text-red-800' : 'border-transparent text-gray-500'}`}>פרטי נסיעה</button>
                )}
            </div>
            <div className="space-y-4 py-2">
                {activeTab === 'assignment' ? (
                    <>
                        <div className="space-y-2 bg-gray-50 p-3 rounded-lg"><div className="text-sm text-gray-700"><span className="font-semibold">אירוע:</span> {editingService.eventName}</div><div className="text-sm text-gray-700"><span className="font-semibold">שירות:</span> {editingService.serviceName}</div></div>
                        <div className="space-y-2"><Label>שיבוצים נדרשים</Label><Select value={String(editingService.minSuppliers || 0)} onValueChange={(v) => setEditingService(p => ({ ...p, minSuppliers: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (<SelectItem key={n} value={String(n)}>{n}</SelectItem>))}</SelectContent></Select></div>
                        <div className="space-y-2"><Label>הערות לשירות</Label><Textarea value={editingService.serviceNotes} onChange={(e) => setEditingService(p => ({ ...p, serviceNotes: e.target.value }))} className="resize-none" /></div>
                        <div className="border-t pt-4">
                            <Label className="font-semibold mb-3 block">שיבוץ ספקים</Label>
                            
                            <div className="flex gap-2 mb-3">
                                <div className="relative flex-1">
                                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
                                    <Input 
                                        placeholder="חיפוש ספקים..." 
                                        value={supplierSearchInDialog} 
                                        onChange={(e) => setSupplierSearchInDialog(e.target.value)}
                                        className="pr-9 h-9"
                                    />
                                </div>
                                <Button size="icon" className="h-9 w-9" onClick={() => setShowNewSupplierDialog(true)} title="צור ספק חדש">
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
                                {/* Assigned Suppliers */}
                                {suppliers.filter(s => editingService.supplierIds.includes(s.id)).length > 0 && (
                                    <div className="space-y-2">
                                        <Label className="text-xs text-gray-500 font-medium">ספקים משובצים</Label>
                                        {suppliers.filter(s => editingService.supplierIds.includes(s.id)).map(s => {
                                            const supplierStatus = editingService.supplierStatuses[s.id] || 'pending';
                                            const statusBg = supplierStatus === 'confirmed' ? 'bg-green-50 border-green-200' : supplierStatus === 'rejected' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200';
                                            const statusTextColor = supplierStatus === 'confirmed' ? 'text-green-900' : supplierStatus === 'rejected' ? 'text-red-900' : 'text-yellow-900';
                                            return (
                                                <div key={s.id} className={`p-2 rounded-lg border ${statusBg} flex items-center justify-between group`}>
                                                    <div className={`text-sm font-medium ${statusTextColor}`}>{s.supplier_name}</div>
                                                    <div className="flex items-center gap-1">
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <button className={`text-[10px] px-2 py-0.5 rounded-md font-semibold ${getStatusColor(supplierStatus)}`}>
                                                                    {supplierStatus === 'confirmed' ? 'אושר' : supplierStatus === 'rejected' ? 'נדחה' : 'בהמתנה'}
                                                                </button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent>
                                                                <DropdownMenuItem onClick={() => setEditingService(p => ({ ...p, supplierStatuses: { ...p.supplierStatuses, [s.id]: 'pending' } }))}>בהמתנה</DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => setEditingService(p => ({ ...p, supplierStatuses: { ...p.supplierStatuses, [s.id]: 'confirmed' } }))}>אושר</DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => setEditingService(p => ({ ...p, supplierStatuses: { ...p.supplierStatuses, [s.id]: 'rejected' } }))}>נדחה</DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                        <button onClick={() => handleToggleSupplier(s.id)} className="p-1 hover:bg-red-100 text-red-500 rounded-full transition-colors" title="הסר שיבוץ">
                                                            <X className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="mt-1">
                                                    <Input
                                                        placeholder="הערה לספק..."
                                                        value={editingService.supplierNotes[s.id] || ''}
                                                        onChange={(e) => setEditingService(p => ({ ...p, supplierNotes: { ...p.supplierNotes, [s.id]: e.target.value } }))}
                                                        className="text-xs h-7"
                                                    />
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Available Suppliers */}
                                <div className="space-y-2">
                                    <Label className="text-xs text-gray-500 font-medium">ספקים זמינים</Label>
                                    {filteredSuppliersInDialog.filter(s => !editingService.supplierIds.includes(s.id)).length === 0 ? (
                                        <div className="text-sm text-gray-400 italic text-center py-4 border border-dashed rounded-lg">לא נמצאו ספקים</div>
                                    ) : (
                                        filteredSuppliersInDialog.filter(s => !editingService.supplierIds.includes(s.id)).map(s => (
                                            <div key={s.id} className="p-2 rounded-lg border bg-white flex items-center gap-3 hover:bg-gray-50 transition-colors">
                                                <Checkbox id={`sup-${s.id}`} checked={false} onCheckedChange={() => handleToggleSupplier(s.id)} />
                                                <Label htmlFor={`sup-${s.id}`} className="text-sm cursor-pointer flex-1 py-1">{s.supplier_name}</Label>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="space-y-6">
                        {editingService.units.map((unit, uIdx) => (
                            <div key={uIdx} className="p-4 border-2 border-red-100 rounded-xl bg-red-50/20 space-y-4">
                                <h3 className="font-bold text-red-900">{editingService.units.length > 1 ? `רכב ${uIdx + 1}` : 'פרטי נסיעה'}</h3>
                                {unit.pickupPoints.map((point, pIdx) => (
                                    <div key={pIdx} className="bg-white p-3 rounded-lg border shadow-sm space-y-3">
                                        <div className="flex justify-between items-center"><Label className="text-xs font-bold text-gray-500">נקודת איסוף {pIdx + 1}</Label>{pIdx > 0 && <Button variant="ghost" size="sm" className="text-red-500" onClick={() => { const u = [...editingService.units]; u[uIdx].pickupPoints.splice(pIdx, 1); setEditingService(p => ({ ...p, units: u })); }}><Trash2 className="h-4 w-4" /></Button>}</div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1"><Label className="text-xs">התייצבות</Label><Input type="time" value={point.time} onChange={(e) => { const u = [...editingService.units]; u[uIdx].pickupPoints[pIdx].time = e.target.value; setEditingService(p => ({ ...p, units: u })); }} /></div>
                                            <div className="space-y-1"><Label className="text-xs">מקום איסוף</Label><Input value={point.location} onChange={(e) => { const u = [...editingService.units]; u[uIdx].pickupPoints[pIdx].location = e.target.value; setEditingService(p => ({ ...p, units: u })); }} /></div>
                                        </div>
                                        <div className="space-y-1"><Label className="text-xs">איש קשר במקום</Label><div className="flex gap-2">
                                            <Input placeholder="שם" value={point.contact?.name || ''} onChange={(e) => { const u = [...editingService.units]; u[uIdx].pickupPoints[pIdx].contact.name = e.target.value; setEditingService(p => ({ ...p, units: u })); }} />
                                            <Input placeholder="טלפון" value={point.contact?.phone || ''} onChange={(e) => { const u = [...editingService.units]; u[uIdx].pickupPoints[pIdx].contact.phone = e.target.value; setEditingService(p => ({ ...p, units: u })); }} />
                                            <ContactPicker onContactSelect={(c) => { const u = [...editingService.units]; u[uIdx].pickupPoints[pIdx].contact = { name: c.name || '', phone: c.phone || '' }; setEditingService(p => ({ ...p, units: u })); }} />
                                        </div></div>
                                    </div>
                                ))}
                                <Button variant="outline" size="sm" className="w-full border-dashed border-red-200 text-red-800" onClick={() => { const u = [...editingService.units]; u[uIdx].pickupPoints.push({ time: '', location: '', contact: { name: '', phone: '' } }); setEditingService(p => ({ ...p, units: u })); }}><Plus className="h-4 w-4 ml-1" />הוסף נקודת איסוף לרכב זה</Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setEditingService(null)}>ביטול</Button><Button onClick={handleSaveService} className="bg-red-800 hover:bg-red-700">{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 ml-2" />}שמור שינויים</Button></DialogFooter>
        </DialogContent>
    </Dialog>
)}
        </div>
    );
}