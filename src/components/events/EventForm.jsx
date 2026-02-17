import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from 'react-router-dom';
import { base44 } from "@/api/base44Client";
import { Service } from "@/entities/Service";
import { Supplier } from "@/entities/Supplier";
import { Package } from "@/entities/Package";
import { AppSettings } from "@/entities/AppSettings";
import { Event } from "@/entities/Event";
import { EventService } from "@/entities/EventService";
import { Payment } from "@/entities/Payment";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { X, Save, Plus, Trash2, Clock, Loader2, GripVertical, Copy, Check, ClipboardPaste, Sparkles } from "lucide-react";
import { format } from "date-fns";
import EventServicesManager from "./EventServicesManager";
import PaymentManager from "./PaymentManager";
import ContactPicker from "../ui/ContactPicker";
import { calculateEventFinancials } from "@/components/utils/eventFinancials";
import { createPageUrl } from '@/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuoteTemplate } from "@/entities/QuoteTemplate";

export default function EventForm({ isOpen, onClose, onSave, event, initialDate }) {
  const [allServices, setAllServices] = useState([]);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [allPackages, setAllPackages] = useState([]);
  const [conceptDefaults, setConceptDefaults] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [existingConcepts, setExistingConcepts] = useState([]);
  const [isManualConcept, setIsManualConcept] = useState(false);
  const [importText, setImportText] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // פונקציית העתקה ללוח
  const copyToClipboard = () => {
    if (!formData.schedule) return;
    const text = formData.schedule
      .map(item => `• ${item.time ? item.time + ' - ' : ''}${item.activity}`)
      .join('\n');
    
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // פונקציית ניתוח טקסט חכם (מזהה מספר פעילויות בשורה אחת)
  const processBulkImport = () => {
    const lines = importText.split('\n').filter(line => line.trim() !== "");
    const allParsedItems = [];

    lines.forEach(line => {
      const timeRegex = /(\d{1,2})[\.:](\d{2})/g;
      let match;
      const matches = [];

      while ((match = timeRegex.exec(line)) !== null) {
        matches.push({
          fullMatch: match[0],
          hours: match[1],
          minutes: match[2],
          index: match.index
        });
      }

      if (matches.length === 0) {
        const cleanActivity = line.replace(/^[^a-zA-Z0-9א-ת]+/, '').trim();
        if (cleanActivity) {
          allParsedItems.push({ time: "", activity: cleanActivity, notes: "" });
        }
      } else {
        for (let i = 0; i < matches.length; i++) {
          const currentTime = matches[i];
          const nextTime = matches[i + 1];
          const formattedTime = `${currentTime.hours.padStart(2, '0')}:${currentTime.minutes}`;
          const startPos = currentTime.index + currentTime.fullMatch.length;
          const endPos = nextTime ? nextTime.index : line.length;
          let activity = line.substring(startPos, endPos).trim();
          activity = activity.replace(/^[^a-zA-Z0-9א-ת]+/, '').trim();
          allParsedItems.push({ 
            time: formattedTime, 
            activity: activity || "פעילות חדשה", 
            notes: "" 
          });
        }
      }
    });

    setFormData(prev => ({
      ...prev,
      schedule: [...prev.schedule, ...allParsedItems]
    }));
    setImportText("");
    setIsImportOpen(false);
  };

  const [formData, setFormData] = useState({
    event_name: "",
    event_type: "bar_mitzvah",
    event_date: "",
    event_time: "",
    location: "",
    concept: "",
    family_name: "",
    child_name: "",
    city: "",
    guest_count: "",
    status: "quote",
    notes: "",
    parents: [{ name: "", phone: "", email: "" }],
    schedule: [],
    all_inclusive: false,
    all_inclusive_price: 0,
    all_inclusive_includes_vat: false,
    services: [],
    payments: [],
    discount_amount: 0,
    discount_reason: "",
    discount_before_vat: false,
    total_override: 0,
    total_override_includes_vat: true
  });

  const navigate = useNavigate();
  // Ref to track the currently loaded event ID to prevent overwriting formData on background refetches
  const loadedEventIdRef = React.useRef(null);

  useEffect(() => {
    const loadPrerequisites = async () => {
      try {
        const [servicesData, suppliersData, packagesData, conceptSettings] = await Promise.all([
          Service.list(),
          Supplier.list(),
          Package.list(),
          AppSettings.filter({ setting_key: 'concept_defaults' })
        ]);
        setAllServices(Array.isArray(servicesData) ? servicesData : []);
        setAllSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
        setAllPackages(Array.isArray(packagesData) ? packagesData : []);

        let parsedConceptSettings = [];
        if (conceptSettings.length > 0) {
          try {
            parsedConceptSettings = JSON.parse(conceptSettings[0].setting_value);
          } catch(e) {
            console.error("Failed to parse concept settings", e);
            parsedConceptSettings = [];
          }
        }
        setConceptDefaults(parsedConceptSettings);

      } catch (error) {
        console.error("Failed to load prerequisites:", error);
      }
    };
    loadPrerequisites();
  }, []);

  useEffect(() => {
    const loadConcepts = async () => {
      try {
        const templates = await QuoteTemplate.filter({ template_type: 'concept_intro' });
        const concepts = templates.map(t => t.identifier).filter(Boolean);
        setExistingConcepts(concepts);
      } catch (error) {
        console.error("Failed to load concepts from templates:", error);
        setExistingConcepts([]);
      }
    };
    loadConcepts();
  }, []);


  const loadDefaultServices = (servicesList, conceptName, allConceptDefaults, packagesData) => {
    const concept = allConceptDefaults.find(c => c.concept === conceptName);
    const result = [];
    let orderCounter = 0;

    // 1. הוסף חבילות דיפולטיביות (אם יש)
    const defaultPackageIds = concept?.package_ids || [];
    if (defaultPackageIds.length > 0 && packagesData.length > 0) {
      for (const pkgId of defaultPackageIds) {
        const pkg = packagesData.find(p => p.id === pkgId);
        if (!pkg) continue;

        const mainPkgTempId = `def_pkg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const baseOrder = orderCounter * 1000;

        // Main package item
        result.push({
          id: mainPkgTempId,
          service_id: servicesList[0]?.id || '',
          package_name: pkg.package_name,
          package_description: pkg.package_description,
          custom_price: pkg.package_price || 0,
          includes_vat: pkg.package_includes_vat || false,
          is_package_main_item: true,
          quantity: 1,
          order_index: baseOrder,
          supplier_ids: [],
          supplier_statuses: {},
          supplier_notes: {},
          admin_notes: '',
          client_notes: '',
          service_description: pkg.package_description || ''
        });

        // Child services in package
        const sortedServiceIds = (pkg.service_ids || [])
          .map(sid => servicesList.find(s => s.id === sid))
          .filter(Boolean)
          .sort((a, b) => (a.default_order_index || 0) - (b.default_order_index || 0));

        sortedServiceIds.forEach((service, idx) => {
          result.push({
            id: `def_${Date.now()}_${orderCounter}_${idx}_${Math.random().toString(36).substr(2, 5)}`,
            service_id: service.id,
            service_name: service.service_name,
            custom_price: 0,
            quantity: 1,
            includes_vat: pkg.package_includes_vat || false,
            service_description: service.service_description || '',
            parent_package_event_service_id: mainPkgTempId,
            is_package_main_item: false,
            supplier_ids: [],
            supplier_statuses: {},
            supplier_notes: {},
            admin_notes: '',
            client_notes: '',
            order_index: baseOrder + idx + 1
          });
        });

        orderCounter++;
      }
    }

    // 2. הוסף שירותים בודדים דיפולטיביים
    let defaultServicesToAdd;
    if (concept && concept.service_ids?.length > 0) {
      defaultServicesToAdd = servicesList.filter(service => concept.service_ids.includes(service.id));
    } else if (!concept) {
      defaultServicesToAdd = servicesList.filter(service => service.is_default);
    } else {
      defaultServicesToAdd = [];
    }

    defaultServicesToAdd.forEach((service, idx) => {
      result.push({
        id: `def_${Date.now()}_s_${idx}_${Math.random().toString(36).substr(2, 5)}`,
        service_id: service.id,
        service_name: service.service_name,
        custom_price: service.base_price || 0,
        quantity: 1,
        total_price: service.base_price || 0,
        supplier_ids: [],
        status: "pending",
        includes_vat: service.default_includes_vat || false,
        admin_notes: "",
        client_notes: "",
        service_description: service.service_description || "",
        min_suppliers: service.default_min_suppliers !== undefined ? service.default_min_suppliers : 0,
        order_index: service.default_order_index || (orderCounter * 1000 + idx)
      });
    });

    return result.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  };

  const handleLoadDefaults = () => {
    if (allServices.length === 0) return;
    const defaults = loadDefaultServices(allServices, formData.concept, conceptDefaults, allPackages);
    setFormData(prev => ({ ...prev, services: [...prev.services, ...defaults] }));
  };

  useEffect(() => {
    const currentEventId = event ? event.id : 'new';
    
    // Skip initialization if we already loaded this event (prevents reset on background refetches)
    // Exception: if allServices just loaded (length changed from 0 to > 0) and we have services to map, we might want to update names
    // But for stability, it's better to respect current formData.
    if (loadedEventIdRef.current === currentEventId && allServices.length > 0) {
        return;
    }

    let defaultDate = "";
    if (event?.event_date) {
      defaultDate = format(new Date(event.event_date), 'yyyy-MM-dd');
    } else if (initialDate) {
      defaultDate = initialDate;
    }

    const eventData = {
      event_name: event?.event_name || "",
      event_type: event?.event_type || "bar_mitzvah",
      event_date: defaultDate,
      event_time: event?.event_time || "",
      location: event?.location || "",
      concept: event?.concept || "",
      family_name: event?.family_name || "",
      child_name: event?.child_name || "",
      city: event?.city || "",
      guest_count: event?.guest_count !== undefined && event.guest_count !== null ? String(event.guest_count) : "",
      status: event?.status || "quote",
      notes: event?.notes || "",
      parents: event?.parents?.length ? event.parents : [{ name: "", phone: "", email: "" }],
      schedule: event?.schedule?.length ? event.schedule : [],
      all_inclusive: event?.all_inclusive || false,
      all_inclusive_price: event?.all_inclusive_price || 0,
      all_inclusive_includes_vat: event?.all_inclusive_includes_vat || false,
      discount_amount: event?.discount_amount || 0,
      discount_reason: event?.discount_reason || "",
      discount_before_vat: event?.discount_before_vat || false,
      total_override: event?.total_override || 0,
      total_override_includes_vat: event?.total_override_includes_vat !== undefined ? event.total_override_includes_vat : true
    };

        const initialServicesFromEvent = event?.services?.length ? event.services.map(s => {
       const serviceDetails = allServices.find(as => as.id === s.service_id);
       const isPkgMain = s.is_package_main_item;

       return {
         ...s,
         service_name: isPkgMain ? (s.package_name || s.service_name) : (s.service_name || serviceDetails?.service_name || ''),
         package_name: s.package_name || (isPkgMain ? s.service_name : ''),
         package_description: s.package_description || (isPkgMain ? s.service_description : ''),
         package_price: s.package_price !== undefined ? s.package_price : s.custom_price,
         package_includes_vat: s.package_includes_vat !== undefined ? s.package_includes_vat : s.includes_vat,
         client_notes: s.client_notes || '',
         pickup_point: s.pickup_point || '',
         on_site_contact_details: s.on_site_contact_details || { name: '', phone: '' },
         custom_price: s.custom_price !== undefined ? s.custom_price : (serviceDetails?.base_price || 0),
         includes_vat: s.includes_vat !== undefined ? s.includes_vat : (serviceDetails?.default_includes_vat || false),
         supplier_ids: Array.isArray(s.supplier_ids) ? s.supplier_ids : (s.supplier_ids ? JSON.parse(s.supplier_ids) : []),
         service_description: isPkgMain ? (s.package_description || s.service_description || '') : (s.service_description || serviceDetails?.service_description || ''),
         min_suppliers: s.min_suppliers !== undefined ? s.min_suppliers : (serviceDetails?.default_min_suppliers || 0),
         order_index: s.order_index !== undefined ? s.order_index : (serviceDetails?.default_order_index || 0)
       }
    }).sort((a, b) => (a.order_index || 0) - (b.order_index || 0)) : [];


    let servicesToSet = initialServicesFromEvent;

    if (event?.concept && !existingConcepts.includes(event.concept)) {
      setIsManualConcept(true);
    } else {
      setIsManualConcept(false);
    }

    setFormData(prev => ({
      ...eventData,
      services: servicesToSet,
      payments: event?.payments?.length ? event.payments : []
    }));
    
    // Mark as loaded ONLY if we have the necessary data to initialize correctly
    // If it's an existing event, we have the data in 'event'.
    // If it's a new event (!event), we MUST have 'allServices' loaded to populate defaults.
    if (event || allServices.length > 0) {
        loadedEventIdRef.current = currentEventId;
    }

  }, [event?.id, allServices.length, conceptDefaults.length, initialDate]); // Reduced dependencies

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleParentChange = (index, field, value) => {
    const newParents = [...formData.parents];
    newParents[index] = { ...newParents[index], [field]: value };
    setFormData(prev => ({
      ...prev,
      parents: newParents
    }));
  };

  const handleContactSelect = (index, contactData) => {
    const newParents = [...formData.parents];
    newParents[index] = {
      ...newParents[index],
      name: contactData.name || newParents[index].name,
      phone: contactData.phone || newParents[index].phone,
      email: contactData.email || newParents[index].email,
    };
    setFormData(prev => ({ ...prev, parents: newParents }));
  };

  const addParent = () => {
    setFormData(prev => ({
      ...prev,
      parents: [...prev.parents, { name: "", phone: "", email: "" }]
    }));
  };

  const removeParent = (index) => {
    setFormData(prev => ({
      ...prev,
      parents: prev.parents.filter((_, i) => i !== index)
    }));
  };

  const handleScheduleChange = (index, field, value) => {
    setFormData(prev => {
      const newSchedule = [...prev.schedule];
      newSchedule[index] = { ...newSchedule[index], [field]: value };
      return { ...prev, schedule: newSchedule };
    });
  };

  const addScheduleItem = () => {
    setFormData(prev => ({
      ...prev,
      schedule: [...prev.schedule, { time: "", activity: "", notes: "" }]
    }));
  };

  const removeScheduleItem = (index) => {
    setFormData(prev => ({
      ...prev,
      schedule: prev.schedule.filter((_, i) => i !== index)
    }));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(formData.schedule);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setFormData(prev => ({...prev, schedule: items}));
  };

  const handleServicesChange = useCallback((newServices) => {
    setFormData(prev => ({ ...prev, services: newServices }));
  }, []);

  const handleAllInclusiveChange = useCallback((updates) => {
    setFormData(prev => ({ ...prev, ...updates }));
  }, []);

  const handlePaymentsChange = useCallback((newPayments) => {
    setFormData(prev => ({ ...prev, payments: newPayments }));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSaving) return;

    if (!formData.event_name || !formData.family_name || !formData.event_date) {
      alert("נא למלא את כל השדות הנדרשים: שם אירוע, שם משפחה, תאריך אירוע.");
      return;
    }

    setIsSaving(true);
    try {
      const eventDataToSave = {
        ...formData,
        parents: formData.parents.filter(p => p.name || p.phone || p.email),
        guest_count: parseInt(formData.guest_count) || 0,
        all_inclusive_price: Number(formData.all_inclusive_price) || 0,
        discount_amount: Number(formData.discount_amount) || 0,
        discount_before_vat: formData.discount_before_vat,
        total_override: Number(formData.total_override) || 0,
        total_override_includes_vat: formData.total_override_includes_vat,
        services: undefined,
        payments: undefined
      };

      // Update status to confirmed only if there are valid payments with actual amounts
      const hasValidPayments = formData.payments.some(p => Number(p.amount) > 0);
      if (eventDataToSave.status === 'quote' && hasValidPayments) {
        eventDataToSave.status = 'confirmed';
      }

      let savedEvent;
      if (event) {
        await Event.update(event.id, eventDataToSave);
        savedEvent = { ...event, ...eventDataToSave };
      } else {
        savedEvent = await Event.create(eventDataToSave);
      }

      if (savedEvent?.id) {
        const existingEventServices = await EventService.filter({ event_id: savedEvent.id });
        const servicesToCreate = [];
        const servicesToUpdate = [];
        const servicesToDelete = [...existingEventServices];
        const tempIdMap = {}; // Map temp IDs to real IDs

        if (formData.services.length > 0) {
          const currentAllServices = await Service.list();

          // 1. First Pass: Create new Main Package Items immediately to get their IDs
          const newPackageItems = formData.services.filter(s => 
            s.is_package_main_item && 
            s.id && String(s.id).startsWith('temp_')
          );

          for (const pkgItem of newPackageItems) {
             const data = {
              event_id: savedEvent.id,
              service_id: pkgItem.service_id === 'PACKAGE_MAIN' ? currentAllServices[0]?.id || '' : pkgItem.service_id, 
              custom_price: pkgItem.custom_price || 0,
              quantity: pkgItem.quantity || 1,
              includes_vat: pkgItem.includes_vat || false,
              service_description: pkgItem.service_description || '',
              package_name: pkgItem.package_name,
              package_description: pkgItem.package_description,
              is_package_main_item: true,
              supplier_ids: '[]',
              status: 'pending',
              order_index: pkgItem.order_index || 0
            };
            
            try {
              const created = await EventService.create(data);
              if (created && created.id) {
                  tempIdMap[pkgItem.id] = created.id;
              }
            } catch (e) {
              console.error("Error creating package item", e);
            }
          }

          // 2. Second Pass: Process all services
for (const serviceItem of formData.services) {
    // Skip if we just created it in pass 1
    if (serviceItem.is_package_main_item && String(serviceItem.id).startsWith('temp')) continue;

    const serviceDetails = currentAllServices.find(s => s.id === serviceItem.service_id);
    
    // Resolve parent ID from map if needed
    let parentId = serviceItem.parent_package_event_service_id;
    if (parentId && String(parentId).startsWith('temp')) {
        // --- התיקון כאן: שימוש בסוגריים מרובעים במקום .get() ---
        parentId = tempIdMap[parentId]; 
    }
    
    // --- נרמול נתונים ---
    const isPkgMain = !!serviceItem.is_package_main_item;
    
    // מחיר
    const finalPrice = Number(isPkgMain ? (serviceItem.custom_price ?? serviceItem.package_price ?? 0) : (serviceItem.custom_price ?? 0));
    
    // מע"מ
    const finalVat = Boolean(isPkgMain ? (serviceItem.includes_vat ?? serviceItem.package_includes_vat ?? false) : (serviceItem.includes_vat ?? false));
    
    // תיאור
    const finalDesc = isPkgMain ? (serviceItem.service_description ?? serviceItem.package_description ?? '') : (serviceItem.service_description ?? serviceDetails?.service_description ?? '');
    
    // שם חבילה - רק עבור Main Package Item, ילדים לא צריכים package_name
    const finalPkgName = isPkgMain ? (serviceItem.package_name ?? serviceItem.service_name ?? '') : undefined;
    // ----------------------------

    const data = {
        event_id: savedEvent.id,
        service_id: serviceItem.service_id,
        
        custom_price: finalPrice,
        quantity: serviceItem.quantity || 1,
        includes_vat: finalVat,
        service_description: finalDesc,
        
        supplier_ids: JSON.stringify(serviceItem.supplier_ids || []),
        supplier_statuses: JSON.stringify(serviceItem.supplier_statuses || {}),
        supplier_notes: JSON.stringify(serviceItem.supplier_notes || {}),
        admin_notes: serviceItem.admin_notes || '',
        client_notes: serviceItem.client_notes || '',
        status: serviceItem.status || 'pending',
        min_suppliers: serviceItem.min_suppliers !== undefined ? Number(serviceItem.min_suppliers) : (serviceDetails?.default_min_suppliers || 0),
        order_index: serviceItem.order_index !== undefined ? serviceItem.order_index : (serviceDetails?.default_order_index || 0),
        
        pickup_point: serviceItem.pickup_point || '',
        standing_time: serviceItem.standing_time || '',
        on_site_contact_details: serviceItem.on_site_contact_details || null,
        parent_package_event_service_id: parentId,
        
        is_package_main_item: serviceItem.is_package_main_item,
        package_name: finalPkgName,
        package_price: finalPrice,
        package_description: finalDesc,
        package_includes_vat: finalVat,
        package_id: serviceItem.package_id
    };

    let existingIndex = -1;
    if (serviceItem.id && !String(serviceItem.id).startsWith('temp')) {
        existingIndex = servicesToDelete.findIndex(es => es.id === serviceItem.id);
    }
    
    if (existingIndex === -1) {
        existingIndex = servicesToDelete.findIndex(es => es.service_id === serviceItem.service_id);
    }

    if (existingIndex !== -1) {
        const existingService = servicesToDelete.splice(existingIndex, 1)[0];
        servicesToUpdate.push({ id: existingService.id, data });
    } else {
        servicesToCreate.push(data);
    }
}

        }
        
        if (servicesToDelete.length > 0) {
            await Promise.all(servicesToDelete.map(es => EventService.delete(es.id)));
        }
        if (servicesToUpdate.length > 0) {
            await Promise.all(servicesToUpdate.map(item => EventService.update(item.id, item.data)));
        }
        if (servicesToCreate.length > 0) {
            await EventService.bulkCreate(servicesToCreate);
        }

        const existingPayments = await Payment.filter({ event_id: savedEvent.id });
        for (const payment of existingPayments) {
          await Payment.delete(payment.id);
        }

        if (formData.payments.length > 0) {
          const validPayments = formData.payments.filter(p => {
            const amount = Number(p.amount);
            return amount && !isNaN(amount) && amount > 0;
          });
          
          for (const paymentItem of validPayments) {
            await Payment.create({
              ...paymentItem,
              event_id: savedEvent.id,
              amount: Number(paymentItem.amount)
            });
          }
        }
      }

      // Check if event status needs update (tied/in_progress)
      try {
        await base44.functions.invoke('checkEventStatus', { eventId: savedEvent.id });
      } catch (checkError) {
        console.error("Failed to check event status:", checkError);
      }

      onClose();
      await onSave(savedEvent);

    } catch (error) {
      console.error("Failed to save event:", error);
      alert("שגיאה בשמירת האירוע. אנא נסה שוב.");
    } finally {
      setIsSaving(false);
    }
  };

  const sumOfBasePrices = formData.services.reduce((sum, s) => {
      const serviceTotal = (s.custom_price || 0) * (s.quantity || 1);
      return sum + (s.includes_vat ? (serviceTotal / 1.18) : serviceTotal);
  }, 0);

  const totalVAT = sumOfBasePrices * 0.18;
  const totalWithVAT = sumOfBasePrices + totalVAT;
  const discountAmount = Number(formData.discount_amount) || 0;
  const finalTotal = totalWithVAT - discountAmount;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 bg-white/95 backdrop-blur-sm shadow-xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="p-6 pb-0 sticky top-0 bg-white/95 backdrop-blur-sm z-10">
          <DialogTitle className="text-lg sm:text-xl font-bold">
            {event ? "עריכת אירוע" : "יצירת אירוע חדש"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 p-6">

          <div className="p-6 border rounded-lg bg-gray-50/80">
            <h3 className="text-lg font-semibold mb-4 border-b pb-2">פרטי אירוע</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                id="event_name"
                value={formData.event_name}
                onChange={(e) => handleInputChange("event_name", e.target.value)}
                placeholder="שם האירוע"
                required
                disabled={isSaving}
              />
              <Select value={formData.event_type} onValueChange={(value) => handleInputChange("event_type", value)} disabled={isSaving}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bar_mitzvah">בר מצווה</SelectItem>
                  <SelectItem value="bat_mitzvah">בת מצווה</SelectItem>
                  <SelectItem value="wedding">חתונה</SelectItem>
                  <SelectItem value="other">אחר</SelectItem>
                </SelectContent>
              </Select>
              <Input
                id="event_date"
                type="date"
                value={formData.event_date}
                onChange={(e) => handleInputChange("event_date", e.target.value)}
                required
                disabled={isSaving}
              />
              <Input
                id="event_time"
                type="time"
                value={formData.event_time}
                onChange={(e) => handleInputChange("event_time", e.target.value)}
                placeholder="שעת האירוע"
                disabled={isSaving}
              />
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => handleInputChange("location", e.target.value)}
                placeholder="מיקום"
                disabled={isSaving}
              />
              <div>
                <Label htmlFor="concept">קונספט</Label>
                <div className="space-y-2">
                  {!isManualConcept ? (
                    <>
                      <Select 
                        value={formData.concept && existingConcepts.includes(formData.concept) ? formData.concept : ""} 
                        onValueChange={(value) => {
                          if (value === "__manual__") {
                            setIsManualConcept(true);
                          } else {
                            handleInputChange("concept", value);
                          }
                        }} 
                        disabled={isSaving}
                      >
                        <SelectTrigger id="concept">
                          <SelectValue placeholder="בחר קונספט..." />
                        </SelectTrigger>
                        <SelectContent>
                          {existingConcepts.map(concept => (
                            <SelectItem key={concept} value={concept}>{concept}</SelectItem>
                          ))}
                          <SelectItem value="__manual__" className="text-blue-600 font-medium">+ הכנס קונספט חדש</SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        value={formData.concept}
                        onChange={(e) => handleInputChange("concept", e.target.value)}
                        placeholder="שם קונספט חדש..."
                        disabled={isSaving}
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsManualConcept(false);
                          handleInputChange("concept", "");
                        }}
                        disabled={isSaving}
                        className="text-xs"
                      >
                        חזור לבחירה מהרשימה
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="notes">הערות כלליות</Label>
              <Textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={(e) => handleInputChange("notes", e.target.value)}
                placeholder="הערות ותזכורות חשובות..."
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="p-6 border rounded-lg bg-gray-50/80">
            <h3 className="text-lg font-semibold mb-4 border-b pb-2">פרטי משפחה</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <Input
                id="family_name"
                value={formData.family_name}
                onChange={(e) => handleInputChange("family_name", e.target.value)}
                placeholder="שם משפחה"
                required
                disabled={isSaving}
              />
              <Input
                id="child_name"
                value={formData.child_name}
                onChange={(e) => handleInputChange("child_name", e.target.value)}
                placeholder="שם הילד/ה"
                disabled={isSaving}
              />
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleInputChange("city", e.target.value)}
                placeholder="עיר מגורים"
                disabled={isSaving}
              />
              <Input
                id="guest_count"
                type="number"
                value={formData.guest_count}
                onChange={(e) => handleInputChange("guest_count", e.target.value)}
                placeholder="מספר אורחים"
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="p-6 border rounded-lg bg-gray-50/80">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="text-lg font-semibold">פרטי הורים</h3>
              <Button type="button" variant="outline" size="sm" onClick={addParent} disabled={isSaving}>
                <Plus className="h-4 w-4 ml-1" />הוסף הורה
              </Button>
            </div>
            <div className="space-y-3">
              {formData.parents.map((parent, index) => (
                <div key={index} className="border p-4 rounded-lg bg-gray-50/70">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[150px]">
                      <Input
                        value={parent.name}
                        onChange={(e) => handleParentChange(index, "name", e.target.value)}
                        placeholder="שם מלא"
                        disabled={isSaving}
                      />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                      <Input
                        value={parent.phone}
                        onChange={(e) => handleParentChange(index, "phone", e.target.value)}
                        placeholder="טלפון"
                        disabled={isSaving}
                      />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                       <Input
                        type="email"
                        value={parent.email}
                        onChange={(e) => handleParentChange(index, "email", e.target.value)}
                        placeholder="אימייל"
                        disabled={isSaving}
                      />
                    </div>
                    <ContactPicker
                        onContactSelect={(contactData) => handleContactSelect(index, contactData)}
                        className="shrink-0"
                    />
                    {formData.parents.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeParent(index)} disabled={isSaving}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 border rounded-lg bg-gray-50/80">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="h-5 w-5" />
                לוח זמנים
              </h3>
              {formData.schedule?.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={copyToClipboard} className="h-8 w-8 p-0">
                  {isCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              )}
            </div>

            <div className="flex gap-2 mb-4">
              <Button type="button" variant="outline" size="sm" onClick={addScheduleItem} disabled={isSaving} className="flex-1">
                <Plus className="h-4 w-4 ml-1" />הוסף ידנית
              </Button>
              
              <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => setIsImportOpen(true)}>
                  <ClipboardPaste className="h-4 w-4 ml-1" />טעינה חכמה
                </Button>
                <DialogContent dir="rtl" className="sm:max-w-[500px]" onPointerDownOutside={(e) => e.stopPropagation()}>
                  <DialogHeader>
                    <DialogTitle>ייבוא לו"ז מהיר</DialogTitle>
                  </DialogHeader>
                  <div className="py-4">
                    <Textarea 
                      placeholder="הדבק כאן... (למשל: 10.14 הליכה בחוף 11:45 מסעדה)&#10;המערכת תפריד זמנים ופעילויות באופן אוטומטי." 
                      className="h-64 font-mono text-sm" 
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsImportOpen(false)}>ביטול</Button>
                    <Button type="button" onClick={processBulkImport}>הוסף ללו"ז</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="schedule">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                    {formData.schedule.map((item, index) => (
                       <Draggable key={`item-${index}`} draggableId={`item-${index}`} index={index}>
                         {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className="flex gap-2 items-center p-2 bg-gray-100 rounded-lg"
                          >
                            <GripVertical className="h-5 w-5 text-gray-400" />
                            <Input
                              type="time"
                              value={item.time}
                              onChange={(e) => handleScheduleChange(index, "time", e.target.value)}
                              className="w-32"
                              disabled={isSaving}
                            />
                            <Input
                              value={item.activity}
                              onChange={(e) => handleScheduleChange(index, "activity", e.target.value)}
                              placeholder="פעילות"
                              className="flex-1"
                              disabled={isSaving}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeScheduleItem(index)}
                              disabled={isSaving}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                         )}
                       </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>

          <div className="p-6 border rounded-lg bg-gray-50/80">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="text-lg font-semibold">שירותים</h3>
              {!event && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleLoadDefaults}
                  disabled={isSaving || allServices.length === 0}
                  className="text-purple-700 border-purple-200 hover:bg-purple-50"
                >
                  <Sparkles className="h-4 w-4 ml-1" />
                  טען שירותים מוגדרים מראש
                </Button>
              )}
            </div>
            <EventServicesManager
              allServices={allServices}
              allSuppliers={allSuppliers}
              allPackages={allPackages}
              selectedServices={formData.services}
              onServicesChange={handleServicesChange}
              allInclusive={formData.all_inclusive}
              allInclusivePrice={formData.all_inclusive_price}
              allInclusiveIncludesVat={formData.all_inclusive_includes_vat}
              onAllInclusiveChange={handleAllInclusiveChange}
            />
          </div>

          {!formData.all_inclusive && (
            <div className="p-6 border rounded-lg bg-gray-50/80">
              <h3 className="text-lg font-semibold mb-4 border-b pb-2">סיכום כספי</h3>
              
              {(() => {
                // Calculate financials on the fly using the utility
                // We construct a temporary event object to match what calculateEventFinancials expects
                const tempEvent = {
                  ...formData,
                  all_inclusive_price: Number(formData.all_inclusive_price),
                  discount_amount: Number(formData.discount_amount),
                  total_override: Number(formData.total_override)
                };
                
                const financials = calculateEventFinancials(tempEvent, formData.services, [], 0.18);
                
                return (
                  <div className="space-y-4">
                    {/* Total Override Section */}
                    <div className="p-4 bg-white rounded border border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Label className="font-semibold text-blue-800">דריסת מחיר כולל (אופציונלי)</Label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-gray-500 mb-1">מחיר סופי ידני</Label>
                          <Input
                            type="number"
                            value={formData.total_override || ''}
                            onChange={(e) => handleInputChange("total_override", e.target.value)}
                            placeholder="השאר ריק לחישוב אוטומטי"
                            className="bg-blue-50/50 border-blue-200"
                          />
                        </div>
                        <div className="flex items-end pb-2">
                          <div className="flex items-center space-x-2 space-x-reverse">
                            <Checkbox 
                              id="override_vat"
                              checked={formData.total_override_includes_vat}
                              onCheckedChange={(checked) => handleInputChange("total_override_includes_vat", checked)}
                            />
                            <Label htmlFor="override_vat" className="text-sm">המחיר הידני כולל מע"מ</Label>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Summary Table */}
                    <div className="bg-white p-4 rounded border border-gray-200">
                      {/* Base Costs */}
                      {!formData.total_override && (
                        <div className="space-y-2 pb-3 border-b mb-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">סה"כ לפני מע"מ:</span>
                            <span>₪{financials.totalCostWithoutVat.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">מע"מ (18%):</span>
                            <span>₪{financials.vatAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                          </div>
                          <div className="flex justify-between font-semibold">
                            <span>סה"כ כולל מע"מ:</span>
                            <span>₪{financials.totalCostWithVat.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                          </div>
                        </div>
                      )}

                      {/* Discount Section */}
                      <div className="space-y-3 pb-3 border-b mb-3">
                        <div className="flex flex-col sm:flex-row gap-4">
                          <div className="flex-1">
                            <Label className="text-xs mb-1">סכום הנחה</Label>
                            <Input 
                              type="number" 
                              value={formData.discount_amount || ''}
                              onChange={(e) => handleInputChange("discount_amount", e.target.value)}
                              placeholder="0"
                              className="text-right"
                            />
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs mb-1">סיבת ההנחה</Label>
                            <Input 
                              value={formData.discount_reason || ''}
                              onChange={(e) => handleInputChange("discount_reason", e.target.value)}
                              placeholder="למשל: בן משפחה"
                            />
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 space-x-reverse">
                          <Checkbox 
                            id="discount_before_vat"
                            checked={formData.discount_before_vat}
                            onCheckedChange={(checked) => handleInputChange("discount_before_vat", checked)}
                          />
                          <Label htmlFor="discount_before_vat" className="text-xs text-gray-600">הנחה לפני מע"מ (משפיעה על חישוב המע"מ)</Label>
                        </div>
                      </div>

                      {/* Final Total */}
                      <div className="flex justify-between items-center bg-gray-50 p-3 rounded">
                        <span className="text-lg font-bold text-gray-900">לתשלום:</span>
                        <span className="text-xl font-bold text-green-700">
                          ₪{financials.finalTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="p-6 border rounded-lg bg-gray-50/80">
            <h3 className="text-lg font-semibold mb-4 border-b pb-2">תשלומים</h3>
            <PaymentManager
              payments={formData.payments}
              onPaymentsChange={handlePaymentsChange}
              disabled={isSaving}
            />
          </div>

          <div className="p-6 border rounded-lg bg-gray-50/80">
              <h3 className="text-lg font-semibold mb-4 border-b pb-2">סטטוס אירוע</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <Label htmlFor="status">סטטוס</Label>
                      <Select value={formData.status} onValueChange={(value) => handleInputChange("status", value)} disabled={isSaving}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                          <SelectItem value="quote">הצעת מחיר</SelectItem>
                          <SelectItem value="confirmed">אירוע סגור</SelectItem>
                          <SelectItem value="in_progress">אירוע תפור</SelectItem>
                          <SelectItem value="completed">אירוע עבר</SelectItem>
                          <SelectItem value="cancelled">אירוע בוטל</SelectItem>
                      </SelectContent>
                      </Select>
                  </div>
              </div>
          </div>

          <CardFooter className="flex justify-end gap-3 p-0 pt-6 sticky bottom-0 bg-white/95 backdrop-blur-sm z-10">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  שומר...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 ml-2" />
                  {event ? "עדכן אירוע" : "צור אירוע"}
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}