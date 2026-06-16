import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { FileText, Loader2, Download, Trash2, ChevronDown, Share2, Send, Clock, Edit3 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportDialog, PaymentDialog, SupplierAssignDialog, PackageDialog, EditPackageDialog, AddServiceDialog, AddExistingPackageDialog, AddToPackageDialog, AddServiceToPackageDialog, ReceiptDialog } from '../components/event-details/EventDetailDialogs';
import { createPageUrl } from '@/utils';
import { calculateEventFinancials } from '@/components/utils/eventFinancials';
import QuoteHistoryPanel from '../components/event-details/QuoteHistoryPanel';
import EventChangeDecisionDialogs from '../components/event-details/EventChangeDecisionDialogs';
import EventDetailsTabs from '../components/event-details/EventDetailsTabs';
import { useQuoteShare } from '../components/event-details/useQuoteShare';
import { useEventExport } from '../components/event-details/useEventExport';

// Helper: When merging server data with local state, preserve local values
// for fields that may differ from server (user is actively editing them)
function getLocalOverrides(localService, serverService) {
  const overrides = {};
  // Preserve local transport/text fields if they differ from server
  const fieldsToPreserve = [
    'pickup_point', 'standing_time', 'supplier_arrival_time', 'on_site_contact_details',
    'service_description', 'client_notes', 'notes'
  ];
  for (const field of fieldsToPreserve) {
    const localVal = localService[field];
    const serverVal = serverService[field];
    // If local value exists and differs from server, keep local
    if (localVal !== undefined && JSON.stringify(localVal) !== JSON.stringify(serverVal)) {
      overrides[field] = localVal;
    }
  }
  return overrides;
}

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

  const [isGeneratingQuote, setIsGeneratingQuote] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [showQuoteHistory, setShowQuoteHistory] = useState(false);
  const [quoteIncludeIntro, setQuoteIncludeIntro] = useState(null); // null = not initialized yet
  const [quoteIncludePaymentTerms, setQuoteIncludePaymentTerms] = useState(null);
  const [quoteIncludeSchedule, setQuoteIncludeSchedule] = useState(null);
  const [quoteIncludeExternalServices, setQuoteIncludeExternalServices] = useState(null);

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    currency: '',
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
  const [currentReceiptUrl, setCurrentReceiptUrl] = useState('');  const [currentReceiptPaymentId, setCurrentReceiptPaymentId] = useState(null);

  const [editingServiceField, setEditingServiceField] = useState(null);
  const [savingServiceField, setSavingServiceField] = useState(null);

  // Dialog state for supplier_arrival_time changes on a specific EventService
  const [arrivalTimeChangeDialog, setArrivalTimeChangeDialog] = useState(null); // { eventServiceId, serviceName, oldArrivalTime, newArrivalTime } | null

  // Debouncing effects for search terms
  useEffect(() => { const t = setTimeout(() => setDebouncedSupplierSearch(supplierSearchTerm), 300); return () => clearTimeout(t); }, [supplierSearchTerm]);
  useEffect(() => { const t = setTimeout(() => setDebouncedPackageServiceSearch(packageServiceSearchTerm), 300); return () => clearTimeout(t); }, [packageServiceSearchTerm]);
  useEffect(() => { const t = setTimeout(() => setDebouncedAddToPackageSearch(addToPackageSearchTerm), 300); return () => clearTimeout(t); }, [addToPackageSearchTerm]);
  useEffect(() => { const t = setTimeout(() => setDebouncedAddServiceSearch(addServiceSearchTerm), 300); return () => clearTimeout(t); }, [addServiceSearchTerm]);
  useEffect(() => { const t = setTimeout(() => setDebouncedExistingPackageSearch(existingPackageSearchTerm), 300); return () => clearTimeout(t); }, [existingPackageSearchTerm]);

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
    if (event && quoteIncludeSchedule === null) {
      setQuoteIncludeSchedule(!!(event.schedule && event.schedule.length > 0));
    }
    if (event && quoteIncludeExternalServices === null) {
      // Default: include external services if they exist
      const hasExternalServices = eventServices.some(es => es.is_external);
      setQuoteIncludeExternalServices(hasExternalServices);
    }
  }, [event, quoteTemplates, quoteIncludeSchedule, quoteIncludeIntro, quoteIncludePaymentTerms, quoteIncludeExternalServices, eventServices]);

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
  // Use a ref to track if this is the first load or a user-triggered reload (loadEventData)
  const editableServicesInitRef = React.useRef(false);
  useEffect(() => {
    if (eventServices && eventServices.length > 0) {
      setEditableServices(prev => {
        // On first load or when service count changes (add/delete), fully replace
        if (!editableServicesInitRef.current || prev.length !== eventServices.length) {
          editableServicesInitRef.current = true;
          return eventServices.map(s => ({ ...s }));
        }
        // On background refresh, merge server data but preserve locally-edited fields
        // that the user might be actively editing (transport fields, descriptions, etc.)
        return prev.map(prevService => {
          const serverService = eventServices.find(s => s.id === prevService.id);
          if (!serverService) return prevService;
          // Use server data as base, but keep local overrides for fields that might be mid-edit
          return { ...serverService, ...getLocalOverrides(prevService, serverService) };
        });
      });
    } else {
      editableServicesInitRef.current = false;
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

  // Helper to group services into packages/standalone (reused for both included and external)
  const buildGroupedServices = useCallback((servicesToUse) => {
    const servicesSorted = [...servicesToUse].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    const packagesMap = new Map();
    const standalone = [];
    
    // First pass: Identify main package items and legacy packages
    servicesSorted.forEach(es => {
      if (es.is_package_main_item) {
        packagesMap.set(es.id, {
          package_id: es.id,
          package_name: es.package_name || 'חבילה',
          package_price: es.custom_price || 0,
          package_includes_vat: es.includes_vat || false,
          package_description: es.package_description || es.service_description || '',
          services: [],
          order_index: es.order_index,
          main_item: es
        });
      } else if (es.package_id && !es.parent_package_event_service_id) {
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
      if (es.is_package_main_item) return;

      if (es.parent_package_event_service_id && packagesMap.has(es.parent_package_event_service_id)) {
        packagesMap.get(es.parent_package_event_service_id).services.push(es);
      } else if (es.package_id && packagesMap.has(es.package_id) && !es.parent_package_event_service_id) {
        packagesMap.get(es.package_id).services.push(es);
      } else {
        standalone.push(es);
      }
    });

    const packagesWithServices = Array.from(packagesMap.values()).map(pkg => {
        if (pkg.order_index === Infinity) {
             pkg.order_index = Math.min(...pkg.services.map(s => s.order_index || 0));
        }
        pkg.services.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        return pkg;
    }).sort((a, b) => a.order_index - b.order_index);

    standalone.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    return { packages: packagesWithServices, standalone };
  }, []);

  const groupedServices = useMemo(() => {
    const servicesToUse = isSupplier ? filteredServicesForSupplier : eventServices;

    // Suppliers see only their assigned services as flat list - no package grouping, no external split
    if (isSupplier) {
      const servicesSorted = [...servicesToUse].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      return { packages: [], standalone: servicesSorted };
    }

    // Filter to only included (non-external) services
    const includedServices = servicesToUse.filter(es => !es.is_external);
    return buildGroupedServices(includedServices);
  }, [eventServices, isSupplier, filteredServicesForSupplier, buildGroupedServices]);

  const groupedExternalServices = useMemo(() => {
    if (isSupplier) return { packages: [], standalone: [] };
    const externalServices = eventServices.filter(es => es.is_external);
    return buildGroupedServices(externalServices);
  }, [eventServices, isSupplier, buildGroupedServices]);

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
    const rS = appSettings.find(s => s.setting_key === 'usd_ils_exchange_rate');
    return calculateEventFinancials(eventForCalculation, servicesForCalculation, payments, vatRate, rS ? parseFloat(rS.setting_value) || 3.6 : 3.6);
  }, [eventForCalculation, servicesForCalculation, payments, appSettings]);

  const handleStatusChange = useCallback(async (newStatus) => {
    try {
      await base44.entities.Event.update(eventId, { status: newStatus });
      
      await base44.functions.invoke('checkEventStatus', { 
          eventId: eventId,
          event: { ...event, status: newStatus },
          eventServices: eventServices
      }).catch(console.error);
      await loadEventData();
    } catch (error) {
      console.error("Failed to update status:", error);
      alert("שגיאה בעדכון סטטוס האירוע");
    }
  }, [eventId, loadEventData]);

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
      const dataToSave = { ...eventDetailsData };
      // If dynamic fields were edited, save them as custom_organizer_fields JSON
      if (dataToSave._customFields) {
        dataToSave.custom_organizer_fields = JSON.stringify(dataToSave._customFields);
        delete dataToSave._customFields;
      }
      await base44.entities.Event.update(eventId, dataToSave);
      setEditingSection(null);
      await loadEventData();
    } catch (error) {
      console.error("Failed to save event details:", error);
      alert("שגיאה בשמירת פרטי האירוע");
    } finally {
      setIsSavingEventDetails(false);
    }
  }, [eventId, eventDetailsData, loadEventData]);

  const handleSaveFamilyDetails = useCallback(async (orgContacts) => {
    setIsSavingFamilyDetails(true);
    try {
      const updateData = { 
        parents: editableParents,
        family_name: editableFamilyName,
        child_name: editableChildName
      };
      if (orgContacts !== undefined) {
        updateData.organizer_contacts = JSON.stringify(orgContacts.filter(c => c.name || c.phone || c.email));
      }
      await base44.entities.Event.update(eventId, updateData);
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
        discount_type: financialEditData.discount_type || 'fixed',
        total_override: parseFloat(financialEditData.total_override) || null,
        total_override_includes_vat: financialEditData.total_override_includes_vat,
        is_price_per_guest: financialEditData.is_price_per_guest || false,
        price_per_guest: parseFloat(financialEditData.price_per_guest) || null
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
        currency: paymentForm.currency || event?.primary_currency || 'ILS',
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
        currency: '',
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

      supplierStatuses[supplierId] = newStatus;
      const updateData = { supplier_statuses: JSON.stringify(supplierStatuses) };
      if (newStatus === 'rejected') {
        let declined = [];
        try { declined = JSON.parse(eventService.declined_suppliers || '[]'); } catch(e) { declined = []; }
        if (!Array.isArray(declined)) declined = [];
        if (!declined.some(d => d.supplier_id === supplierId)) {
          declined.push({ supplier_id: supplierId, declined_date: new Date().toISOString(), reason: '' });
          updateData.declined_suppliers = JSON.stringify(declined);
        }
      }
      await base44.entities.EventService.update(eventServiceId, updateData);
      
      const updatedEventServices = eventServices.map(es => 
          es.id === eventServiceId ? { ...es, ...updateData } : es
      );

      await base44.functions.invoke('checkEventStatus', { 
          eventId: eventId,
          event: event,
          eventServices: updatedEventServices
      }).catch(console.error);
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
      
      const updatedEventServices = eventServices.map(es => 
          es.id === eventServiceId ? { 
              ...es, 
              supplier_ids: JSON.stringify(supplierIds),
              supplier_statuses: JSON.stringify(supplierStatuses)
          } : es
      );

      await base44.functions.invoke('checkEventStatus', { 
          eventId: eventId,
          event: event,
          eventServices: updatedEventServices
      }).catch(console.error);
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

      // For supplier_arrival_time changes: if value really changed AND the service has assigned
      // suppliers, capture the previous value so we can prompt the admin AFTER saving.
      let arrivalTimeChangeContext = null;
      if (field === 'supplier_arrival_time' && isAdmin) {
        const currentService = eventServices.find(s => s.id === serviceId);
        if (currentService) {
          const oldVal = (currentService.supplier_arrival_time || '').trim();
          const newVal = (value || '').trim();
          if (oldVal !== newVal) {
            let supplierIds = [];
            try {
              supplierIds = typeof currentService.supplier_ids === 'string'
                ? JSON.parse(currentService.supplier_ids || '[]')
                : (Array.isArray(currentService.supplier_ids) ? currentService.supplier_ids : []);
            } catch (e) { supplierIds = []; }
            if (Array.isArray(supplierIds) && supplierIds.length > 0) {
              const svcDetails = allServices.find(s => s.id === currentService.service_id);
              arrivalTimeChangeContext = {
                eventServiceId: serviceId,
                serviceName: svcDetails?.service_name || 'שירות',
                oldArrivalTime: oldVal,
                newArrivalTime: newVal
              };
            }
          }
        }
      }

      await base44.entities.EventService.update(serviceId, updateData);
      base44.functions.invoke('checkEventStatus', { 
          eventId: eventId,
          event: event,
          eventServices: eventServices.map(es => es.id === serviceId ? { ...es, ...updateData } : es)
      }).catch(console.error);
      
      // Update the local editableServices state directly instead of refetching from server.
      // This prevents overwriting user's in-progress edits on other fields.
      setEditableServices(prev => prev.map(s => 
        s.id === serviceId ? { ...s, ...updateData } : s
      ));
      
      // Silently refresh the query cache in the background without triggering re-render of editableServices
      queryClient.invalidateQueries({ queryKey: ['eventServices', eventId] });
      
      setEditingServiceField(null);

      // Open the supplier arrival time decision dialog AFTER the save succeeded.
      if (arrivalTimeChangeContext) {
        setArrivalTimeChangeDialog(arrivalTimeChangeContext);
      }
    } catch (error) {
      console.error(`Failed to update ${field}:`, error);
      alert(`שגיאה בעדכון ${field}`);
    } finally {
      setSavingServiceField(null);
    }
  }, [eventId, queryClient, eventServices, allServices, isAdmin]);

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
            serviceName: serviceDetails?.service_name || 'שירות',
            eventServiceId: selectedServiceForSupplier.id
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
    // For new structure, get the currency from the main package item
    let pkgCurrency = undefined;
    if (pkg.is_new_structure) {
      const mainItem = eventServices.find(s => s.id === pkg.package_id);
      pkgCurrency = mainItem?.currency;
    }
    setEditPackageForm({
      package_name: pkg.package_name,
      package_description: pkg.package_description || '',
      package_price: pkg.package_price || '',
      package_includes_vat: pkg.package_includes_vat || false,
      package_currency: pkgCurrency
    });
    setShowEditPackageDialog(true);
  }, [eventServices]);

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
            updates.currency = editPackageForm.package_currency || undefined;
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
            updates.currency = editPackageForm.package_currency || undefined;
        }

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
      if (!eventServices.find(es => es.id === serviceId)) return;
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

  const handleToggleServiceExternal = useCallback(async (serviceId, makeExternal) => {
    try {
      await base44.entities.EventService.update(serviceId, { is_external: makeExternal });
      // Update local state immediately
      setEditableServices(prev => prev.map(s => 
        s.id === serviceId ? { ...s, is_external: makeExternal } : s
      ));
      queryClient.invalidateQueries({ queryKey: ['eventServices', eventId] });
    } catch (error) {
      console.error("Failed to toggle service external status:", error);
      alert("שגיאה בעדכון סטטוס השירות");
    }
  }, [eventId, queryClient]);

  const handleSaveExternalServicesTitle = useCallback(async (title) => {
    try {
      await base44.entities.Event.update(eventId, { external_services_title: title });
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    } catch (error) {
      console.error("Failed to save external services title:", error);
    }
  }, [eventId, queryClient]);

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
      const response = await base44.functions.invoke('generateQuote', { eventId, includeIntro: quoteIncludeIntro, includePaymentTerms: quoteIncludePaymentTerms, includeSchedule: quoteIncludeSchedule, includeExternalServices: quoteIncludeExternalServices });
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
  }, [eventId, quoteIncludeIntro, quoteIncludePaymentTerms, quoteIncludeSchedule]);

  const handleGeneratePdf = useCallback(async () => {
    setIsGeneratingPdf(true);
    try {
      const response = await base44.functions.invoke('generateQuotePdf', { eventId, includeIntro: quoteIncludeIntro, includePaymentTerms: quoteIncludePaymentTerms, includeSchedule: quoteIncludeSchedule, includeExternalServices: quoteIncludeExternalServices });
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

      // Refresh event data to update quote history
      loadEventData();
      
    } catch (error) {
      console.error("Failed to generate PDF:", error);
      alert("שגיאה ביצירת קובץ ה-PDF: " + (error.response?.data?.error || error.message));
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [eventId, event, quoteIncludeIntro, quoteIncludePaymentTerms, quoteIncludeSchedule, loadEventData]);

  // Two-step share flow: prepare PDF first, then share on a separate click.
  // This satisfies browser "user activation" requirements on iOS & Android.
  const { shareStatus, handlePrepareShare, handleDoShare } = useQuoteShare({
    eventId,
    event,
    quoteIncludeIntro,
    quoteIncludePaymentTerms,
    quoteIncludeSchedule,
    quoteIncludeExternalServices,
    loadEventData
  });

  const { showExportDialog, setShowExportDialog, exportOptions, setExportOptions, handleExportEvent, handleConfirmExport } = useEventExport({
    event, eventServices, allServices, allSuppliers, payments, financials
  });

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
                const hasSchedule = event?.schedule?.length > 0;
                const hasExternalServices = eventServices.some(es => es.is_external);
                return (hasIntroTemplate || hasPaymentTemplate || hasSchedule || hasExternalServices) ? (
                  <div className="flex items-center gap-3 px-2 py-1.5 border-b border-gray-100 flex-wrap">
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
                    {hasSchedule && (
                      <label className="flex items-center gap-1 cursor-pointer text-xs text-gray-600">
                        <Checkbox checked={quoteIncludeSchedule} onCheckedChange={setQuoteIncludeSchedule} className="h-3.5 w-3.5" />
                        <span>לו"ז</span>
                      </label>
                    )}
                    {hasExternalServices && (
                      <label className="flex items-center gap-1 cursor-pointer text-xs text-gray-600">
                        <Checkbox checked={quoteIncludeExternalServices} onCheckedChange={setQuoteIncludeExternalServices} className="h-3.5 w-3.5" />
                        <span>שירותים חיצוניים</span>
                      </label>
                    )}
                  </div>
                ) : null;
              })()}
              <DropdownMenuItem onClick={handleGenerateQuote} disabled={isGeneratingQuote}>
                <FileText className="h-4 w-4 ml-2" />
                הצג
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleGeneratePdf} disabled={isGeneratingPdf}><Download className="h-4 w-4 ml-2" />ייצא כ-PDF</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={shareStatus === 'ready' ? handleDoShare : handlePrepareShare}
                disabled={shareStatus === 'fetching'}
                className="cursor-pointer"
              >
                {shareStatus === 'fetching'
                  ? <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  : <Share2 className={`h-4 w-4 ml-2 ${shareStatus === 'ready' ? 'text-green-600' : ''}`} />}
                <span className={shareStatus === 'ready' ? 'font-semibold text-green-700' : ''}>
                  {shareStatus === 'fetching'
                    ? 'מכין מסמך...'
                    : shareStatus === 'ready'
                      ? 'המסמך מוכן — לחץ לשיתוף'
                      : 'שתף הצעת מחיר'}
                </span>
              </DropdownMenuItem>
              <div className="border-t border-gray-100 my-1" />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); navigate(`${createPageUrl('ManualQuoteEditor')}?fromEventId=${eventId}&includeIntro=${quoteIncludeIntro}&includePaymentTerms=${quoteIncludePaymentTerms}&includeSchedule=${quoteIncludeSchedule}`); }} className="cursor-pointer">
                <Edit3 className="h-4 w-4 ml-2" /><span>צור הצעה רגילה עם התאמות</span>
              </DropdownMenuItem>
              {event.quote_history && event.quote_history.length > 0 && (
                <>
                  <div className="border-t border-gray-100 my-1" />
                  <DropdownMenuItem 
                    onSelect={(e) => { e.preventDefault(); setShowQuoteHistory(prev => !prev); }}
                    className="cursor-pointer"
                  >
                    <Clock className="h-4 w-4 ml-2" />
                    <span>היסטוריה ({event.quote_history.length})</span>
                  </DropdownMenuItem>
                  {showQuoteHistory && (
                    <QuoteHistoryPanel 
                      quoteHistory={event.quote_history} 
                      onClose={() => setShowQuoteHistory(false)}
                      onDelete={async (item) => {
                        const updated = (event.quote_history || []).filter(q => q.file_uri !== item.file_uri || q.created_at !== item.created_at);
                        await base44.entities.Event.update(eventId, { quote_history: updated });
                        await loadEventData();
                      }}
                    />
                  )}
                </>
              )}
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

      <EventDetailsTabs
        event={event}
        isAdmin={isAdmin}
        isClient={isClient}
        isSupplier={isSupplier}
        currentUser={user}
        tasksSystemEnabled={(() => { const s = appSettings.find(x => x.setting_key === 'tasks_system_enabled'); return !s || s.setting_value !== 'false'; })()}
        editingSection={editingSection}
        setEditingSection={setEditingSection}
        eventDetailsData={eventDetailsData}
        setEventDetailsData={setEventDetailsData}
        handleSaveEventDetails={handleSaveEventDetails}
        isSavingEventDetails={isSavingEventDetails}
        handleStatusChange={handleStatusChange}
        handleDeleteEvent={handleDeleteEvent}
        editableParents={editableParents}
        setEditableParents={setEditableParents}
        editableFamilyName={editableFamilyName}
        setEditableFamilyName={setEditableFamilyName}
        editableChildName={editableChildName}
        setEditableChildName={setEditableChildName}
        handleSaveFamilyDetails={handleSaveFamilyDetails}
        isSavingFamilyDetails={isSavingFamilyDetails}
        editableSchedule={editableSchedule}
        setEditableSchedule={setEditableSchedule}
        handleSaveSchedule={handleSaveSchedule}
        isSavingSchedule={isSavingSchedule}
        eventServices={eventServices}
        allServices={allServices}
        allSuppliers={allSuppliers}
        groupedServices={groupedServices}
        currentSupplierId={currentSupplierId}
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
        handleToggleServiceExternal={handleToggleServiceExternal}
        groupedExternalServices={groupedExternalServices}
        handleSaveExternalServicesTitle={handleSaveExternalServicesTitle}
        exchangeRate={(() => { const r = appSettings.find(s => s.setting_key === 'usd_ils_exchange_rate'); return r ? parseFloat(r.setting_value) || 3.6 : 3.6; })()}
        onPrimaryCurrencyChange={isAdmin ? async (c, updateEvent) => { await base44.entities.Event.update(eventId, updateEvent || { primary_currency: c }); await loadEventData(); } : undefined}
        payments={payments}
        setShowPaymentDialog={setShowPaymentDialog}
        handleDeletePayment={handleDeletePayment}
        setCurrentReceiptUrl={setCurrentReceiptUrl}
        setCurrentReceiptPaymentId={setCurrentReceiptPaymentId}
        setShowReceiptDialog={setShowReceiptDialog}
        financials={financials}
        financialEditData={financialEditData}
        setFinancialEditData={setFinancialEditData}
        handleSaveFinancial={handleSaveFinancial}
        isSavingFinancial={isSavingFinancial}
      />

      <ExportDialog open={showExportDialog} onOpenChange={setShowExportDialog} exportOptions={exportOptions} setExportOptions={setExportOptions} onConfirmExport={handleConfirmExport} />
      <PaymentDialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog} paymentForm={paymentForm} setPaymentForm={setPaymentForm} onAddPayment={handleAddPayment} onUploadReceipt={handleUploadReceipt} uploadingReceipt={uploadingReceipt} eventPrimaryCurrency={event?.primary_currency || 'ILS'} exchangeRate={(() => { const r = appSettings.find(s => s.setting_key === 'usd_ils_exchange_rate'); return r ? parseFloat(r.setting_value) || 3.6 : 3.6; })()} />
      <SupplierAssignDialog open={showSupplierDialog} onOpenChange={setShowSupplierDialog} searchTerm={supplierSearchTerm} setSearchTerm={setSupplierSearchTerm} filteredSuppliers={filteredSuppliersForDialog} formData={supplierFormData} setFormData={setSupplierFormData} onAssign={handleAssignSuppliers} />
      <PackageDialog open={showPackageDialog} onOpenChange={setShowPackageDialog} form={packageForm} setForm={setPackageForm} searchTerm={packageServiceSearchTerm} setSearchTerm={setPackageServiceSearchTerm} filteredServices={filteredServicesForPackage} isCreating={isCreatingPackage} onCreate={handleCreatePackage} />
      <EditPackageDialog open={showEditPackageDialog} onOpenChange={setShowEditPackageDialog} form={editPackageForm} setForm={setEditPackageForm} isSaving={isSavingPackageEdit} onSave={handleSavePackageEdit} primaryCurrency={event?.primary_currency || 'ILS'} exchangeRate={(() => { const r = appSettings.find(s => s.setting_key === 'usd_ils_exchange_rate'); return r ? parseFloat(r.setting_value) || 3.6 : 3.6; })()} />
      <AddServiceDialog open={showAddServiceDialog} onOpenChange={setShowAddServiceDialog} searchTerm={addServiceSearchTerm} setSearchTerm={setAddServiceSearchTerm} filteredServices={filteredServicesForAdd} selected={selectedServicesToAdd} setSelected={setSelectedServicesToAdd} isAdding={isAddingServices} onAdd={handleAddStandaloneServices} />
      <AddExistingPackageDialog open={showAddExistingPackageDialog} onOpenChange={setShowAddExistingPackageDialog} searchTerm={existingPackageSearchTerm} setSearchTerm={setExistingPackageSearchTerm} filteredPackages={filteredExistingPackages} selected={selectedExistingPackage} setSelected={setSelectedExistingPackage} isAdding={isAddingExistingPackage} onAdd={handleAddExistingPackage} />
      <AddToPackageDialog open={showAddToPackageDialog} onOpenChange={setShowAddToPackageDialog} searchTerm={addToPackageSearchTerm} setSearchTerm={setAddToPackageSearchTerm} filteredServices={filteredServicesForAddToPackage} selectedServices={selectedServicesForPackage} setSelectedServices={setSelectedServicesForPackage} targetPackageId={targetPackageId} setTargetPackageId={setTargetPackageId} groupedPackages={groupedServices.packages} newPackageData={newPackageData} setNewPackageData={setNewPackageData} saveGlobalPackage={saveGlobalPackage} setSaveGlobalPackage={setSaveGlobalPackage} isAdding={isAddingServicesToPackage} onAdd={handleAddServicesToPackage} />
      <AddServiceToPackageDialog open={showAddServiceToPackageDialog} onOpenChange={setShowAddServiceToPackageDialog} searchTerm={addToPackageSearchTerm} setSearchTerm={setAddToPackageSearchTerm} filteredServices={filteredServicesForAddToPackage} selected={selectedServiceToAdd} setSelected={setSelectedServiceToAdd} isAdding={isAddingServiceToPackage} onAdd={handleAddServiceToExistingPackage} />
      <ReceiptDialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog} receiptUrl={currentReceiptUrl} paymentId={currentReceiptPaymentId} isAdmin={isAdmin} onDeleteReceipt={handleDeleteReceipt} />
      <EventChangeDecisionDialogs
        isAdmin={isAdmin}
        event={event}
        loadEventData={loadEventData}
        arrivalTimeChangeDialog={arrivalTimeChangeDialog}
        setArrivalTimeChangeDialog={setArrivalTimeChangeDialog}
      />
    </div>
  );
}