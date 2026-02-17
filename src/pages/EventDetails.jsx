import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { FileText, Loader2, Download, Trash2, Search, ChevronDown, Share2, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import EventOverviewCard from '../components/event-details/EventOverviewCard';
import FamilyContactCard from '../components/event-details/FamilyContactCard';
import ScheduleCard from '../components/event-details/ScheduleCard';
import ServicesCard from '../components/event-details/ServicesCard';
import PaymentsCard from '../components/event-details/PaymentsCard';
import FinancialSummaryCard from '../components/event-details/FinancialSummaryCard';
import { createPageUrl } from '@/utils';
import { calculateEventFinancials } from '@/components/utils/eventFinancials';

export default function EventDetails() {
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const eventId = urlParams.get('id');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [error, setError] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [eventDetailsData, setEventDetailsData] = useState({});
  const [editableParents, setEditableParents] = useState([]);
  const [editableFamilyName, setEditableFamilyName] = useState('');
  const [editableChildName, setEditableChildName] = useState('');
  const [financialEditData, setFinancialEditData] = useState({});
  const [editableServices, setEditableServices] = useState([]);
  const [allInclusiveData, setAllInclusiveData] = useState({});
  const [editableSchedule, setEditableSchedule] = useState([]);

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState({
    eventDetails: true,
    familyDetails: true,
    services: true,
    suppliers: true,
    payments: true,
    financials: true,
    notes: true
  });
  const [isGeneratingQuote, setIsGeneratingQuote] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [shareStatus, setShareStatus] = useState('initial');
  const [pdfBlob, setPdfBlob] = useState(null);
  const [pdfFileName, setPdfFileName] = useState("");
  const [quoteIncludeIntro, setQuoteIncludeIntro] = useState(null); // null = not initialized yet
  const [quoteIncludePaymentTerms, setQuoteIncludePaymentTerms] = useState(null);

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'cash',
    notes: '',
    receipt_image_url: ''
  });
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [selectedServiceForSupplier, setSelectedServiceForSupplier] = useState(null);
  const [supplierFormData, setSupplierFormData] = useState({ supplierIds: [], notes: {} });
  const [supplierSearchTerm, setSupplierSearchTerm] = useState("");
  const [debouncedSupplierSearch, setDebouncedSupplierSearch] = useState("");

  const [showPackageDialog, setShowPackageDialog] = useState(false);
  const [packageForm, setPackageForm] = useState({
    package_name: '',
    package_description: '',
    package_price: '',
    package_includes_vat: false,
    selectedServices: []
  });
  const [isCreatingPackage, setIsCreatingPackage] = useState(false);
  const [packageServiceSearchTerm, setPackageServiceSearchTerm] = useState("");
  const [debouncedPackageServiceSearch, setDebouncedPackageServiceSearch] = useState("");

  const [showAddToPackageDialog, setShowAddToPackageDialog] = useState(false);
  const [selectedServicesForPackage, setSelectedServicesForPackage] = useState([]);
  const [targetPackageId, setTargetPackageId] = useState('new');
  const [newPackageData, setNewPackageData] = useState({ name: '', description: '', price: '', includes_vat: false });
  const [saveGlobalPackage, setSaveGlobalPackage] = useState(false);

  const [showAddServiceToPackageDialog, setShowAddServiceToPackageDialog] = useState(false);
  const [targetPackageForService, setTargetPackageForService] = useState(null);
  const [availableServicesToAdd, setAvailableServicesToAdd] = useState([]);
  const [selectedServiceToAdd, setSelectedServiceToAdd] = useState([]);
  const [addToPackageSearchTerm, setAddToPackageSearchTerm] = useState("");
  const [debouncedAddToPackageSearch, setDebouncedAddToPackageSearch] = useState("");

  const [selectedServicesForAction, setSelectedServicesForAction] = useState([]);

  const [showAddServiceDialog, setShowAddServiceDialog] = useState(false);
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState([]);
  const [addServiceSearchTerm, setAddServiceSearchTerm] = useState("");
  const [debouncedAddServiceSearch, setDebouncedAddServiceSearch] = useState("");

  const [showAddExistingPackageDialog, setShowAddExistingPackageDialog] = useState(false);
  const [selectedExistingPackage, setSelectedExistingPackage] = useState(null);
  const [isAddingExistingPackage, setIsAddingExistingPackage] = useState(false);
  const [existingPackageSearchTerm, setExistingPackageSearchTerm] = useState("");
  const [debouncedExistingPackageSearch, setDebouncedExistingPackageSearch] = useState("");

  const [showEditPackageDialog, setShowEditPackageDialog] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [editPackageForm, setEditPackageForm] = useState({
    package_name: '',
    package_description: '',
    package_price: '',
    package_includes_vat: false
  });
  const [isSavingPackageEdit, setIsSavingPackageEdit] = useState(false);

  const [isSavingEventDetails, setIsSavingEventDetails] = useState(false);
  const [isSavingFamilyDetails, setIsSavingFamilyDetails] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [isSavingFinancial, setIsSavingFinancial] = useState(false);
  const [isSavingServices, setIsSavingServices] = useState(false);
  const [isAddingServices, setIsAddingServices] = useState(false);
  const [isAddingServicesToPackage, setIsAddingServicesToPackage] = useState(false);
  const [isAddingServiceToPackage, setIsAddingServiceToPackage] = useState(false);

  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [currentReceiptUrl, setCurrentReceiptUrl] = useState('');
  const [currentReceiptPaymentId, setCurrentReceiptPaymentId] = useState(null);

  const [editingServiceField, setEditingServiceField] = useState(null);
  const [savingServiceField, setSavingServiceField] = useState(null);

  // Debouncing effect for search terms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSupplierSearch(supplierSearchTerm), 300);
    return () => clearTimeout(timer);
  }, [supplierSearchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPackageServiceSearch(packageServiceSearchTerm), 300);
    return () => clearTimeout(timer);
  }, [packageServiceSearchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAddToPackageSearch(addToPackageSearchTerm), 300);
    return () => clearTimeout(timer);
  }, [addToPackageSearchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAddServiceSearch(addServiceSearchTerm), 300);
    return () => clearTimeout(timer);
  }, [addServiceSearchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedExistingPackageSearch(existingPackageSearchTerm), 300);
    return () => clearTimeout(timer);
  }, [existingPackageSearchTerm]);

  // React Query for user data
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  // React Query for static data
  const { data: appSettings = [] } = useQuery({
    queryKey: ['appSettings'],
    queryFn: () => base44.entities.AppSettings.list(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  const { data: allServices = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => base44.entities.Service.list(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  const { data: allSuppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.list(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  const { data: allPackages = [] } = useQuery({
    queryKey: ['packages'],
    queryFn: () => base44.entities.Package.list(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  const { data: quoteTemplates = [] } = useQuery({
    queryKey: ['quoteTemplates'],
    queryFn: () => base44.entities.QuoteTemplate.list(),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000
  });

  // React Query for event data
  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => base44.entities.Event.get(eventId),
    enabled: !!eventId,
    onError: () => setError("האירוע לא נמצא")
  });

  const { data: eventServices = [], isLoading: servicesLoading } = useQuery({
    queryKey: ['eventServices', eventId],
    queryFn: () => base44.entities.EventService.filter({ event_id: eventId }),
    enabled: !!eventId,
    select: (data) => data.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
  });

  const shouldLoadPayments = user?.role === 'admin' || user?.user_type === 'client';
  
  const { data: payments = [] } = useQuery({
    queryKey: ['payments', eventId],
    queryFn: () => base44.entities.Payment.filter({ event_id: eventId }),
    enabled: !!eventId && shouldLoadPayments
  });

  const loading = eventLoading || servicesLoading;

  const isAdmin = user?.role === 'admin';
  const isClient = user?.user_type === 'client';
  const isSupplier = user?.user_type === 'supplier';

  // Initialize quote options defaults when event loads
  useEffect(() => {
    if (event && quoteIncludeIntro === null) {
      // Intro default: show if event has a concept with a matching intro template
      const hasIntroTemplate = event.concept && quoteTemplates.some(t => t.template_type === 'concept_intro' && t.identifier === event.concept);
      setQuoteIncludeIntro(!!hasIntroTemplate);
    }
    if (event && quoteIncludePaymentTerms === null) {
      // Payment terms default: show only for 'quote' and 'cancelled' statuses
      const showPaymentTerms = ['quote', 'cancelled'].includes(event.status);
      setQuoteIncludePaymentTerms(showPaymentTerms);
    }
  }, [event, quoteTemplates]);

  // Initialize editable schedule when event loads
  useEffect(() => {
    if (event?.schedule) {
      setEditableSchedule([...(event.schedule || [])]);
    }
  }, [event]);

  // Initialize editable parents, family_name, child_name when event loads
  useEffect(() => {
    if (event) {
      setEditableParents(event.parents || []);
      setEditableFamilyName(event.family_name || '');
      setEditableChildName(event.child_name || '');
    }
  }, [event]);

  // Initialize editableServices when eventServices loads
  useEffect(() => {
    if (eventServices && eventServices.length > 0) {
      setEditableServices(eventServices.map(s => ({ ...s })));
    } else {
      setEditableServices([]);
    }
  }, [eventServices]);

  // Clear selected services when event services change
  useEffect(() => {
    setSelectedServicesForAction([]);
  }, [eventServices]);

  const currentSupplierId = useMemo(() => {
    if (!isSupplier || !user) return null;
    
    const matchingSupplier = allSuppliers.find(s => 
      (user.email && Array.isArray(s.contact_emails) && s.contact_emails.some(email => email.toLowerCase() === user.email.toLowerCase())) ||
      (user.phone && s.phone === user.phone)
    );
    
    return matchingSupplier?.id || null;
  }, [isSupplier, user, allSuppliers]);

  // Mutation for reordering services with optimistic updates
  const reorderServicesMutation = useMutation({
    mutationFn: async (updates) => {
      // updates is an array of {id, order_index}
      for (const update of updates) {
        await base44.entities.EventService.update(update.id, { order_index: update.order_index });
      }
    },
    onMutate: async (updates) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['eventServices', eventId] });
      
      // Snapshot the previous value
      const previousServices = queryClient.getQueryData(['eventServices', eventId]);
      
      // Optimistically update to the new value
      queryClient.setQueryData(['eventServices', eventId], (old) => {
        if (!old) return old;
        
        const updatedServices = old.map(service => {
          const update = updates.find(u => u.id === service.id);
          if (update) {
            return { ...service, order_index: update.order_index };
          }
          return service;
        });
        
        // Sort the updated services
        return updatedServices.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      });
      
      // Return context with the previous value
      return { previousServices };
    },
    onError: (err, updates, context) => {
      // Rollback to the previous value on error
      if (context?.previousServices) {
        queryClient.setQueryData(['eventServices', eventId], context.previousServices);
      }
      console.error("Failed to reorder services:", err);
      alert("שגיאה בשינוי סדר השירותים. הסדר הוחזר למצב הקודם.");
    },
    onSuccess: () => {
      // Invalidate to ensure we're in sync with server
      queryClient.invalidateQueries({ queryKey: ['eventServices', eventId] });
    }
  });

  const loadEventData = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ['event', eventId] });
    await queryClient.refetchQueries({ queryKey: ['eventServices', eventId] });
    await queryClient.refetchQueries({ queryKey: ['payments', eventId] });
  }, [eventId, queryClient]);

  const filteredServicesForSupplier = useMemo(() => {
    if (!isSupplier || !user) return eventServices;
    
    return eventServices.filter(es => {
      let supplierIds = [];
      try {
        supplierIds = JSON.parse(es.supplier_ids || '[]');
      } catch (e) {}
      
      const matchingSupplier = allSuppliers.find(s => 
        (user.email && Array.isArray(s.contact_emails) && s.contact_emails.some(email => email.toLowerCase() === user.email.toLowerCase())) ||
        (user.phone && s.phone === user.phone)
      );
      
      return matchingSupplier && supplierIds.includes(matchingSupplier.id);
    });
  }, [eventServices, isSupplier, user, allSuppliers]);

  const groupedServices = useMemo(() => {
    const servicesToUse = isSupplier ? filteredServicesForSupplier : eventServices;
    const servicesSorted = [...servicesToUse].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    // Suppliers see only their assigned services as flat list - no package grouping
    if (isSupplier) {
      return { packages: [], standalone: servicesSorted };
    }

    const packagesMap = new Map();
    const standalone = [];
    
    // First pass: Identify main package items and legacy packages
    servicesSorted.forEach(es => {
      if (es.is_package_main_item) {
        // New structure: Main Item
        packagesMap.set(es.id, {
          package_id: es.id,
          package_name: es.package_name || 'חבילה',
          package_price: es.custom_price || 0, // In new structure, custom_price on main item is the package price
          package_includes_vat: es.includes_vat || false,
          package_description: es.package_description || es.service_description || '',
          services: [],
          order_index: es.order_index,
          main_item: es
        });
      } else if (es.package_id && !es.parent_package_event_service_id) {
        // Legacy fallback: Group by package_id if exists and not using new structure
        if (!packagesMap.has(es.package_id)) {
          packagesMap.set(es.package_id, {
            package_id: es.package_id,
            package_name: es.package_name || 'חבילה',
            package_price: es.package_price || 0,
            package_includes_vat: es.package_includes_vat || false,
            package_description: es.package_description || '',
            services: [],
            order_index: Infinity
          });
        }
      }
    });

    // Second pass: Assign services to packages or standalone
    servicesSorted.forEach(es => {
      if (es.is_package_main_item) return; // Already handled

      if (es.parent_package_event_service_id && packagesMap.has(es.parent_package_event_service_id)) {
        // New structure: Child Item
        packagesMap.get(es.parent_package_event_service_id).services.push(es);
      } else if (es.package_id && packagesMap.has(es.package_id) && !es.parent_package_event_service_id) {
        // Legacy fallback
        packagesMap.get(es.package_id).services.push(es);
      } else {
        standalone.push(es);
      }
    });

    const packagesWithServices = Array.from(packagesMap.values()).map(pkg => {
        // For legacy, calculate min order index. For new, use main item's order index.
        if (pkg.order_index === Infinity) {
             pkg.order_index = Math.min(...pkg.services.map(s => s.order_index || 0));
        }
        pkg.services.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        return pkg;
    }).sort((a, b) => a.order_index - b.order_index);

    standalone.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    return { packages: packagesWithServices, standalone };
  }, [eventServices, isSupplier, filteredServicesForSupplier]);

  // Calculate financials based on EDIT state if editing, otherwise DB state
  const eventForCalculation = useMemo(() => {
    if (editingSection === 'services') {
       return { ...event, ...allInclusiveData };
    }
    return event;
  }, [event, editingSection, allInclusiveData]);

  const servicesForCalculation = useMemo(() => {
    if (editingSection === 'services' && editableServices.length > 0) {
        return editableServices;
    }
    return eventServices;
  }, [editingSection, editableServices, eventServices]);

  const financials = useMemo(() => {
    const vatRateSetting = appSettings.find(s => s.setting_key === 'vat_rate');
    const vatRate = vatRateSetting ? parseFloat(vatRateSetting.setting_value) / 100 : 0.18;
    return calculateEventFinancials(eventForCalculation, servicesForCalculation, payments, vatRate);
  }, [eventForCalculation, servicesForCalculation, payments, appSettings]);

  const handleStatusChange = useCallback(async (newStatus) => {
    try {
      const previousStatus = event?.status;
      await base44.entities.Event.update(eventId, { status: newStatus });
      
      // Sync with Google Calendar
      try {
        if (newStatus === 'completed' && previousStatus !== 'completed') {
          // Create calendar event when status changes to completed
          // Sync for admin
          if (user?.role === 'admin') {
            await base44.functions.invoke('syncGoogleCalendar', {
              action: 'create',
              eventId: eventId,
              userType: 'admin'
            });
          }
          // Also sync for client (will use their connected calendar if available)
          await base44.functions.invoke('syncGoogleCalendar', {
            action: 'create',
            eventId: eventId,
            userType: 'client'
          });
        } else if (newStatus !== 'completed' && previousStatus === 'completed') {
          // Delete calendar event when status changes from completed
          if (user?.role === 'admin') {
            await base44.functions.invoke('syncGoogleCalendar', {
              action: 'delete',
              eventId: eventId,
              userType: 'admin'
            });
          }
          await base44.functions.invoke('syncGoogleCalendar', {
            action: 'delete',
            eventId: eventId,
            userType: 'client'
          });
        }
      } catch (calendarError) {
        console.warn("Calendar sync failed:", calendarError);
        // Don't block the status change if calendar sync fails
      }
      
      await base44.functions.invoke('checkEventStatus', { eventId: eventId }).catch(console.error);
      await loadEventData();
    } catch (error) {
      console.error("Failed to update status:", error);
      alert("שגיאה בעדכון סטטוס האירוע");
    }
  }, [eventId, loadEventData, event, user]);

  const handleDeleteEvent = useCallback(async () => {
    const confirmMessage = `⚠️ אזהרה חמורה! ⚠️\n\nהפעולה הזו תמחק לצמיתות את:\n• האירוע "${event.event_name}"\n• כל השירותים המשויכים (${eventServices.length} שירותים)\n• כל התשלומים (${payments.length} תשלומים)\n• כל הנתונים הקשורים לאירוע זה\n\nפעולה זו אינה הפיכה!\n\nהאם אתה בטוח לחלוטין שברצונך למחוק אירוע זה?`;
    
    if (!window.confirm(confirmMessage)) return;
    
    const doubleConfirm = window.confirm(`אישור נוסף:\n\nהאם אתה בטוח ב-100% שברצונך למחוק את אירוע "${event.family_name}"?\n\nהקלד "אישור" בחלון הבא למחיקה סופית.`);
    
    if (!doubleConfirm) return;
    
    try {
      // Delete all event services
      for (const service of eventServices) {
        await base44.entities.EventService.delete(service.id);
      }
      
      // Delete all payments
      for (const payment of payments) {
        await base44.entities.Payment.delete(payment.id);
      }
      
      // Delete the event itself
      await base44.entities.Event.delete(eventId);
      
      // Navigate back to event management
      navigate(createPageUrl('EventManagement'));
    } catch (error) {
      console.error("Failed to delete event:", error);
      alert("שגיאה במחיקת האירוע. נסה שוב או פנה לתמיכה.");
    }
  }, [event, eventServices, payments, eventId, navigate]);

  const handleSaveEventDetails = useCallback(async () => {
    setIsSavingEventDetails(true);
    try {
      await base44.entities.Event.update(eventId, eventDetailsData);
      setEditingSection(null);
      await loadEventData();
    } catch (error) {
      console.error("Failed to save event details:", error);
      alert("שגיאה בשמירת פרטי האירוע");
    } finally {
      setIsSavingEventDetails(false);
    }
  }, [eventId, eventDetailsData, loadEventData]);

  const handleSaveFamilyDetails = useCallback(async () => {
    setIsSavingFamilyDetails(true);
    try {
      await base44.entities.Event.update(eventId, { 
        parents: editableParents,
        family_name: editableFamilyName,
        child_name: editableChildName
      });
      setEditingSection(null);
      await loadEventData();
    } catch (error) {
      console.error("Failed to save family details:", error);
      alert("שגיאה בשמירת פרטי המשפחה");
    } finally {
      setIsSavingFamilyDetails(false);
    }
  }, [eventId, editableParents, editableFamilyName, editableChildName, loadEventData]);

  const handleSaveSchedule = useCallback(async () => {
    setIsSavingSchedule(true);
    try {
      await base44.entities.Event.update(eventId, { schedule: editableSchedule });
      setEditingSection(null);
      await loadEventData();
    } catch (error) {
      console.error("Failed to save schedule:", error);
      alert("שגיאה בשמירת לוח הזמנים");
    } finally {
      setIsSavingSchedule(false);
    }
  }, [eventId, editableSchedule, loadEventData]);

  const handleSaveFinancial = useCallback(async () => {
    setIsSavingFinancial(true);
    try {
      await base44.entities.Event.update(eventId, {
        discount_amount: parseFloat(financialEditData.discount_amount) || null,
        discount_reason: financialEditData.discount_reason || null,
        discount_before_vat: financialEditData.discount_before_vat,
        total_override: parseFloat(financialEditData.total_override) || null,
        total_override_includes_vat: financialEditData.total_override_includes_vat
      });
      setEditingSection(null);
      await loadEventData();
    } catch (error) {
      console.error("Failed to save financial data:", error);
      alert("שגיאה בשמירת הנתונים הפיננסיים");
    } finally {
      setIsSavingFinancial(false);
    }
  }, [eventId, financialEditData, loadEventData]);

  const handleSaveServices = useCallback(async () => {
    setIsSavingServices(true);
    try {
      await base44.entities.Event.update(eventId, { 
        all_inclusive: allInclusiveData.all_inclusive,
        all_inclusive_price: parseFloat(allInclusiveData.all_inclusive_price) || null,
        all_inclusive_includes_vat: allInclusiveData.all_inclusive_includes_vat
      });
      
      for (const service of editableServices) {
        await base44.entities.EventService.update(service.id, service);
      }
      
      setEditingSection(null);
      await loadEventData();
    } catch (error) {
      console.error("Failed to save services:", error);
      alert("שגיאה בשמירת השירותים");
    } finally {
      setIsSavingServices(false);
    }
  }, [eventId, allInclusiveData, editableServices, loadEventData]);

  const handleUploadReceipt = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingReceipt(true);
    
    try {
      const response = await base44.integrations.Core.UploadFile({ file });
      
      if (response && response.file_url) {
        setPaymentForm(prev => ({ ...prev, receipt_image_url: response.file_url }));
      } else {
        throw new Error("No file URL in response");
      }
    } catch (error) {
      console.error("Failed to upload receipt:", error);
      alert("שגיאה בהעלאת האסמכתא: " + error.message);
    } finally {
      setUploadingReceipt(false);
    }
  }, []);

  const handleAddPayment = useCallback(async () => {
    try {
      const amount = parseFloat(paymentForm.amount);
      
      if (!amount || isNaN(amount) || amount <= 0) {
        alert("יש להזין סכום תקין");
        return;
      }
      
      if (!paymentForm.payment_date) {
        alert("יש לבחור תאריך תשלום");
        return;
      }
      
      const paymentData = {
        event_id: eventId,
        amount: amount,
        payment_date: paymentForm.payment_date,
        payment_method: paymentForm.payment_method
      };
      
      if (paymentForm.notes && paymentForm.notes.trim()) {
        paymentData.notes = paymentForm.notes.trim();
      }
      
      if (paymentForm.receipt_image_url && paymentForm.receipt_image_url.trim()) {
        paymentData.receipt_image_url = paymentForm.receipt_image_url.trim();
      }
      
      await base44.entities.Payment.create(paymentData);

      // Auto-update status if quote and payment added
      if (event.status === 'quote') {
        await base44.entities.Event.update(eventId, { status: 'confirmed' });
      }
      
      setShowPaymentDialog(false);
      setPaymentForm({
        amount: '',
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'cash',
        notes: '',
        receipt_image_url: ''
      });
      
      await loadEventData();
      
    } catch (error) {
      console.error("Failed to add payment:", error);
      alert("שגיאה בהוספת התשלום: " + (error.response?.data?.message || error.message || "שגיאת רשת"));
    }
  }, [eventId, paymentForm, loadEventData]);

  const handleDeletePayment = useCallback(async (paymentId) => {
    if (window.confirm("האם למחוק תשלום זה?")) {
      try {
        await base44.entities.Payment.delete(paymentId);
        await loadEventData();
      } catch (error) {
          console.error("Failed to delete payment:", error);
          alert("שגיאה במחיקת התשלום");
      }
    }
  }, [loadEventData]);

  const handleDeleteReceipt = useCallback(async (paymentId) => {
    if (!window.confirm("האם למחוק את האסמכתא?")) return;
    
    try {
      await base44.entities.Payment.update(paymentId, { receipt_image_url: '' });
      setShowReceiptDialog(false);
      setCurrentReceiptUrl('');
      setCurrentReceiptPaymentId(null);
      await loadEventData();
    } catch (error) {
      console.error("Failed to delete receipt:", error);
      alert("שגיאה במחיקת האסמכתא");
    }
  }, [loadEventData]);

  const updateSupplierStatus = useCallback(async (eventServiceId, supplierId, newStatus) => {
    try {
      const eventService = eventServices.find(es => es.id === eventServiceId);
      if (!eventService) return;

      let supplierStatuses = {};
      try {
        supplierStatuses = JSON.parse(eventService.supplier_statuses || '{}');
      } catch (e) {
        supplierStatuses = {};
      }

      const previousStatus = supplierStatuses[supplierId];
      supplierStatuses[supplierId] = newStatus;

      await base44.entities.EventService.update(eventServiceId, {
        supplier_statuses: JSON.stringify(supplierStatuses)
      });

      // Sync with Google Calendar for supplier
      try {
        if (newStatus === 'confirmed' && previousStatus !== 'confirmed') {
          // Create calendar event when supplier confirms
          await base44.functions.invoke('syncGoogleCalendar', {
            action: 'create',
            eventId: eventId,
            eventServiceId: eventServiceId,
            supplierId: supplierId,
            userType: 'supplier'
          });
        } else if (newStatus !== 'confirmed' && previousStatus === 'confirmed') {
          // Delete calendar event when supplier status changes from confirmed
          await base44.functions.invoke('syncGoogleCalendar', {
            action: 'delete',
            eventId: eventId,
            eventServiceId: eventServiceId,
            supplierId: supplierId,
            userType: 'supplier'
          });
        }
      } catch (calendarError) {
        console.warn("Supplier calendar sync failed:", calendarError);
        // Don't block the status change if calendar sync fails
      }
      
      await base44.functions.invoke('checkEventStatus', { eventId: eventId }).catch(console.error);
      await loadEventData();
    } catch (error) {
      console.error("Failed to update supplier status:", error);
      alert("שגיאה בעדכון סטטוס הספק");
    }
  }, [eventServices, loadEventData, eventId]);

  const handleRemoveSupplier = useCallback(async (eventServiceId, supplierId) => {
    if (!window.confirm("האם להסיר ספק זה מהשירות?")) return;
    
    try {
      const eventService = eventServices.find(es => es.id === eventServiceId);
      if (!eventService) return;

      let supplierIds = [];
      let supplierStatuses = {};
      let supplierNotes = {};
      
      try {
        supplierIds = JSON.parse(eventService.supplier_ids || '[]');
        supplierStatuses = JSON.parse(eventService.supplier_statuses || '{}');
        supplierNotes = JSON.parse(eventService.supplier_notes || '{}');
      } catch (e) {
      }

      supplierIds = supplierIds.filter(id => id !== supplierId);
      delete supplierStatuses[supplierId];
      delete supplierNotes[supplierId];

      await base44.entities.EventService.update(eventServiceId, {
        supplier_ids: JSON.stringify(supplierIds),
        supplier_statuses: JSON.stringify(supplierStatuses),
        supplier_notes: JSON.stringify(supplierNotes)
      });
      
      await base44.functions.invoke('checkEventStatus', { eventId: eventId }).catch(console.error);
      await loadEventData();
    } catch (error) {
      console.error("Failed to remove supplier:", error);
      alert("שגיאה בהסרת הספק");
    }
  }, [eventServices, loadEventData]);

  const handleUpdateSupplierNote = useCallback(async (eventServiceId, supplierId, note) => {
    try {
      const eventService = eventServices.find(es => es.id === eventServiceId);
      if (!eventService) return;

      let supplierNotes = {};
      try {
        supplierNotes = JSON.parse(eventService.supplier_notes || '{}');
      } catch (e) {}

      supplierNotes[supplierId] = note;

      await base44.entities.EventService.update(eventServiceId, {
        supplier_notes: JSON.stringify(supplierNotes)
      });
    } catch (error) {
      console.error("Failed to update supplier note:", error);
    }
  }, [eventServices]);

  const handleUpdateServiceField = useCallback(async (serviceId, field, value) => {
    setSavingServiceField({ serviceId, field });
    try {
      const updateData = { [field]: value };
      
      if (field === 'custom_price' || field === 'quantity') {
        updateData[field] = parseFloat(value) || 0;
      } else if (field === 'includes_vat') {
        updateData[field] = Boolean(value);
      } else if (field === 'min_suppliers') {
        updateData[field] = parseInt(value) || 0;
      }
      
      await base44.entities.EventService.update(serviceId, updateData);
      await base44.functions.invoke('checkEventStatus', { eventId: eventId }).catch(console.error);
      await loadEventData();
      setEditingServiceField(null);
    } catch (error) {
      console.error(`Failed to update ${field}:`, error);
      alert(`שגיאה בעדכון ${field}`);
    } finally {
      setSavingServiceField(null);
    }
  }, [loadEventData]);

  const handleDragEnd = useCallback(async (result) => {
    const { source, destination, type } = result;

    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;
    if (!isAdmin) return;

    const updates = [];

    if (type === 'package') {
      const currentPackages = Array.from(groupedServices.packages);
      const [movedPackage] = currentPackages.splice(source.index, 1);
      currentPackages.splice(destination.index, 0, movedPackage);

      for (let i = 0; i < currentPackages.length; i++) {
        const pkg = currentPackages[i];
        const newPackageBaseOrderIndex = (i + 1) * 1000;

        for (const service of pkg.services) {
          updates.push({
            id: service.id,
            order_index: newPackageBaseOrderIndex + (service.order_index % 1000 || 0)
          });
        }
      }
      reorderServicesMutation.mutate(updates);
      return;
    }

    if (type === 'service-in-package') {
      const packageId = source.droppableId;
      const targetPackage = groupedServices.packages.find(pkg => pkg.package_id === packageId);
      if (!targetPackage) return;

      const servicesInPackage = Array.from(targetPackage.services);
      const [movedService] = servicesInPackage.splice(source.index, 1);
      servicesInPackage.splice(destination.index, 0, movedService);

      // Recalculate order_index for all services in this package
      // Assuming packages have order_index in multiples of 1000, and services within are 0-999
      const packageMajorIndex = Math.floor(targetPackage.order_index / 1000);

      for (let i = 0; i < servicesInPackage.length; i++) {
        updates.push({
          id: servicesInPackage[i].id,
          order_index: packageMajorIndex * 1000 + i
        });
      }
      reorderServicesMutation.mutate(updates);
      return;
    }

    if (type === 'standalone') {
      const currentStandaloneServices = Array.from(groupedServices.standalone);
      const [movedService] = currentStandaloneServices.splice(source.index, 1);
      currentStandaloneServices.splice(destination.index, 0, movedService);

      for (let i = 0; i < currentStandaloneServices.length; i++) {
        updates.push({
          id: currentStandaloneServices[i].id,
          order_index: i
        });
      }
      reorderServicesMutation.mutate(updates);
    }
  }, [isAdmin, groupedServices, reorderServicesMutation]);

  const handleAssignSuppliers = useCallback(async () => {
    if (!selectedServiceForSupplier) return;
    try {
      await base44.entities.EventService.update(selectedServiceForSupplier.id, {
        supplier_ids: JSON.stringify(supplierFormData.supplierIds),
        supplier_notes: JSON.stringify(supplierFormData.notes)
      });

      if (supplierFormData.supplierIds.length > 0) {
        try {
          const serviceDetails = allServices.find(s => s.id === selectedServiceForSupplier.service_id);
          await base44.functions.invoke('notifySupplierAssignment', {
            supplierIds: supplierFormData.supplierIds,
            eventId: eventId,
            serviceName: serviceDetails?.service_name || 'שירות'
          });
        } catch (notifyError) {
          console.warn("Failed to notify suppliers:", notifyError);
        }
      }

      setShowSupplierDialog(false);
      setSelectedServiceForSupplier(null);
      setSupplierFormData({ supplierIds: [], notes: {} });
      setSupplierSearchTerm("");
      await loadEventData();
    } catch (error) {
      console.error("Failed to assign suppliers:", error);
      alert("שגיאה בשיבוץ הספקים");
    }
  }, [selectedServiceForSupplier, supplierFormData, allServices, eventId, loadEventData]);

  const handleOpenAddServiceToPackage = useCallback((packageId) => {
    setTargetPackageForService(packageId);
    setSelectedServiceToAdd([]);
    setAvailableServicesToAdd(allServices);
    setShowAddServiceToPackageDialog(true);
  }, [allServices]);

  const handleAddServiceToExistingPackage = useCallback(async () => {
    if (selectedServiceToAdd.length === 0) {
      alert("יש לבחור לפחות שירות אחד");
      return;
    }

    const existingServiceIds = eventServices.map(es => es.service_id);
    const duplicates = selectedServiceToAdd.filter(sid => existingServiceIds.includes(sid));
    
    if (duplicates.length > 0) {
      const duplicateNames = duplicates.map(sid => {
        const service = allServices.find(s => s.id === sid);
        return service?.service_name || sid;
      }).join(', ');
      
      const confirmAdd = window.confirm(
        `השירותים הבאים כבר קיימים באירוע: ${duplicateNames}\n\nהאם להוסיף אותם שוב?`
      );
      
      if (!confirmAdd) {
        return;
      }
    }

    setIsAddingServiceToPackage(true);
    try {
      // Find package - handle both New Structure (by ID) and Legacy Structure (by package_id)
      let packageMainItem = eventServices.find(es => es.id === targetPackageForService && es.is_package_main_item);
      let isNewStructure = true;

      // Fallback for legacy
      if (!packageMainItem) {
        packageMainItem = eventServices.find(es => es.package_id === targetPackageForService);
        isNewStructure = false;
      }

      if (!packageMainItem) {
        alert("חבילת היעד לא נמצאה.");
        setIsAddingServiceToPackage(false);
        return;
      }

      const currentPackageServices = groupedServices.packages.find(p => p.package_id === targetPackageForService)?.services || [];
      const maxExistingServiceOrder = currentPackageServices.reduce((currentMax, s) => Math.max(currentMax, s.order_index || 0), 0);
      
      // Calculate index logic
      let packageBaseOrderIndex = 0;
      if (currentPackageServices.length > 0) {
          packageBaseOrderIndex = Math.floor(maxExistingServiceOrder / 1000) * 1000;
      } else if (packageMainItem.order_index) {
          packageBaseOrderIndex = Math.floor(packageMainItem.order_index / 1000) * 1000;
      }
      
      const startMinorIndex = currentPackageServices.length > 0 ? (maxExistingServiceOrder % 1000) + 1 : 1;

      for (let i = 0; i < selectedServiceToAdd.length; i++) {
        const serviceId = selectedServiceToAdd[i];
        const serviceDetails = allServices.find(s => s.id === serviceId);

        const newServiceData = {
          event_id: eventId,
          service_id: serviceId,
          package_name: packageMainItem.package_name,
          package_price: packageMainItem.package_price || packageMainItem.custom_price || 0,
          package_includes_vat: packageMainItem.package_includes_vat || packageMainItem.includes_vat || false,
          package_description: packageMainItem.package_description || packageMainItem.service_description || '',
          custom_price: 0, // In package usually 0 unless specific override
          quantity: 1,
          includes_vat: serviceDetails?.default_includes_vat || false,
          service_description: serviceDetails?.service_description || '',
          order_index: packageBaseOrderIndex + startMinorIndex + i
        };

        if (isNewStructure) {
            newServiceData.parent_package_event_service_id = packageMainItem.id;
            newServiceData.is_package_main_item = false;
            newServiceData.package_id = null; // Clear legacy field
        } else {
            newServiceData.package_id = targetPackageForService;
        }

        await base44.entities.EventService.create(newServiceData);
      }

      setShowAddServiceToPackageDialog(false);
      setTargetPackageForService(null);
      setSelectedServiceToAdd([]);
      setAddToPackageSearchTerm("");
      await loadEventData();
    } catch (error) {
      console.error("Failed to add service to package:", error);
      alert("שגיאה בהוספת השירות לחבילה");
    } finally {
      setIsAddingServiceToPackage(false);
    }
  }, [selectedServiceToAdd, eventServices, allServices, targetPackageForService, groupedServices, eventId, loadEventData]);

  const handleCreatePackage = useCallback(async () => {
    if (!packageForm.package_name) {
      alert("יש למלא שם חבילה");
      return;
    }

    if (packageForm.selectedServices.length === 0) {
      alert("יש לבחור לפחות שירות אחד");
      return;
    }

    const existingEventServiceIds = eventServices.map(es => es.service_id);
    const duplicates = packageForm.selectedServices.filter(sid => existingEventServiceIds.includes(sid));
    
    if (duplicates.length > 0) {
      const duplicateNames = duplicates.map(sid => {
        const service = allServices.find(s => s.id === sid);
        return service?.service_name || sid;
      }).join(', ');
      
      const confirmAdd = window.confirm(
        `השירותים הבאים כבר קיימים באירוע: ${duplicateNames}\n\nהאם להוסיף אותם שוב?`
      );
      
      if (!confirmAdd) {
        return;
      }
    }

    setIsCreatingPackage(true);
    try {
      const packageId = `pkg_${Date.now()}`;
      const packagePrice = parseFloat(packageForm.package_price) || 0;

      const maxOrderIndex = eventServices.reduce((currentMax, s) => Math.max(currentMax, s.order_index || 0), 0);
      const newPackageBaseOrderIndex = Math.ceil(maxOrderIndex / 1000) * 1000 + 1000;

      for (let i = 0; i < packageForm.selectedServices.length; i++) {
        const serviceId = packageForm.selectedServices[i];
        const existingEventService = eventServices.find(es => es.service_id === serviceId && es.event_id === eventId);
        
        const serviceUpdateData = {
          package_id: packageId,
          package_name: packageForm.package_name,
          package_price: packagePrice,
          package_includes_vat: packageForm.package_includes_vat,
          package_description: packageForm.package_description,
          order_index: newPackageBaseOrderIndex + i
        };

        if (existingEventService) {
          await base44.entities.EventService.update(existingEventService.id, serviceUpdateData);
        } else {
          const serviceDetails = allServices.find(s => s.id === serviceId);
          await base44.entities.EventService.create({
            event_id: eventId,
            service_id: serviceId,
            custom_price: serviceDetails?.base_price || 0,
            quantity: 1,
            includes_vat: serviceDetails?.default_includes_vat || false,
            service_description: serviceDetails?.service_description || '',
            ...serviceUpdateData
          });
        }
      }

      setShowPackageDialog(false);
      setPackageForm({
        package_name: '',
        package_description: '',
        package_price: '',
        package_includes_vat: false,
        selectedServices: []
      });
      setPackageServiceSearchTerm("");
      await loadEventData();
    } catch (error) {
      console.error("Failed to create package:", error);
      alert("שגיאה ביצירת החבילה");
    } finally {
      setIsCreatingPackage(false);
    }
  }, [packageForm, eventServices, allServices, eventId, loadEventData]);

  const handleDeletePackage = useCallback(async (packageId) => {
    if (!window.confirm("האם למחוק חבילה זו ואת כל השירותים שבה?")) return;
    
    try {
      // Correctly identify services to delete for both legacy and new structure
      const servicesToDelete = eventServices.filter(es => 
        es.package_id === packageId || // Legacy
        es.id === packageId || // Main Item (New Structure)
        es.parent_package_event_service_id === packageId // Children (New Structure)
      );
      
      for (const service of servicesToDelete) {
        await base44.entities.EventService.delete(service.id);
      }
      
      await loadEventData();
    } catch (error) {
      console.error("Failed to delete package:", error);
      alert("שגיאה במחיקת החבילה");
    }
  }, [eventServices, loadEventData]);

  const handleOpenEditPackage = useCallback((pkg) => {
    setEditingPackage(pkg.package_id);
    setEditPackageForm({
      package_name: pkg.package_name,
      package_description: pkg.package_description || '',
      package_price: pkg.package_price || '',
      package_includes_vat: pkg.package_includes_vat || false
    });
    setShowEditPackageDialog(true);
  }, []);

  const handleSavePackageEdit = useCallback(async () => {
    if (!editPackageForm.package_name) {
      alert("יש למלא שם חבילה");
      return;
    }

    // Identify Package Type (New Structure vs Legacy)
    const mainPackageItem = eventServices.find(es => es.id === editingPackage && es.is_package_main_item);
    const isNewStructure = !!mainPackageItem;

    // Identify Services to Update
    let servicesToUpdate = [];
    if (isNewStructure) {
        servicesToUpdate = eventServices.filter(es => es.id === editingPackage || es.parent_package_event_service_id === editingPackage);
    } else {
        servicesToUpdate = eventServices.filter(es => es.package_id === editingPackage);
    }

    // Optimistic update
    const updatedServices = editableServices.map(service => {
      const isTarget = servicesToUpdate.some(s => s.id === service.id);
      if (isTarget) {
        const updates = {
          package_name: editPackageForm.package_name,
          package_description: editPackageForm.package_description,
          package_price: parseFloat(editPackageForm.package_price) || 0,
          package_includes_vat: editPackageForm.package_includes_vat
        };

        // For new structure main item, we MUST update custom_price as it holds the actual package price
        if (isNewStructure && service.id === editingPackage) {
            updates.custom_price = parseFloat(editPackageForm.package_price) || 0;
            updates.includes_vat = editPackageForm.package_includes_vat;
        }
        return { ...service, ...updates };
      }
      return service;
    });
    setEditableServices(updatedServices);
    
    // Close dialog immediately
    setShowEditPackageDialog(false);
    
    setIsSavingPackageEdit(true);
    try {
      console.log("[DEBUG] Starting package save. ID:", editingPackage, "Is New Structure:", isNewStructure);
      console.log("[DEBUG] Services to update:", servicesToUpdate.map(s => s.id));
      console.log("[DEBUG] Form data:", editPackageForm);

      // Parallel updates
      await Promise.all(servicesToUpdate.map(service => {
        const updates = {
          package_name: editPackageForm.package_name,
          package_description: editPackageForm.package_description,
          package_price: parseFloat(editPackageForm.package_price) || 0,
          package_includes_vat: editPackageForm.package_includes_vat
        };

        // For new structure main item, update crucial fields for calculation
        if (isNewStructure && service.id === editingPackage) {
            updates.custom_price = parseFloat(editPackageForm.package_price) || 0;
            updates.includes_vat = editPackageForm.package_includes_vat;
        }

        console.log(`[DEBUG] Sending update for service ${service.id}:`, updates);
        return base44.entities.EventService.update(service.id, updates);
      }));

      setEditingPackage(null);
      setEditPackageForm({
        package_name: '',
        package_description: '',
        package_price: '',
        package_includes_vat: false
      });
      loadEventData(); // Background refresh
    } catch (error) {
      console.error("Failed to update package:", error);
      alert("שגיאה בעדכון החבילה: " + (error.message || JSON.stringify(error)));
      loadEventData(); // Revert
    } finally {
      setIsSavingPackageEdit(false);
    }
  }, [editPackageForm, eventServices, editingPackage, loadEventData, editableServices]);

  const handleRemoveFromPackage = useCallback(async (serviceId) => {
    if (!window.confirm("האם להוציא שירות זה מהחבילה?")) return;
    
    try {
      const serviceToRemove = eventServices.find(es => es.id === serviceId);
      if (!serviceToRemove) return;

      const maxStandaloneOrderIndex = groupedServices.standalone.reduce((currentMax, s) => Math.max(currentMax, s.order_index || 0), 0);
      const newStandaloneOrderIndex = maxStandaloneOrderIndex + 1;

      await base44.entities.EventService.update(serviceId, {
        package_id: null,
        package_name: null,
        package_price: null,
        package_includes_vat: false,
        package_description: null,
        order_index: newStandaloneOrderIndex
      });
      await loadEventData();
    } catch (error) {
      console.error("Failed to remove from package:", error);
      alert("שגיאה בהוצאת השירות מהחבילה");
    }
  }, [eventServices, groupedServices, loadEventData]);

  const handleDeleteService = useCallback(async (serviceId) => {
    if (!window.confirm("האם למחוק שירות זה?")) return;
    
    try {
      await base44.entities.EventService.delete(serviceId);
      await loadEventData();
    } catch (error) {
      console.error("Failed to delete service:", error);
      alert("שגיאה במחיקת השירות");
    }
  }, [loadEventData]);

  const handleDeleteSelectedServices = useCallback(async () => {
    if (selectedServicesForAction.length === 0) return;
    
    if (!window.confirm(`האם למחוק ${selectedServicesForAction.length} שירותים נבחרים?`)) return;
    
    try {
      for (const serviceId of selectedServicesForAction) {
        await base44.entities.EventService.delete(serviceId);
      }
      setSelectedServicesForAction([]);
      await loadEventData();
    } catch (error) {
      console.error("Failed to delete services:", error);
      alert("שגיאה במחיקת השירותים");
    }
  }, [selectedServicesForAction, loadEventData]);

  const handleAddStandaloneServices = useCallback(async () => {
    if (selectedServicesToAdd.length === 0) {
      alert("יש לבחור לפחות שירות אחד");
      return;
    }

    const existingServiceIds = eventServices.map(es => es.service_id);
    const duplicates = selectedServicesToAdd.filter(sid => existingServiceIds.includes(sid));
    
    if (duplicates.length > 0) {
      const duplicateNames = duplicates.map(sid => {
        const service = allServices.find(s => s.id === sid);
        return service?.service_name || sid;
      }).join(', ');
      
      const confirmAdd = window.confirm(
        `השירותים הבאים כבר קיימים באירוע: ${duplicateNames}\n\nהאם להוסיף אותם שוב?`
      );
      
      if (!confirmAdd) {
        return;
      }
    }

    setIsAddingServices(true);
    try {
      const maxOrderIndex = eventServices.reduce((max, s) => Math.max(max, s.order_index || 0), 0);
      
      for (let i = 0; i < selectedServicesToAdd.length; i++) {
        const serviceId = selectedServicesToAdd[i];
        const serviceDetails = allServices.find(s => s.id === serviceId);

        await base44.entities.EventService.create({
          event_id: eventId,
          service_id: serviceId,
          custom_price: serviceDetails?.base_price || 0,
          quantity: 1,
          includes_vat: serviceDetails?.default_includes_vat || false,
          service_description: serviceDetails?.service_description || '',
          order_index: serviceDetails?.default_order_index !== undefined ? serviceDetails.default_order_index : (maxOrderIndex + i + 1)
        });
      }

      setShowAddServiceDialog(false);
      setSelectedServicesToAdd([]);
      setAddServiceSearchTerm("");
      await loadEventData();
    } catch (error) {
      console.error("Failed to add services:", error);
      alert("שגיאה בהוספת השירותים");
    } finally {
      setIsAddingServices(false);
    }
  }, [selectedServicesToAdd, eventServices, allServices, eventId, loadEventData]);

  const handleAddExistingPackage = useCallback(async () => {
    if (!selectedExistingPackage) {
      alert("יש לבחור חבילה קיימת להוספה");
      return;
    }

    setIsAddingExistingPackage(true);
    try {
      const packageData = allPackages.find(p => p.id === selectedExistingPackage);
      if (!packageData) {
        alert("החבילה שנבחרה לא נמצאה ברשימת החבילות.");
        return;
      }

      const newEventPackageId = `pkg_${Date.now()}`;
      const maxOrderIndex = eventServices.reduce((currentMax, s) => Math.max(currentMax, s.order_index || 0), 0);
      const newPackageBaseOrderIndex = Math.ceil(maxOrderIndex / 1000) * 1000 + 1000;

      const servicesInPackage = packageData.service_ids || [];

      for (let i = 0; i < servicesInPackage.length; i++) {
        const serviceId = servicesInPackage[i];
        const serviceDetails = allServices.find(s => s.id === serviceId);

        if (!serviceDetails) {
          console.warn(`Service with ID ${serviceId} not found in allServices. Skipping.`);
          continue;
        }

        await base44.entities.EventService.create({
          event_id: eventId,
          service_id: serviceId,
          package_id: newEventPackageId,
          package_name: packageData.package_name,
          package_description: packageData.package_description,
          package_price: packageData.package_price,
          package_includes_vat: packageData.package_includes_vat,
          custom_price: serviceDetails?.base_price || 0,
          quantity: 1,
          includes_vat: serviceDetails?.default_includes_vat || false,
          service_description: serviceDetails?.service_description || '',
          order_index: serviceDetails?.default_order_index !== undefined ? serviceDetails.default_order_index : (newPackageBaseOrderIndex + i)
        });
      }

      setShowAddExistingPackageDialog(false);
      setSelectedExistingPackage(null);
      setExistingPackageSearchTerm("");
      await loadEventData();
    } catch (error) {
      console.error("Failed to add existing package to event:", error);
      alert("שגיאה בהוספת החבילה הקיימת: " + error.message);
    } finally {
      setIsAddingExistingPackage(false);
    }
  }, [selectedExistingPackage, allPackages, eventServices, allServices, eventId, loadEventData]);

  const handleGenerateQuote = useCallback(async () => {
    setIsGeneratingQuote(true);
    try {
      const response = await base44.functions.invoke('generateQuote', { eventId, includeIntro: quoteIncludeIntro, includePaymentTerms: quoteIncludePaymentTerms });
      const html = response.data.html;
      
      const newWindow = window.open();
      if (newWindow) {
        newWindow.document.write(html);
        newWindow.document.close();
      } else {
        alert("חוסם החלונות הקופצים מנע את פתיחת ההצעה");
      }
    } catch (error) {
      console.error("Failed to generate quote:", error);
      alert("שגיאה ביצירת הצעת המחיר");
    } finally {
      setIsGeneratingQuote(false);
    }
  }, [eventId, quoteIncludeIntro, quoteIncludePaymentTerms]);

  const handleGeneratePdf = useCallback(async () => {
    setIsGeneratingPdf(true);
    try {
      const response = await base44.functions.invoke('generateQuotePdf', { eventId, includeIntro: quoteIncludeIntro, includePaymentTerms: quoteIncludePaymentTerms });
      const pdfUrl = response.data.pdf_url;
      const fileName = response.data.fileName || `quote_${event?.family_name || eventId}.pdf`;

      if (pdfUrl) {
        // Direct download using fetch to get blob
        try {
            const pdfResponse = await fetch(pdfUrl);
            const blob = await pdfResponse.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (downloadError) {
             console.warn("Direct download failed, falling back to opening in new tab", downloadError);
             window.open(pdfUrl, '_blank');
        }
      } else {
        throw new Error('No PDF URL returned');
      }
      
    } catch (error) {
      console.error("Failed to generate PDF:", error);
      alert("שגיאה ביצירת קובץ ה-PDF: " + (error.response?.data?.error || error.message));
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [eventId, event, quoteIncludeIntro, quoteIncludePaymentTerms]);

  const handleSmartShare = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (shareStatus === 'ready' && pdfBlob) {
        try {
            const file = new File([pdfBlob], pdfFileName, { type: "application/pdf" });
            
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: 'הצעת מחיר',
                    text: ''
                });
                // Reset after successful share
                setShareStatus('initial');
                setPdfBlob(null);
                setPdfFileName("");
            } else {
                alert("המכשיר אינו תומך בשיתוף קבצים מסוג זה");
            }
        } catch (err) {
            console.error("Share failed/cancelled", err);
        }
        return;
    }

    if (shareStatus === 'initial') {
        try {
            setShareStatus('fetching');
            
            const response = await base44.functions.invoke('generateQuotePdf', { eventId, includeIntro: quoteIncludeIntro, includePaymentTerms: quoteIncludePaymentTerms });
            const pdfUrl = response.data.pdf_url;
            const fileName = response.data.fileName || `quote_${event?.family_name || eventId}.pdf`;
            
            if (pdfUrl) {
                const pdfResponse = await fetch(pdfUrl);
                const blob = await pdfResponse.blob();
                setPdfBlob(blob);
                setPdfFileName(fileName);
                setShareStatus('ready');
            } else {
                throw new Error('No PDF URL returned');
            }
            
        } catch (error) {
            console.error(error);
            setShareStatus('initial');
            alert("שגיאה בהכנת הקובץ, נסה שוב");
        }
    }
  }, [eventId, event, shareStatus, pdfBlob, pdfFileName, quoteIncludeIntro, quoteIncludePaymentTerms]);

  const handleExportEvent = useCallback(() => {
    setShowExportDialog(true);
  }, []);

  const handleConfirmExport = useCallback(() => {
    const exportData = {};

    if (exportOptions.eventDetails) {
      exportData.eventDetails = {
        event_name: event.event_name,
        event_type: event.event_type,
        event_date: event.event_date,
        location: event.location,
        city: event.city,
        concept: event.concept,
        guest_count: event.guest_count,
        status: event.status
      };
    }

    if (exportOptions.familyDetails) {
      exportData.familyDetails = {
        family_name: event.family_name,
        child_name: event.child_name,
        parents: event.parents || []
      };
    }

    if (exportOptions.services) {
      exportData.services = eventServices.map(es => {
        const serviceDetails = allServices.find(s => s.id === es.service_id);
        return {
          service_name: serviceDetails?.service_name || es.service_name,
          custom_price: es.custom_price,
          quantity: es.quantity,
          includes_vat: es.includes_vat,
          package_name: es.package_name,
          notes: es.notes,
          client_notes: es.client_notes,
          service_description: serviceDetails?.service_description
        };
      });
    }

    if (exportOptions.suppliers) {
      exportData.suppliers = eventServices.map(es => {
        let supplierIds = [];
        let supplierStatuses = {};
        try {
          supplierIds = JSON.parse(es.supplier_ids || '[]');
          supplierStatuses = JSON.parse(es.supplier_statuses || '{}');
        } catch (e) {}

        const serviceDetails = allServices.find(s => s.id === es.service_id);
        const assignedSuppliers = allSuppliers.filter(sup => supplierIds.includes(sup.id)).map(sup => ({
          supplier_name: sup.supplier_name,
          status: supplierStatuses[sup.id] || 'pending'
        }));

        return {
          service_name: serviceDetails?.service_name || es.service_name,
          suppliers: assignedSuppliers
        };
      });
    }

    if (exportOptions.payments) {
      exportData.payments = payments.map(p => ({
        amount: p.amount,
        payment_date: p.payment_date,
        payment_method: p.payment_method,
        notes: p.notes,
        receipt_image_url: p.receipt_image_url
      }));
    }

    if (exportOptions.financials) {
      exportData.financials = {
        totalCostWithoutVat: financials.totalCostWithoutVat,
        vatAmount: financials.vatAmount,
        totalCostWithVat: financials.totalCostWithVat,
        discountAmount: financials.discountAmount,
        finalTotal: financials.finalTotal,
        totalPaid: financials.totalPaid,
        balance: financials.balance
      };
    }

    if (exportOptions.notes && event.notes) {
      exportData.notes = event.notes;
    }

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `event_${event.family_name}_${event.event_date}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setShowExportDialog(false);
  }, [exportOptions, event, eventServices, allServices, allSuppliers, payments, financials]);

  const handleAddServicesToPackage = useCallback(async (saveGlobal = false) => {
    if (selectedServicesForPackage.length === 0) {
      alert("יש לבחור לפחות שירות אחד");
      return;
    }

    // Check if we are creating a new package or adding to existing
    // If we are selecting existing services that are ALREADY in the event (via checkbox), we update them.
    // If we are adding NEW services from the list (dialog), we create them.
    // The `selectedServicesForPackage` comes from `selectedServicesForAction` (existing) OR checkbox list in dialog (new).
    // Let's handle both cases.
    
    setIsAddingServicesToPackage(true);
    try {
      let mainPackageItem = null;
      let parentId = null;

      // 1. Determine/Create Parent Package
      if (targetPackageId === 'new') {
        if (!newPackageData.name) {
          alert("יש למלא שם חבילה חדשה");
          setIsAddingServicesToPackage(false);
          return;
        }
        
        // Create Main Package Item
        const maxOrderIndexOverall = eventServices.reduce((currentMax, s) => Math.max(currentMax, s.order_index || 0), 0);
        const newPackageOrderIndex = Math.ceil(maxOrderIndexOverall / 1000) * 1000 + 1000;

        mainPackageItem = await base44.entities.EventService.create({
          event_id: eventId,
          service_id: allServices[0]?.id || '',
          package_name: newPackageData.name,
          package_description: newPackageData.description,
          custom_price: parseFloat(newPackageData.price) || 0, // In new logic, main item holds the price in custom_price
          includes_vat: newPackageData.includes_vat,
          is_package_main_item: true,
          quantity: 1,
          order_index: newPackageOrderIndex
        });
        parentId = mainPackageItem.id;

        // Save Global Template if requested
        if (saveGlobal) {
            await base44.entities.Package.create({
                package_name: newPackageData.name,
                package_description: newPackageData.description,
                package_price: parseFloat(newPackageData.price) || 0,
                package_includes_vat: newPackageData.includes_vat,
                service_ids: selectedServicesForPackage, // Storing service IDs
                category: 'general'
            });
        }

      } else {
        // Existing package: targetPackageId is the EventService ID of the main item
        parentId = targetPackageId;
      }

      // 2. Add/Update Services
      // We need to differentiate between "Updating existing event services" and "Creating new event services"
      // selectedServicesForPackage contains IDs of services (from allServices).
      // If we came from "Add to Package" button on existing items, we need to find those items in eventServices.
      
      const existingServiceIdsInEvent = eventServices.map(es => es.service_id);
      
      for (const serviceId of selectedServicesForPackage) {
        // Check if this service ID is already in the event (and we are acting on it)
        // If we selected multiple existing rows, we likely have their IDs in selectedServicesForAction?
        // Wait, `selectedServicesForPackage` holds `service.id` (from `allServices`) or `eventService.id`?
        // In `ServicesCard`, `selectedServicesForAction` stores `service.id` (which is `eventService.id`).
        // So we are dealing with EventService IDs if coming from the main screen selection.
        
        const existingEventService = eventServices.find(es => es.id === serviceId);
        
        if (existingEventService) {
            // Update existing event service to belong to package
            await base44.entities.EventService.update(existingEventService.id, {
                parent_package_event_service_id: parentId,
                package_id: null, // Clear legacy
                custom_price: 0, // Reset price to 0 as it's now in package
                is_package_main_item: false
            });
        } else {
            // Create new event service (if selected from list of all services)
            // This happens if we use the dialog search to add new services
            const serviceDetails = allServices.find(s => s.id === serviceId);
            if (serviceDetails) {
                 await base44.entities.EventService.create({
                    event_id: eventId,
                    service_id: serviceId,
                    custom_price: 0, // In package = 0
                    quantity: 1,
                    includes_vat: false,
                    service_description: serviceDetails.service_description || '',
                    parent_package_event_service_id: parentId,
                    is_package_main_item: false,
                    order_index: (mainPackageItem?.order_index || 0) + 1 // Add nicely after package
                });
            }
        }
      }

      setShowAddToPackageDialog(false);
      setSelectedServicesForPackage([]);
      setSelectedServicesForAction([]);
      setTargetPackageId('new');
      setNewPackageData({ name: '', description: '', price: '', includes_vat: false });
      await loadEventData();
    } catch (error) {
      console.error("Failed to add services to package:", error);
      alert("שגיאה בהוספת השירותים לחבילה");
    } finally {
      setIsAddingServicesToPackage(false);
    }
  }, [selectedServicesForPackage, eventServices, allServices, targetPackageId, newPackageData, eventId, loadEventData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-600">{error}</div>;
  }

  if (!event) {
    return <div className="text-center py-12">אירוע לא נמצא</div>;
  }

  // Filtered lists for dialogs (using debounced search terms)
  const filteredSuppliersForDialog = allSuppliers.filter(supplier =>
    supplier.supplier_name.toLowerCase().includes(debouncedSupplierSearch.toLowerCase())
  );

  const filteredServicesForPackage = allServices.filter(service =>
    service.service_name.toLowerCase().includes(debouncedPackageServiceSearch.toLowerCase())
  );

  const filteredServicesForAdd = allServices.filter(service =>
    service.service_name.toLowerCase().includes(debouncedAddServiceSearch.toLowerCase())
  );

  const filteredExistingPackages = allPackages.filter(pkg =>
    pkg.package_name.toLowerCase().includes(debouncedExistingPackageSearch.toLowerCase())
  );

  const filteredServicesForAddToPackage = availableServicesToAdd.filter(service =>
    service.service_name.toLowerCase().includes(debouncedAddToPackageSearch.toLowerCase())
  );

  return (
    <div className="p-2 sm:p-4 lg:p-8 w-full max-w-full overflow-x-hidden space-y-4 sm:space-y-6">
      {isAdmin && (
        <div className="flex gap-3 justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isGeneratingQuote || isGeneratingPdf}
                className="bg-red-800 hover:bg-red-700 text-white"
              >
                {(isGeneratingQuote || isGeneratingPdf) ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 ml-2" />
                )}
                הצעת מחיר
                <ChevronDown className="h-4 w-4 mr-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              {(() => {
                const hasIntroTemplate = event.concept && quoteTemplates.some(t => t.template_type === 'concept_intro' && t.identifier === event.concept);
                const hasPaymentTemplate = quoteTemplates.some(t => t.template_type === 'payment_terms');
                return (hasIntroTemplate || hasPaymentTemplate) ? (
                  <div className="flex items-center gap-3 px-2 py-1.5 border-b border-gray-100">
                    {hasIntroTemplate && (
                      <label className="flex items-center gap-1 cursor-pointer text-xs text-gray-600">
                        <Checkbox checked={quoteIncludeIntro} onCheckedChange={setQuoteIncludeIntro} className="h-3.5 w-3.5" />
                        <span>פתיח</span>
                      </label>
                    )}
                    {hasPaymentTemplate && (
                      <label className="flex items-center gap-1 cursor-pointer text-xs text-gray-600">
                        <Checkbox checked={quoteIncludePaymentTerms} onCheckedChange={setQuoteIncludePaymentTerms} className="h-3.5 w-3.5" />
                        <span>תנאי תשלום</span>
                      </label>
                    )}
                  </div>
                ) : null;
              })()}
              <DropdownMenuItem onClick={handleGenerateQuote} disabled={isGeneratingQuote}>
                <FileText className="h-4 w-4 ml-2" />
                הצג
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleGeneratePdf} disabled={isGeneratingPdf}>
                <Download className="h-4 w-4 ml-2" />
                ייצא כ-PDF
              </DropdownMenuItem>
              <DropdownMenuItem 
                onSelect={handleSmartShare} 
                className={shareStatus === 'ready' ? "bg-green-50 text-green-700 focus:bg-green-100 cursor-pointer" : "cursor-pointer"}
              >
                {shareStatus === 'initial' && <Share2 className="h-4 w-4 ml-2" />}
                {shareStatus === 'fetching' && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                {shareStatus === 'ready' && <Send className="h-4 w-4 ml-2" />}
                
                <span>
                    {shareStatus === 'initial' && "שתף הצעת מחיר"}
                    {shareStatus === 'fetching' && "מכין קובץ..."}
                    {shareStatus === 'ready' && "לחץ כאן לשליחה!"}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={handleExportEvent}
            variant="outline"
            className="border-amber-500 text-amber-700 hover:bg-amber-50"
          >
            <Download className="h-4 w-4 ml-2" />
            ייצא אירוע
          </Button>
        </div>
      )}

      <EventOverviewCard
        event={event}
        isAdmin={isAdmin}
        editingSection={editingSection}
        setEditingSection={setEditingSection}
        eventDetailsData={eventDetailsData}
        setEventDetailsData={setEventDetailsData}
        handleSaveEventDetails={handleSaveEventDetails}
        isSavingEventDetails={isSavingEventDetails}
        handleStatusChange={handleStatusChange}
        handleDeleteEvent={handleDeleteEvent}
      />

      <FamilyContactCard
        event={event}
        isAdmin={isAdmin}
        isClient={isClient}
        editingSection={editingSection}
        setEditingSection={setEditingSection}
        editableParents={editableParents}
        setEditableParents={setEditableParents}
        editableFamilyName={editableFamilyName}
        setEditableFamilyName={setEditableFamilyName}
        editableChildName={editableChildName}
        setEditableChildName={setEditableChildName}
        handleSaveFamilyDetails={handleSaveFamilyDetails}
        isSavingFamilyDetails={isSavingFamilyDetails}
      />

      <ScheduleCard
        event={event}
        isAdmin={isAdmin}
        editingSection={editingSection}
        setEditingSection={setEditingSection}
        editableSchedule={editableSchedule}
        setEditableSchedule={setEditableSchedule}
        handleSaveSchedule={handleSaveSchedule}
        isSavingSchedule={isSavingSchedule}
      />

      <ServicesCard
        event={event}
        eventServices={eventServices}
        allServices={allServices}
        allSuppliers={allSuppliers}
        groupedServices={groupedServices}
        isAdmin={isAdmin}
        isClient={isClient}
        isSupplier={isSupplier}
        currentSupplierId={currentSupplierId}
        editingSection={editingSection}
        setEditingSection={setEditingSection}
        editableServices={editableServices}
        setEditableServices={setEditableServices}
        allInclusiveData={allInclusiveData}
        setAllInclusiveData={setAllInclusiveData}
        handleSaveServices={handleSaveServices}
        isSavingServices={isSavingServices}
        selectedServicesForAction={selectedServicesForAction}
        setSelectedServicesForAction={setSelectedServicesForAction}
        handleDeleteSelectedServices={handleDeleteSelectedServices}
        setSelectedServicesForPackage={setSelectedServicesForPackage}
        setShowAddToPackageDialog={setShowAddToPackageDialog}
        setShowAddServiceDialog={setShowAddServiceDialog}
        setShowAddExistingPackageDialog={setShowAddExistingPackageDialog}
        setShowPackageDialog={setShowPackageDialog}
        handleDragEnd={handleDragEnd}
        handleOpenEditPackage={handleOpenEditPackage}
        handleOpenAddServiceToPackage={handleOpenAddServiceToPackage}
        handleDeletePackage={handleDeletePackage}
        updateSupplierStatus={updateSupplierStatus}
        handleRemoveSupplier={handleRemoveSupplier}
        handleUpdateSupplierNote={handleUpdateSupplierNote}
        loadEventData={loadEventData}
        savingServiceField={savingServiceField}
        setSavingServiceField={setSavingServiceField}
        handleUpdateServiceField={handleUpdateServiceField}
        setSelectedServiceForSupplier={setSelectedServiceForSupplier}
        setSupplierFormData={setSupplierFormData}
        setShowSupplierDialog={setShowSupplierDialog}
        handleRemoveFromPackage={handleRemoveFromPackage}
        handleDeleteService={handleDeleteService}
      />

      {(isAdmin || isClient) && (
        <PaymentsCard
          payments={payments}
          isAdmin={isAdmin}
          setShowPaymentDialog={setShowPaymentDialog}
          handleDeletePayment={handleDeletePayment}
          setCurrentReceiptUrl={setCurrentReceiptUrl}
          setCurrentReceiptPaymentId={setCurrentReceiptPaymentId}
          setShowReceiptDialog={setShowReceiptDialog}
        />
      )}

      {(isAdmin || isClient) && (
        <FinancialSummaryCard
          event={event}
          financials={financials}
          isAdmin={isAdmin}
          editingSection={editingSection}
          setEditingSection={setEditingSection}
          financialEditData={financialEditData}
          setFinancialEditData={setFinancialEditData}
          handleSaveFinancial={handleSaveFinancial}
          isSavingFinancial={isSavingFinancial}
        />
      )}

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ייצוא אירוע</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              {Object.keys(exportOptions).map(key => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    checked={exportOptions[key]}
                    onCheckedChange={(checked) => setExportOptions({ ...exportOptions, [key]: checked })}
                  />
                  <Label>{key === 'eventDetails' ? 'פרטי אירוע' : key === 'familyDetails' ? 'פרטי משפחה' : key === 'services' ? 'שירותים' : key === 'suppliers' ? 'ספקים' : key === 'payments' ? 'תשלומים' : key === 'financials' ? 'סיכום פיננסי' : 'הערות'}</Label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>ביטול</Button>
            <Button onClick={handleConfirmExport}>ייצא</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>הוספת תשלום</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>סכום</Label>
              <Input
                type="number"
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <Label>תאריך תשלום</Label>
              <Input
                type="date"
                value={paymentForm.payment_date}
                onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
              />
            </div>
            <div>
              <Label>אמצעי תשלום</Label>
              <Select value={paymentForm.payment_method} onValueChange={(value) => setPaymentForm({ ...paymentForm, payment_method: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">מזומן</SelectItem>
                  <SelectItem value="bank_transfer">העברה בנקאית</SelectItem>
                  <SelectItem value="check">צ'ק</SelectItem>
                  <SelectItem value="credit_card">כרטיס אשראי</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>הערות</Label>
              <Textarea
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                placeholder="הערות על התשלום (אופציונלי)"
              />
            </div>
            <div>
              <Label>אסמכתא (תמונה)</Label>
              <div className="space-y-2">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadReceipt}
                  disabled={uploadingReceipt}
                />
                {uploadingReceipt && (
                  <div className="text-sm text-gray-500 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>מעלה קובץ...</span>
                  </div>
                )}
                {paymentForm.receipt_image_url && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <FileText className="h-4 w-4" />
                    <span>אסמכתא הועלתה בהצלחה</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>ביטול</Button>
            <Button onClick={handleAddPayment} disabled={uploadingReceipt}>הוסף תשלום</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supplier Assignment Dialog */}
      <Dialog open={showSupplierDialog} onOpenChange={setShowSupplierDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>שיבוץ ספקים</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="חיפוש ספקים..."
                value={supplierSearchTerm}
                onChange={(e) => setSupplierSearchTerm(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredSuppliersForDialog.map(supplier => (
                <div key={supplier.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={supplierFormData.supplierIds.includes(supplier.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSupplierFormData({ ...supplierFormData, supplierIds: [...supplierFormData.supplierIds, supplier.id] });
                        } else {
                          const newNotes = { ...supplierFormData.notes };
                          delete newNotes[supplier.id];
                          setSupplierFormData({ 
                            ...supplierFormData, 
                            supplierIds: supplierFormData.supplierIds.filter(id => id !== supplier.id),
                            notes: newNotes
                          });
                        }
                      }}
                    />
                    <Label>{supplier.supplier_name}</Label>
                  </div>
                  {supplierFormData.supplierIds.includes(supplier.id) && (
                    <div className="mr-6">
                      <Label className="text-xs">הערה לספק</Label>
                      <Input
                        placeholder="הערה ספציפית לספק זה..."
                        value={supplierFormData.notes[supplier.id] || ''}
                        onChange={(e) => {
                          setSupplierFormData({
                            ...supplierFormData,
                            notes: {
                              ...supplierFormData.notes,
                              [supplier.id]: e.target.value
                            }
                          });
                        }}
                        className="text-sm"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowSupplierDialog(false); setSupplierSearchTerm(""); }}>ביטול</Button>
            <Button onClick={handleAssignSuppliers}>שמור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Package Dialog */}
      <Dialog open={showPackageDialog} onOpenChange={setShowPackageDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>יצירת חבילה חדשה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>שם החבילה</Label>
              <Input value={packageForm.package_name} onChange={(e) => setPackageForm({ ...packageForm, package_name: e.target.value })} />
            </div>
            <div>
              <Label>תיאור</Label>
              <Textarea value={packageForm.package_description} onChange={(e) => setPackageForm({ ...packageForm, package_description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>מחיר</Label>
                <Input type="number" value={packageForm.package_price} onChange={(e) => setPackageForm({ ...packageForm, package_price: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={packageForm.package_includes_vat} onCheckedChange={(checked) => setPackageForm({ ...packageForm, package_includes_vat: checked })} />
                <Label>כולל מע"מ</Label>
              </div>
            </div>
            <div>
              <Label>בחר שירותים</Label>
              <div className="relative mb-2">
                <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="חיפוש שירותים..."
                  value={packageServiceSearchTerm}
                  onChange={(e) => setPackageServiceSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
                {filteredServicesForPackage.map(service => (
                  <div key={service.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={packageForm.selectedServices.includes(service.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setPackageForm({ ...packageForm, selectedServices: [...packageForm.selectedServices, service.id] });
                        } else {
                          setPackageForm({ ...packageForm, selectedServices: packageForm.selectedServices.filter(id => id !== service.id) });
                        }
                      }}
                    />
                    <Label>{service.service_name}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowPackageDialog(false); setPackageServiceSearchTerm(""); }} disabled={isCreatingPackage}>ביטול</Button>
            <Button onClick={handleCreatePackage} className="bg-red-800 hover:bg-red-700" disabled={isCreatingPackage}>
              {isCreatingPackage ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  יוצר חבילה...
                </>
              ) : (
                'צור חבילה'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Package Dialog */}
      <Dialog open={showEditPackageDialog} onOpenChange={setShowEditPackageDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>עריכת פרטי חבילה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>שם החבילה</Label>
              <Input value={editPackageForm.package_name} onChange={(e) => setEditPackageForm({ ...editPackageForm, package_name: e.target.value })} />
            </div>
            <div>
              <Label>תיאור</Label>
              <Textarea value={editPackageForm.package_description} onChange={(e) => setEditPackageForm({ ...editPackageForm, package_description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>מחיר</Label>
                <Input type="number" value={editPackageForm.package_price} onChange={(e) => setEditPackageForm({ ...editPackageForm, package_price: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={editPackageForm.package_includes_vat} onCheckedChange={(checked) => setEditPackageForm({ ...editPackageForm, package_includes_vat: checked })} />
                <Label>כולל מע"מ</Label>
              </div>
            </div>
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm text-yellow-800">שינויים אלו יחולו רק על האירוע הנוכחי ולא ישנו את החבילה הגלובלית</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditPackageDialog(false)} disabled={isSavingPackageEdit}>ביטול</Button>
            <Button onClick={handleSavePackageEdit} className="bg-red-800 hover:bg-red-700" disabled={isSavingPackageEdit}>
              {isSavingPackageEdit ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  שומר...
                </>
              ) : (
                'שמור שינויים'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Service Dialog */}
      <Dialog open={showAddServiceDialog} onOpenChange={setShowAddServiceDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>הוספת שירותים</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>בחר שירותים להוספה</Label>
              <div className="relative mb-2">
                <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="חיפוש שירותים..."
                  value={addServiceSearchTerm}
                  onChange={(e) => setAddServiceSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-2">
                {filteredServicesForAdd.map(service => (
                  <div key={service.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedServicesToAdd.includes(service.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedServicesToAdd([...selectedServicesToAdd, service.id]);
                        } else {
                          setSelectedServicesToAdd(selectedServicesToAdd.filter(id => id !== service.id));
                        }
                      }}
                    />
                    <Label>{service.service_name}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddServiceDialog(false); setAddServiceSearchTerm(""); }} disabled={isAddingServices}>ביטול</Button>
            <Button onClick={handleAddStandaloneServices} className="bg-green-600 hover:bg-green-700" disabled={isAddingServices}>
              {isAddingServices ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  מוסיף...
                </>
              ) : (
                'הוסף שירותים'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Existing Package Dialog */}
      <Dialog open={showAddExistingPackageDialog} onOpenChange={setShowAddExistingPackageDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>הוספת חבילה קיימת</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>בחר חבילה להוספה</Label>
              <div className="relative mb-2">
                <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="חיפוש חבילות..."
                  value={existingPackageSearchTerm}
                  onChange={(e) => setExistingPackageSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-2">
                {filteredExistingPackages.map(pkg => (
                  <div key={pkg.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded">
                    <Checkbox
                      checked={selectedExistingPackage === pkg.id}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedExistingPackage(pkg.id);
                        } else {
                          setSelectedExistingPackage(null);
                        }
                      }}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{pkg.package_name}</div>
                      <div className="text-sm text-gray-600">
                        ₪{(pkg.package_price || 0).toLocaleString()} {pkg.package_includes_vat && '(כולל מע"מ)'}
                      </div>
                      {pkg.package_description && (
                        <div className="text-xs text-gray-500 mt-1">{pkg.package_description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddExistingPackageDialog(false); setExistingPackageSearchTerm(""); }} disabled={isAddingExistingPackage}>ביטול</Button>
            <Button onClick={handleAddExistingPackage} className="bg-purple-600 hover:bg-purple-700" disabled={!selectedExistingPackage || isAddingExistingPackage}>
              {isAddingExistingPackage ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  מוסיף...
                </>
              ) : (
                'הוסף חבילה'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to Package Dialog */}
      <Dialog open={showAddToPackageDialog} onOpenChange={setShowAddToPackageDialog}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>הוספת שירותים לחבילה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>בחר שירותים</Label>
              <div className="relative mb-2">
                <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="חיפוש שירותים..."
                  value={addToPackageSearchTerm}
                  onChange={(e) => setAddToPackageSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
                {filteredServicesForAddToPackage.map(service => (
                  <div key={service.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedServicesForPackage.includes(service.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedServicesForPackage([...selectedServicesForPackage, service.id]);
                        } else {
                          setSelectedServicesForPackage(selectedServicesForPackage.filter(id => id !== service.id));
                        }
                      }}
                    />
                    <Label>{service.service_name}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>בחר חבילה</Label>
              <Select value={targetPackageId} onValueChange={setTargetPackageId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">חבילה חדשה</SelectItem>
                  {groupedServices.packages.map(pkg => (
                    <SelectItem key={pkg.package_id} value={pkg.package_id}>
                      {pkg.package_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {targetPackageId === 'new' && (
              <>
                <div>
                  <Label>שם החבילה</Label>
                  <Input
                    value={newPackageData.name}
                    onChange={(e) => setNewPackageData({ ...newPackageData, name: e.target.value })}
                    placeholder="שם החבילה החדשה"
                  />
                </div>
                <div>
                  <Label>תיאור החבילה</Label>
                  <Textarea
                    value={newPackageData.description}
                    onChange={(e) => setNewPackageData({ ...newPackageData, description: e.target.value })}
                    placeholder="תיאור החבילה (אופציונלי)"
                  />
                </div>
                <div>
                  <Label>מחיר החבילה</Label>
                  <Input
                    type="number"
                    value={newPackageData.price}
                    onChange={(e) => setNewPackageData({ ...newPackageData, price: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <Checkbox
                    id="new-package-vat"
                    checked={newPackageData.includes_vat}
                    onCheckedChange={(checked) => setNewPackageData({ ...newPackageData, includes_vat: checked })}
                  />
                  <Label htmlFor="new-package-vat">כולל מע"מ</Label>
                </div>
                
                <div className="flex items-center gap-2 mt-4 p-3 bg-blue-50 rounded-md border border-blue-100">
                    <Checkbox
                      id="save-global"
                      checked={saveGlobalPackage}
                      onCheckedChange={setSaveGlobalPackage}
                    />
                    <div className="flex flex-col">
                      <Label htmlFor="save-global" className="cursor-pointer font-medium text-blue-900">שמור כתבנית גלובלית</Label>
                      <span className="text-xs text-blue-700">החבילה תישמר ותהיה זמינה לשימוש באירועים עתידיים</span>
                    </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddToPackageDialog(false); setAddToPackageSearchTerm(""); }} disabled={isAddingServicesToPackage}>ביטול</Button>
            <Button onClick={() => handleAddServicesToPackage(saveGlobalPackage)} className="bg-red-800 hover:bg-red-700" disabled={isAddingServicesToPackage}>
              {isAddingServicesToPackage ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  מוסיף...
                </>
              ) : (
                'הוסף לחבילה'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Add Service to Package Dialog */}
      <Dialog open={showAddServiceToPackageDialog} onOpenChange={setShowAddServiceToPackageDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>הוסף שירות לחבילה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>בחר שירותים</Label>
              <div className="relative mb-2">
                <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="חיפוש שירותים..."
                  value={addToPackageSearchTerm}
                  onChange={(e) => setAddToPackageSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-2">
                {filteredServicesForAddToPackage.map(service => (
                  <div key={service.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedServiceToAdd.includes(service.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedServiceToAdd([...selectedServiceToAdd, service.id]);
                        } else {
                          setSelectedServiceToAdd(selectedServiceToAdd.filter(id => id !== service.id));
                        }
                      }}
                    />
                    <Label>{service.service_name}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddServiceToPackageDialog(false); setAddToPackageSearchTerm(""); }} disabled={isAddingServiceToPackage}>ביטול</Button>
            <Button onClick={handleAddServiceToExistingPackage} className="bg-red-800 hover:bg-red-700" disabled={isAddingServiceToPackage}>
              {isAddingServiceToPackage ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  מוסיף...
                </>
              ) : (
                'הוסף שירות'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt Dialog */}
      <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>צפייה באסמכתא</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {currentReceiptUrl && (
              <img 
                src={currentReceiptUrl} 
                alt="אסמכתת תשלום" 
                className="w-full h-auto max-h-[70vh] object-contain"
              />
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowReceiptDialog(false)}>סגור</Button>
            {isAdmin && (
              <Button 
                variant="destructive" 
                onClick={() => handleDeleteReceipt(currentReceiptPaymentId)}
              >
                <Trash2 className="h-4 w-4 ml-2" />
                מחק אסמכתא
              </Button>
            )}
            <Button asChild>
              <a href={currentReceiptUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 ml-2" />
                הורד
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}