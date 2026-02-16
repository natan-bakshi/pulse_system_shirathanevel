import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, GripVertical, Edit, ChevronDown, ChevronUp, Search, Package as PackageIcon, LogOut, HelpCircle, X, Check, Copy  } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Service } from '@/entities/Service';
import { Supplier } from '@/entities/Supplier';
import { Package } from '@/entities/Package';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import ContactPicker from '../ui/ContactPicker';

export default function EventServicesManager({
  allServices,
  allSuppliers,
  allPackages = [],
  selectedServices,
  onServicesChange,
  allInclusive,
  allInclusivePrice,
  allInclusiveIncludesVat,
  onAllInclusiveChange
}) {
  const [expandedServices, setExpandedServices] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [showNewServiceDialog, setShowNewServiceDialog] = useState(false);
  const [showNewSupplierDialog, setShowNewSupplierDialog] = useState(false);
  const [showPackageDialog, setShowPackageDialog] = useState(false);
  const [showAddExistingPackageDialog, setShowAddExistingPackageDialog] = useState(false);
  const [showEditPackageDialog, setShowEditPackageDialog] = useState(false);
  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [selectedServiceForSupplier, setSelectedServiceForSupplier] = useState(null);
  const [supplierFormData, setSupplierFormData] = useState({ supplierIds: [], notes: {} });
  const [supplierSearchTerm, setSupplierSearchTerm] = useState("");
  const [addServiceSelectValue, setAddServiceSelectValue] = useState("");
  const [selectedServicesForAction, setSelectedServicesForAction] = useState([]);
  const [packageServiceSearchTerm, setPackageServiceSearchTerm] = useState("");
  
  // New state for multi-select service adding
  const [serviceSearchTerm, setServiceSearchTerm] = useState("");
  const [servicesToMultiAdd, setServicesToMultiAdd] = useState([]);
  const [showAddToPackageDialog, setShowAddToPackageDialog] = useState(false);
  const [targetPackageId, setTargetPackageId] = useState('new');
  const [newPackageData, setNewPackageData] = useState({ name: '', description: '', price: '', includes_vat: false });
  
  const [newService, setNewService] = useState({
    service_name: '',
    service_description: '',
    category: '',
    base_price: '',
    default_includes_vat: false,
    default_min_suppliers: 0
  });
  
  const [newSupplier, setNewSupplier] = useState({
    supplier_name: '',
    contact_person: '',
    phone: '',
    contact_emails: ['']
  });
  
  const [packageForm, setPackageForm] = useState({
    package_name: '',
    package_description: '',
    package_price: '',
    package_includes_vat: false,
    selectedServices: []
  });
  
  const [editPackageForm, setEditPackageForm] = useState({
    package_name: '',
    package_description: '',
    package_price: '',
    package_includes_vat: false,
    is_new_structure: false
  });
  
  const [selectedExistingPackage, setSelectedExistingPackage] = useState(null);
  
  const [isSavingNewService, setIsSavingNewService] = useState(false);
  const [isSavingNewSupplier, setIsSavingNewSupplier] = useState(false);

  // Group services into packages and standalone
  const groupedServices = useMemo(() => {
    const packagesMap = new Map();
    const standalone = [];
    const mainPackageItems = [];
    const childItems = [];
    
    selectedServices.forEach(es => {
      if (es.is_package_main_item) {
        mainPackageItems.push(es);
      } else if (es.parent_package_event_service_id) {
        childItems.push(es);
      } else if (es.package_id) {
        // Support for legacy flat structure
        if (!packagesMap.has(es.package_id)) {
          packagesMap.set(es.package_id, {
            package_id: es.package_id,
            package_name: es.package_name || 'חבילה',
            package_price: es.package_price || 0,
            package_includes_vat: es.package_includes_vat || false,
            package_description: es.package_description || '',
            services: []
          });
        }
        packagesMap.get(es.package_id).services.push(es);
      } else {
        standalone.push(es);
      }
    });

    // Add new structure packages to the map
    mainPackageItems.forEach(mainPkg => {
      const children = childItems.filter(c => c.parent_package_event_service_id === mainPkg.id);
      
      packagesMap.set(mainPkg.id, {
        package_id: mainPkg.id,
        package_name: mainPkg.package_name || mainPkg.service_name,
        package_price: mainPkg.custom_price || 0,
        package_includes_vat: mainPkg.includes_vat,
        package_description: mainPkg.package_description || mainPkg.service_description,
        services: children,
        is_new_structure: true
      });
    });

    const packages = Array.from(packagesMap.values());

    return { packages, standalone };
  }, [selectedServices]);

  const toggleServiceExpanded = (itemId) => {
    setExpandedServices(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const handleCreateService = async () => {
    setIsSavingNewService(true);
    try {
      const serviceData = {
        service_name: newService.service_name,
        service_description: newService.service_description,
        category: newService.category,
        base_price: parseFloat(newService.base_price) || 0,
        default_includes_vat: newService.default_includes_vat,
        default_min_suppliers: parseInt(newService.default_min_suppliers) || 0,
        is_active: true
      };
      
      const createdService = await Service.create(serviceData);
      
      setNewService({
        service_name: '',
        service_description: '',
        category: '',
        base_price: '',
        default_includes_vat: false,
        default_min_suppliers: 0
      });
      
      const newServiceEntry = {
        id: `temp_${Date.now()}`,
        service_id: createdService.id,
        service_name: createdService.service_name,
        custom_price: createdService.base_price || 0,
        quantity: 1,
        includes_vat: createdService.default_includes_vat || false,
        client_notes: '',
        service_description: createdService.service_description || '',
        min_suppliers: createdService.default_min_suppliers || 0,
        supplier_ids: [],
        supplier_statuses: {},
        supplier_notes: {},
        admin_notes: '',
        notes: '',
        order_index: createdService.default_order_index || 0
      };
      
      onServicesChange([...selectedServices, newServiceEntry]);
      setShowNewServiceDialog(false);
      alert("השירות נוצר בהצלחה");
    } catch (error) {
      console.error("Failed to create service:", error);
      alert("שגיאה ביצירת השירות");
    } finally {
      setIsSavingNewService(false);
    }
  };

  const handleCreateSupplier = async () => {
    setIsSavingNewSupplier(true);
    try {
      const supplierData = {
        supplier_name: newSupplier.supplier_name,
        contact_person: newSupplier.contact_person,
        phone: newSupplier.phone,
        contact_emails: newSupplier.contact_emails.filter(email => email.trim() !== ''),
        is_active: true
      };
      
      const createdSupplier = await Supplier.create(supplierData);
      
      setNewSupplier({
        supplier_name: '',
        contact_person: '',
        phone: '',
        contact_emails: ['']
      });
      setShowNewSupplierDialog(false);
      
      if (selectedServiceForSupplier) {
        setSupplierFormData(prev => ({
            ...prev,
            supplierIds: [...prev.supplierIds, createdSupplier.id]
        }));
      }
      
      alert("הספק נוצר בהצלחה");
    } catch (error) {
      console.error("Failed to create supplier:", error);
      alert("שגיאה ביצירת הספק");
    } finally {
      setIsSavingNewSupplier(false);
    }
  };

  const handleAddMultipleServices = () => {
    if (servicesToMultiAdd.length === 0) return;

    const newServices = servicesToMultiAdd.map((serviceId, index) => {
      const service = allServices.find(s => s.id === serviceId);
      if (!service) return null;
      
      // Check for duplicates if needed, though we disable/filter in UI
      if (selectedServices.some(s => s.service_id === serviceId)) return null;

      return {
        id: `temp_${Date.now()}_${index}`, 
        service_id: service.id,
        service_name: service.service_name,
        custom_price: service.base_price || 0,
        quantity: 1,
        includes_vat: service.default_includes_vat || false,
        client_notes: '',
        service_description: service.service_description || '',
        supplier_ids: [],
        supplier_statuses: {},
        supplier_notes: {},
        admin_notes: '',
        notes: ''
      };
    }).filter(Boolean);

    if (newServices.length > 0) {
      onServicesChange([...selectedServices, ...newServices]);
    }
    
    setServicesToMultiAdd([]);
    setServiceSearchTerm("");
  };

  const toggleServiceSelection = (serviceId) => {
    setServicesToMultiAdd(prev => {
      if (prev.includes(serviceId)) {
        return prev.filter(id => id !== serviceId);
      } else {
        return [...prev, serviceId];
      }
    });
    // Request: Reset search term on selection
    setServiceSearchTerm("");
  };

  const filteredServicesForAdd = useMemo(() => {
    return allServices.filter(service => 
      service.service_name.toLowerCase().includes(serviceSearchTerm.toLowerCase()) &&
      !selectedServices.some(s => s.service_id === service.id) // Filter out already selected services
    );
  }, [allServices, serviceSearchTerm, selectedServices]);

  const handleRemoveService = (serviceId) => {
    onServicesChange(selectedServices.filter(s => s.service_id !== serviceId));
  };

  const handleServiceChange = (itemId, field, value) => {
    const updatedServices = selectedServices.map(s => {
      if (s.id === itemId) {
        let updatedValue = value;
        if (field === 'custom_price' || field === 'quantity') {
          updatedValue = parseFloat(value) || 0;
        }
        return { ...s, [field]: updatedValue };
      }
      return s;
    });
    onServicesChange(updatedServices);
  };

  const handleOpenSupplierDialog = (service) => {
    setSelectedServiceForSupplier(service);
    const supplierIds = Array.isArray(service.supplier_ids) ? service.supplier_ids : [];
    const supplierNotes = typeof service.supplier_notes === 'object' ? service.supplier_notes : {};
    setSupplierFormData({ supplierIds, notes: supplierNotes });
    setSupplierSearchTerm("");
    setShowSupplierDialog(true);
  };

  const handleAssignSuppliers = () => {
    if (!selectedServiceForSupplier) return;
    
    const updatedServices = selectedServices.map(s => {
      if (s.service_id === selectedServiceForSupplier.service_id) {
        return {
          ...s,
          supplier_ids: supplierFormData.supplierIds,
          supplier_notes: supplierFormData.notes
        };
      }
      return s;
    });
    
    onServicesChange(updatedServices);
    setShowSupplierDialog(false);
    setSelectedServiceForSupplier(null);
    setSupplierFormData({ supplierIds: [], notes: {} });
    setSupplierSearchTerm("");
  };

  const handleCreatePackage = () => {
    if (!packageForm.package_name) {
      alert("יש למלא שם חבילה");
      return;
    }

    if (packageForm.selectedServices.length === 0) {
      alert("יש לבחור לפחות שירות אחד");
      return;
    }

    const packageId = `pkg_${Date.now()}`;
    const packagePrice = parseFloat(packageForm.package_price) || 0;

    const updatedServices = selectedServices.map(s => {
      if (packageForm.selectedServices.includes(s.service_id)) {
        return {
          ...s,
          package_id: packageId,
          package_name: packageForm.package_name,
          package_price: packagePrice,
          package_includes_vat: packageForm.package_includes_vat,
          package_description: packageForm.package_description
        };
      }
      return s;
    });

    onServicesChange(updatedServices);
    
    setPackageForm({
      package_name: '',
      package_description: '',
      package_price: '',
      package_includes_vat: false,
      selectedServices: []
    });
    setShowPackageDialog(false);
  };

  const handleAddExistingPackage = () => {
    if (!selectedExistingPackage) {
      alert("יש לבחור חבילה");
      return;
    }

    const packageData = allPackages.find(p => p.id === selectedExistingPackage);
    if (!packageData) {
      alert("החבילה לא נמצאה");
      return;
    }

    const mainPackageTempId = `temp_pkg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const maxOrderIndex = selectedServices.reduce((currentMax, s) => Math.max(currentMax, s.order_index || 0), 0);
    const newPackageBaseOrderIndex = Math.ceil(maxOrderIndex / 1000) * 1000 + 1000;

    // Create Main Item
    const packageMainItem = {
        id: mainPackageTempId,
        service_id: allServices[0]?.id || '',
        package_name: packageData.package_name,
        package_description: packageData.package_description,
        custom_price: packageData.package_price || 0,
        includes_vat: packageData.package_includes_vat,
        is_package_main_item: true,
        quantity: 1,
        order_index: newPackageBaseOrderIndex,
        supplier_ids: [],
        status: 'pending',
        service_description: packageData.package_description || ''
    };

    const servicesInPackage = packageData.service_ids || [];

    const newServices = servicesInPackage.map((serviceId, idx) => {
      const serviceDetails = allServices.find(s => s.id === serviceId);
      if (!serviceDetails) return null;

      return {
        id: `temp_${Date.now()}_${idx}`,
        service_id: serviceId,
        service_name: serviceDetails.service_name,
        custom_price: 0, // Price is in package
        quantity: 1,
        includes_vat: packageData.package_includes_vat, 
        service_description: serviceDetails.service_description || '',
        
        parent_package_event_service_id: mainPackageTempId,
        is_package_main_item: false,
        
        supplier_ids: [],
        supplier_statuses: {},
        supplier_notes: {},
        admin_notes: '',
        client_notes: '',
        order_index: newPackageBaseOrderIndex + idx + 1
      };
    }).filter(Boolean);

    onServicesChange([...selectedServices, packageMainItem, ...newServices]);
    setSelectedExistingPackage(null);
    setShowAddExistingPackageDialog(false);
  };

  const handleOpenEditPackage = (pkg) => {
    setEditingPackage(pkg.package_id);
    setEditPackageForm({
      package_name: pkg.package_name,
      package_description: pkg.package_description || '',
      package_price: pkg.package_price || '',
      package_includes_vat: pkg.package_includes_vat || false,
      is_new_structure: pkg.is_new_structure || false
    });
    setShowEditPackageDialog(true);
  };

  const handleSavePackageEdit = () => {
    if (!editPackageForm.package_name) {
      alert("יש למלא שם חבילה");
      return;
    }

    const updatedServices = selectedServices.map(s => {
      // טיפול במבנה החדש (new structure)
      if (editPackageForm.is_new_structure) {
        if (s.id === editingPackage) {
          // עדכון ה-Main Package Item
          return {
            ...s,
            package_name: editPackageForm.package_name,
            service_name: editPackageForm.package_name,
            package_description: editPackageForm.package_description,
            service_description: editPackageForm.package_description,
            custom_price: parseFloat(editPackageForm.package_price) || 0,
            includes_vat: editPackageForm.package_includes_vat
          };
        } else if (s.parent_package_event_service_id === editingPackage) {
          // עדכון שירותי הילדים - רק מע"מ
          return {
            ...s,
            includes_vat: editPackageForm.package_includes_vat
          };
        }
      } 
      // טיפול במבנה הישן (legacy structure)
      else {
        if (s.package_id === editingPackage) {
          return {
            ...s,
            package_name: editPackageForm.package_name,
            package_description: editPackageForm.package_description,
            package_price: parseFloat(editPackageForm.package_price) || 0,
            package_includes_vat: editPackageForm.package_includes_vat
          };
        }
      }
      return s;
    });

    onServicesChange(updatedServices);
    setShowEditPackageDialog(false);
    setEditingPackage(null);
  };

  const handleDeletePackage = (packageTempId) => {
    if (!window.confirm("האם למחוק חבילה זו ואת כל השירותים שבה?")) return;
    
    const updatedServices = selectedServices.filter(s => 
      s.id !== packageTempId && 
      s.parent_package_event_service_id !== packageTempId &&
      s.package_id !== packageTempId
    );
    onServicesChange(updatedServices);
  };

  const handleRemoveFromPackage = (serviceTempId) => {
    const updatedServices = selectedServices.map(s => {
      if (s.id === serviceTempId) {
        return {
          ...s,
          parent_package_event_service_id: null,
          is_package_main_item: false,
          package_id: null, // Clear legacy field
          package_name: undefined, // Clear package-related names/descriptions
          package_description: undefined,
          package_price: undefined, // Remove package price from this service
          includes_vat: allServices.find(as => as.id === s.service_id)?.default_includes_vat || false // Revert to default VAT
        };
      }
      return s;
    });
    onServicesChange(updatedServices);
  };

  const handleDeleteSelectedServices = () => {
    if (selectedServicesForAction.length === 0) return;
    
    if (!window.confirm(`האם למחוק ${selectedServicesForAction.length} שירותים נבחרים?`)) return;
    
    const updatedServices = selectedServices.filter(s => !selectedServicesForAction.includes(s.id));
    setSelectedServicesForAction([]);
    onServicesChange(updatedServices);
  };

  const handleAddServicesToPackage = () => {
    if (selectedServicesForAction.length === 0) {
      alert("יש לבחור לפחות שירות אחד");
      return;
    }

    let mainPackageTempId;
    let newServices = [...selectedServices];
    let packageMainItem;

    // 1. Determine/Create Parent Package
    if (targetPackageId === 'new') {
      if (!newPackageData.name) {
        alert("יש למלא שם חבילה חדשה");
        return;
      }
      
      mainPackageTempId = `temp_main_pkg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const maxOrderIndex = selectedServices.reduce((currentMax, s) => Math.max(currentMax, s.order_index || 0), 0);
      const newPackageBaseOrderIndex = Math.ceil(maxOrderIndex / 1000) * 1000 + 1000;

      packageMainItem = {
        id: mainPackageTempId,
        service_id: allServices[0]?.id || '',
        package_name: newPackageData.name,
        package_description: newPackageData.description,
        custom_price: parseFloat(newPackageData.price) || 0,
        includes_vat: newPackageData.includes_vat,
        is_package_main_item: true,
        quantity: 1,
        order_index: newPackageBaseOrderIndex,
        supplier_ids: [],
        supplier_statuses: {},
        supplier_notes: {},
        admin_notes: '',
        client_notes: '',
        service_description: newPackageData.description || ''
      };
      
      newServices.push(packageMainItem);
    } else {
      mainPackageTempId = targetPackageId;
      packageMainItem = selectedServices.find(s => s.id === mainPackageTempId);
    }

    // 2. Update selected services to be children of this package
    newServices = newServices.map((s, idx) => {
      if (selectedServicesForAction.includes(s.id)) {
        return {
          ...s,
          parent_package_event_service_id: mainPackageTempId,
          is_package_main_item: false,
          package_id: null,
          custom_price: 0,
          includes_vat: packageMainItem.includes_vat,
        };
      }
      return s;
    });

    onServicesChange(newServices);
    setShowAddToPackageDialog(false);
    setSelectedServicesForAction([]);
    setTargetPackageId('new');
    setNewPackageData({ name: '', description: '', price: '', includes_vat: false });
  };

  const handleDragEnd = (result) => {
    const { source, destination, draggableId, type } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    let updatedServices = [...selectedServices];
    const movedItemIndex = updatedServices.findIndex(s => s.id === draggableId);
    if (movedItemIndex === -1) return;
    
    const movedItem = { ...updatedServices[movedItemIndex] };
    
    // Calculate new order logic
    // We need to know the structure of the destination group to find the neighbor
    let destItems = [];
    let isDestPackage = false;
    let destPackageId = null;

    if (destination.droppableId === 'standalone') {
        destItems = groupedServices.standalone;
        isDestPackage = false;
    } else {
        const pkg = groupedServices.packages.find(p => p.package_id === destination.droppableId);
        if (pkg) {
            destItems = pkg.services;
            isDestPackage = true;
            destPackageId = pkg.package_id;
        }
    }

    // Determine new parent/package status
    if (isDestPackage) {
        // Moving INTO a package
        // Find the main package item to link to
        const mainPkgItem = updatedServices.find(s => s.id === destPackageId || s.package_id === destPackageId); // Simplified lookup
        // Ideally we use the package_id from the droppable
        
        // Check if it's a new structure package
        const isNewStructure = groupedServices.packages.find(p => p.package_id === destPackageId)?.is_new_structure;
        
        if (isNewStructure) {
            movedItem.parent_package_event_service_id = destPackageId;
            movedItem.package_id = null;
            movedItem.custom_price = 0; // Price in package is 0
            movedItem.is_package_main_item = false;
        } else {
            movedItem.package_id = destPackageId;
            movedItem.parent_package_event_service_id = null;
            movedItem.is_package_main_item = false;
        }
    } else {
        // Moving to Standalone
        movedItem.package_id = null;
        movedItem.parent_package_event_service_id = null;
        movedItem.is_package_main_item = false;
        // Restore price? We don't have the original base price easily available here without looking up allServices
        // But usually moving to standalone keeps the 0 price until edited, or we could try to look it up.
        // For now, keep as is.
    }

    // Calculate Order Index
    // We need to insert the item into destItems array mentally to see neighbors
    // But destItems are sorted by order_index.
    
    let newOrderIndex = 0;
    
    // Note: destination.index is the index IN THE VISIBLE LIST (destItems)
    
    if (destItems.length === 0) {
        // Empty destination
        newOrderIndex = 1000; // Start somewhere
    } else if (destination.index === 0) {
        // At start
        newOrderIndex = (destItems[0].order_index || 0) - 100;
    } else if (destination.index >= destItems.length) {
        // At end
        newOrderIndex = (destItems[destItems.length - 1].order_index || 0) + 100;
    } else {
        // Between two items
        const prevItem = destItems[destination.index - 1];
        const nextItem = destItems[destination.index];
        newOrderIndex = ((prevItem.order_index || 0) + (nextItem.order_index || 0)) / 2;
    }
    
    movedItem.order_index = newOrderIndex;
    
    // Update the list
    updatedServices[movedItemIndex] = movedItem;
    
    onServicesChange(updatedServices);
  };

  const filteredSuppliersForDialog = allSuppliers.filter(supplier =>
    supplier.supplier_name.toLowerCase().includes(supplierSearchTerm.toLowerCase())
  );

  const renderServiceCard = (service, isInPackage = false) => {
    const serviceDetails = allServices.find(s => s.id === service.service_id);
    const isExpanded = expandedServices[service.id];
    const isTransportService = serviceDetails?.category === 'נסיעות';
    
    // Get assigned suppliers info
    const supplierIds = Array.isArray(service.supplier_ids) ? service.supplier_ids : [];
    const assignedSuppliers = allSuppliers.filter(sup => supplierIds.includes(sup.id));
    
    const isSelected = selectedServicesForAction.includes(service.id);

    return (
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <GripVertical className="h-4 w-4 text-gray-400" />
            <Checkbox
                checked={isSelected}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedServicesForAction([...selectedServicesForAction, service.id]);
                  } else {
                    setSelectedServicesForAction(selectedServicesForAction.filter(id => id !== service.id));
                  }
                }}
            />
            <div className="font-medium">{serviceDetails?.service_name || 'שירות'}</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => toggleServiceExpanded(service.id)}
              className="h-6 px-2"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
          
          {/* תצוגה מכווצת */}
          {!isExpanded && (
            <div className="mr-6 space-y-1">
              {!allInclusive && (
                <div className="text-sm text-gray-600">
                  מחיר: ₪{((service.custom_price || 0) * (service.quantity || 1)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  {service.includes_vat ? ' (כולל מע"מ)' : ' (לא כולל מע"מ)'}
                  {service.quantity > 1 && ` | כמות: ${service.quantity}`}
                </div>
              )}
              {allInclusive && service.quantity > 1 && (
                <div className="text-sm text-gray-600">כמות: {service.quantity}</div>
              )}
              {serviceDetails?.service_description && (
                <div className="text-xs text-gray-500 line-clamp-2" dangerouslySetInnerHTML={{ __html: serviceDetails.service_description }} />
              )}
              {service.client_notes && (
                <div className="text-xs text-gray-500 italic">הערה: {service.client_notes}</div>
              )}
                          {/* Transport Details - Read Only Formatted */}
            {isTransportService && (
                <div className="text-xs text-blue-700 bg-blue-50 p-2 rounded mt-1 space-y-2">
                    {(() => {
                        let units = [];
                        try {
                            const parsed = JSON.parse(service.pickuppoint || '[]');
                            units = Array.isArray(parsed) ? parsed : [];
                        } catch (e) {
                             if (service.pickuppoint || service.standingtime) {
                                units = [{
                                    pickupPoints: [{
                                        time: service.standingtime,
                                        location: service.pickuppoint,
                                        contact: service.onsitecontactdetails
                                    }]
                                }];
                             }
                        }

                        if (units.length === 0) return null;

                        return units.map((unit, uIdx) => (
                            <div key={uIdx} className={uIdx > 0 ? "border-t border-blue-200 pt-2 mt-2" : ""}>
                                {units.length > 1 && (
                                    <div className="font-bold underline mb-1">נסיעה {uIdx + 1}</div>
                                )}
                                {unit.pickupPoints.map((point, pIdx) => (
                                    <div key={pIdx} className="mb-1 last:mb-0">
                                        {unit.pickupPoints.length > 1 && (
                                            <span className="font-semibold ml-1">נקודה {pIdx + 1}:</span>
                                        )}
                                        {point.time && <span className="ml-2"><strong>שעה:</strong> {point.time}</span>}
                                        {point.location && <span className="ml-2"><strong>מיקום:</strong> {point.location}</span>}
                                        {point.contact?.name && (
                                            <span className="block mt-0.5 text-[11px] text-blue-800">
                                                <strong>איש קשר:</strong> {point.contact.name} {point.contact.phone ? `(${point.contact.phone})` : ''}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ));
                    })()}
                </div>
            )}
            </div>
          )}
          
          {/* תצוגה מורחבת */}
          {isExpanded && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mr-6 mt-2">
              {!allInclusive && (
                <div>
                  <Label className="text-xs">מחיר ליחידה</Label>
                  <Input
                    type="number"
                    value={service.custom_price || ''}
                    onChange={(e) => handleServiceChange(service.id, 'custom_price', e.target.value)}
                    placeholder="מחיר"
                    className="text-sm h-8"
                  />
                </div>
              )}
              <div>
                <Label className="text-xs">כמות</Label>
                <Input
                  type="number"
                  value={service.quantity || ''}
                  onChange={(e) => handleServiceChange(service.id, 'quantity', e.target.value)}
                  placeholder="כמות"
                  className="text-sm h-8"
                />
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Label className="text-xs">שיבוצים נדרשים</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>מספר הספקים המינימלי שצריך לשבץ לשירות זה כדי שהאירוע ייחשב "תפור"</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Select
                  value={String(service.min_suppliers !== undefined ? service.min_suppliers : 1)}
                  onValueChange={(value) => handleServiceChange(service.id, 'min_suppliers', value)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="1" />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                      <SelectItem key={num} value={String(num)}>{num}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!allInclusive && (
                <div className="flex items-end">
                  <div className="flex items-center gap-2 h-8">
                    <Checkbox
                      id={`vat-${service.id}`}
                      checked={service.includes_vat}
                      onCheckedChange={(checked) => handleServiceChange(service.id, 'includes_vat', checked)}
                    />
                    <Label htmlFor={`vat-${service.id}`} className="text-xs">כולל מע"מ</Label>
                  </div>
                </div>
              )}
              <div className="col-span-full">
                <Label className="text-xs">תיאור השירות</Label>
                <ReactQuill
                  value={service.service_description || ''}
                  onChange={(value) => handleServiceChange(service.id, 'service_description', value)}
                  modules={{
                    toolbar: [
                      ['bold', 'italic', 'underline'],
                      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                      ['clean']
                    ],
                  }}
                  formats={['bold', 'italic', 'underline', 'list', 'bullet']}
                  placeholder="תיאור מפורט של השירות"
                  className="bg-white"
                />
              </div>
              <div className="col-span-full">
                <Label className="text-xs">הערה ללקוח (יוצג בהצעה)</Label>
                <Input
                  value={service.client_notes || ''}
                  onChange={(e) => handleServiceChange(service.id, 'client_notes', e.target.value)}
                  placeholder="הערה שתוצג בהצעת המחיר"
                  className="text-sm"
                />
              </div>

              {/* Transport Fields */}
                  {isTransportService && (
                    <div className="col-span-full space-y-4">
                      <Label className="text-xs font-semibold text-gray-500">פרטי נסיעה</Label>
                      
                      {(() => {
                          let units = [];
                          try {
                              const parsed = JSON.parse(service.pickuppoint || '[]');
                              units = Array.isArray(parsed) ? parsed : [];
                          } catch (e) {
                              units = [{
                                  pickupPoints: [{
                                      time: service.standingtime || '',
                                      location: service.pickuppoint || '',
                                      contact: service.onsitecontactdetails || { name: '', phone: '' }
                                  }]
                              }];
                          }

                          const quantity = parseInt(service.quantity) || 1;
                          if (units.length < quantity) {
                               for (let i = units.length; i < quantity; i++) {
                                  units.push({ pickupPoints: [{ time: '', location: '', contact: { name: '', phone: '' } }] });
                               }
                          }

                          const updateTransport = (newUnits) => {
                               const firstPoint = newUnits[0]?.pickupPoints[0] || {};
                               const updatedServices = selectedServices.map(s => {
                                 if (s.id === service.id) {
                                   return {
                                     ...s,
                                     pickup_point: JSON.stringify(newUnits),
                                     standing_time: firstPoint.time || '',
                                     on_site_contact_details: firstPoint.contact || {}
                                   };
                                 }
                                 return s;
                               });
                               onServicesChange(updatedServices);
                          };

                          return units.map((unit, uIdx) => (
                              <div key={uIdx} className="p-3 border border-red-100 rounded-lg bg-red-50/10 space-y-3">
                                  <div className="flex justify-between items-center">
                                      <span className="text-xs font-bold text-red-900">{units.length > 1 ? `רכב ${uIdx + 1}` : 'מסלול'}</span>
                                  </div>
                                  {unit.pickupPoints.map((point, pIdx) => (
                                      <div key={pIdx} className="bg-white p-2 rounded border space-y-2">
                                          <div className="flex justify-between">
                                               <Label className="text-[10px] text-gray-500">נקודה {pIdx + 1}</Label>
                                               {pIdx > 0 && <Trash2 className="h-3 w-3 text-red-500 cursor-pointer" onClick={() => {
                                                   const newUnits = [...units];
                                                   newUnits[uIdx].pickupPoints.splice(pIdx, 1);
                                                   updateTransport(newUnits);
                                               }}/>}
                                          </div>
                                          <div className="grid grid-cols-2 gap-2">
                                              <Input type="time" value={point.time} onChange={(e) => {
                                                  const newUnits = [...units];
                                                  newUnits[uIdx].pickupPoints[pIdx].time = e.target.value;
                                                  updateTransport(newUnits);
                                              }} className="h-7 text-xs" />
                                              <Input value={point.location} placeholder="מיקום" onChange={(e) => {
                                                  const newUnits = [...units];
                                                  newUnits[uIdx].pickupPoints[pIdx].location = e.target.value;
                                                  updateTransport(newUnits);
                                              }} className="h-7 text-xs" />
                                          </div>
                                           <div className="flex gap-1">
                                              <Input value={point.contact?.name || ''} placeholder="איש קשר" onChange={(e) => {
                                                  const newUnits = [...units];
                                                  if (!newUnits[uIdx].pickupPoints[pIdx].contact) newUnits[uIdx].pickupPoints[pIdx].contact = {};
                                                  newUnits[uIdx].pickupPoints[pIdx].contact.name = e.target.value;
                                                  updateTransport(newUnits);
                                              }} className="h-7 text-xs" />
                                               <Input value={point.contact?.phone || ''} placeholder="טלפון" onChange={(e) => {
                                                  const newUnits = [...units];
                                                  if (!newUnits[uIdx].pickupPoints[pIdx].contact) newUnits[uIdx].pickupPoints[pIdx].contact = {};
                                                  newUnits[uIdx].pickupPoints[pIdx].contact.phone = e.target.value;
                                                  updateTransport(newUnits);
                                              }} className="h-7 text-xs" />
                                          </div>
                                      </div>
                                  ))}
                                  <Button variant="ghost" size="sm" className="w-full text-xs text-red-700 h-6" onClick={() => {
                                      const newUnits = [...units];
                                      newUnits[uIdx].pickupPoints.push({ time: '', location: '', contact: { name: '', phone: '' } });
                                      updateTransport(newUnits);
                                  }}>+ הוסף נקודה</Button>
                              </div>
                          ));
                      })()}
                    </div>
                  )}
            </div>
          )}
          
          {/* Assigned suppliers display */}
          {assignedSuppliers.length > 0 && (
            <div className="mt-2 mr-6">
              <div className="text-xs text-gray-500 mb-1">ספקים משובצים:</div>
              <div className="flex flex-wrap gap-1">
                {assignedSuppliers.map(sup => (
                  <Badge key={sup.id} variant="secondary" className="text-xs">
                    {sup.supplier_name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="flex gap-2">
          <Button 
            type="button"
            variant="outline" 
            size="sm" 
            onClick={() => handleOpenSupplierDialog(service)}
            className="text-xs"
          >
                <Button type="button" variant="ghost" size="icon" onClick={(e) => {
          e.stopPropagation();
          let units = [];
          try { units = JSON.parse(service.pickuppoint || '[]'); } catch { units = []; }
          if (!Array.isArray(units) || units.length === 0) {
               units = [{ pickupPoints: [{ time: service.standingtime, location: service.pickuppoint, contact: service.onsitecontactdetails }] }];
          }
          const dateStr = service.eventdate ? format(new Date(service.eventdate), 'dd/MM/yyyy') : '';
          let fullText = "";
          units.forEach((unit, uIdx) => {
              if (fullText) fullText += "\n";
              if (units.length > 1) fullText += `--- רכב ${uIdx + 1} ---\n`;
              unit.pickupPoints.forEach((point, pIdx) => {
                   const time = point.time || '';
                   const loc = point.location || '';
                   const cName = point.contact?.name || '';
                   const cPhone = point.contact?.phone || '';
                   if (pIdx === 0) fullText += `${dateStr} | ${time} | ${serviceDetails?.servicename} | ${loc} | ${cName} ${cPhone}\n`;
                   else fullText += ` -> ${time} | ${loc} | ${cName} ${cPhone}\n`;
              });
          });
          navigator.clipboard.writeText(fullText).then(() => {
              setCopiedId(service.id || service.serviceid);
              setTimeout(() => setCopiedId(null), 2000);
          });
      }}>
          {copiedId === (service.id || service.serviceid) ? 
              <Check className="h-4 w-4 text-green-600 animate-in zoom-in" /> : 
              <Copy className="h-4 w-4 text-gray-400" />
          }
      </Button>

            שבץ ספק
          </Button>
          {isInPackage && (
            <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveFromPackage(service.id)}>
              הוצא מחבילה
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveService(service.service_id)}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* All Inclusive Toggle */}
      <div className="p-4 bg-blue-50 rounded space-y-3">
        <div className="flex items-center gap-2">
          <Switch 
            checked={allInclusive} 
            onCheckedChange={(checked) => onAllInclusiveChange({ all_inclusive: checked })} 
          />
          <Label>חבילת הכל כלול</Label>
        </div>
        {allInclusive && (
          <div className="grid grid-cols-2 gap-2">
            <Input 
              type="number" 
              placeholder="מחיר החבילה" 
              value={allInclusivePrice || ''} 
              onChange={(e) => onAllInclusiveChange({ all_inclusive_price: e.target.value })} 
            />
            <div className="flex items-center gap-2">
              <Checkbox 
                checked={allInclusiveIncludesVat} 
                onCheckedChange={(checked) => onAllInclusiveChange({ all_inclusive_includes_vat: checked })} 
              />
              <Label>כולל מע"מ</Label>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap items-center">
        {selectedServicesForAction.length > 0 && (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    type="button" 
                    size="sm" 
                    variant="destructive"
                    onClick={handleDeleteSelectedServices}
                  >
                    <Trash2 className="h-4 w-4 ml-2" />
                    מחק {selectedServicesForAction.length}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>מחק שירותים נבחרים</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    type="button" 
                    size="sm" 
                    onClick={() => setShowAddToPackageDialog(true)} 
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    <PackageIcon className="h-4 w-4 ml-2" />
                    אגד לחבילה
                  </Button>
                </TooltipTrigger>
                <TooltipContent>צור חבילה מהשירותים שנבחרו</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        )}

        <DropdownMenu onOpenChange={(open) => { if (!open) setServiceSearchTerm(""); }}>
          <DropdownMenuTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700 text-white border-0">
              <Plus className="h-4 w-4 ml-2" />
              הוסף שירות
              <ChevronDown className="h-4 w-4 mr-1 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72 p-2" align="end">
            {/* Search Input */}
            <div className="flex items-center border rounded-md px-2 py-1.5 mb-2 bg-gray-50 focus-within:bg-white focus-within:ring-1 focus-within:ring-blue-500 transition-colors">
              <Search className="h-4 w-4 text-gray-400 ml-2" />
              <input 
                className="flex-1 outline-none text-sm bg-transparent border-none p-0 focus:ring-0"
                placeholder="חפש שירות..."
                value={serviceSearchTerm}
                onChange={e => setServiceSearchTerm(e.target.value)}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
              {serviceSearchTerm && (
                <div role="button" onClick={() => setServiceSearchTerm("")} className="cursor-pointer p-0.5 hover:bg-gray-200 rounded-full">
                   <X className="h-3 w-3 text-gray-500" />
                </div>
              )}
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1">
              {/* Create New Service Option */}
              <div 
                className="flex items-center p-2 hover:bg-blue-50 rounded-md cursor-pointer text-blue-700 font-medium text-sm transition-colors border border-transparent hover:border-blue-100 mb-1"
                onClick={() => setShowNewServiceDialog(true)}
              >
                <Plus className="h-4 w-4 ml-2" />
                צור שירות חדש
              </div>
              
              <div className="border-t my-1"></div>

              {/* Service List */}
              {filteredServicesForAdd.length === 0 ? (
                <div className="text-center text-gray-400 text-xs py-2">לא נמצאו שירותים</div>
              ) : (
                filteredServicesForAdd.map(service => {
                  const isSelected = servicesToMultiAdd.includes(service.id);
                  return (
                    <div 
                      key={service.id} 
                      className={`flex items-center p-2 rounded-md cursor-pointer transition-colors ${isSelected ? 'bg-green-50 border border-green-100' : 'hover:bg-gray-100 border border-transparent'}`}
                      onClick={(e) => {
                        e.preventDefault();
                        toggleServiceSelection(service.id);
                      }}
                    >
                      <Checkbox 
                        checked={isSelected}
                        className="ml-2 pointer-events-none" // Events handled by parent div
                      />
                      <span className="text-sm flex-1">{service.service_name}</span>
                      {service.base_price > 0 && (
                        <span className="text-xs text-gray-500">₪{service.base_price.toLocaleString()}</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Add Button */}
            {servicesToMultiAdd.length > 0 && (
              <div className="mt-2 pt-2 border-t sticky bottom-0 bg-white">
                <Button 
                  className="w-full bg-green-600 hover:bg-green-700 h-9 text-xs font-medium shadow-sm"
                  onClick={handleAddMultipleServices}
                >
                  הוסף {servicesToMultiAdd.length} שירותים נבחרים
                </Button>
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="sm" onClick={() => setShowAddExistingPackageDialog(true)} className="bg-purple-600 hover:bg-purple-700">
                <Plus className="h-4 w-4 ml-2" />הוסף חבילה קיימת
              </Button>
            </TooltipTrigger>
            <TooltipContent>הוסף חבילה מוכנה מראש מהמאגר</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="sm" onClick={() => setShowPackageDialog(true)} className="bg-red-800 hover:bg-red-700">
                צור חבילה
              </Button>
            </TooltipTrigger>
            <TooltipContent>צור חבילה חדשה ריקה</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Services Display */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="space-y-4">
          {/* Packages */}
          {groupedServices.packages.map((pkg) => (
            <div key={pkg.package_id} className="border border-purple-200 rounded-lg overflow-hidden">
              <div className="bg-purple-50 p-3 flex items-center gap-2">
                <GripVertical className="h-5 w-5 text-gray-400" />
                <div className="flex-1">
                  <strong className="text-purple-800">{pkg.package_name}</strong>
                  {pkg.package_description && (
                    <div className="text-sm text-gray-600 mt-1" dangerouslySetInnerHTML={{ __html: pkg.package_description }} />
                  )}
                  {!allInclusive && (
                    <div className="text-sm text-purple-600">
                      ₪{(pkg.package_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} 
                      {pkg.package_includes_vat && ' (כולל מע"מ)'}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => handleOpenEditPackage(pkg)}>
                    <Edit className="h-4 w-4 ml-1" />ערוך
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => handleDeletePackage(pkg.package_id)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
              <Droppable droppableId={pkg.package_id} type="service-in-package">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="p-3 space-y-2">
                    {pkg.services.map((service, sIndex) => (
                      <Draggable key={service.id || service.service_id} draggableId={service.id || service.service_id} index={sIndex}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className="p-3 bg-gray-50 rounded">
                            {renderServiceCard(service, true)}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}

          {/* Standalone Services */}
          {groupedServices.standalone.length > 0 && (
            <Droppable droppableId="standalone" type="standalone">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                  <h4 className="font-semibold text-sm text-gray-600">שירותים בודדים</h4>
                  {groupedServices.standalone.map((service, index) => (
                    <Draggable key={service.id || service.service_id} draggableId={service.id || service.service_id} index={index}>
                      {(provided) => (
                        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className="border rounded p-3 bg-white">
                          {renderServiceCard(service, false)}
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          )}
        </div>
      </DragDropContext>
      
      {/* Supplier Assignment Dialog */}
      <Dialog open={showSupplierDialog} onOpenChange={setShowSupplierDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>שיבוץ ספקים</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="חיפוש ספקים..."
                  value={supplierSearchTerm}
                  onChange={(e) => setSupplierSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <Button onClick={() => setShowNewSupplierDialog(true)} size="icon" variant="outline">
                <Plus className="h-4 w-4" />
              </Button>
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
      
      {/* Dialogs */}
      <Dialog open={showAddToPackageDialog} onOpenChange={setShowAddToPackageDialog} modal={false}>
        <DialogContent 
          className="max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>הוספת שירותים לחבילה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>בחר יעד</Label>
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
                    onChange={(e) => setNewPackageData({...newPackageData, name: e.target.value})}
                    placeholder="שם החבילה החדשה"
                  />
                </div>
                <div>
                  <Label>מחיר החבילה</Label>
                  <Input 
                    type="number"
                    value={newPackageData.price} 
                    onChange={(e) => setNewPackageData({...newPackageData, price: e.target.value})}
                    placeholder="0"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox 
                    checked={newPackageData.includes_vat}
                    onCheckedChange={(checked) => setNewPackageData({...newPackageData, includes_vat: checked})}
                  />
                  <Label>כולל מע"מ</Label>
                </div>
                <div>
                  <Label>תיאור</Label>
                  <Textarea 
                    value={newPackageData.description} 
                    onChange={(e) => setNewPackageData({...newPackageData, description: e.target.value})}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddToPackageDialog(false)}>ביטול</Button>
            <Button onClick={handleAddServicesToPackage}>
              {targetPackageId === 'new' ? 'צור חבילה והוסף שירותים' : 'הוסף לחבילה קיימת'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewServiceDialog} onOpenChange={setShowNewServiceDialog} modal={false}>
        <DialogContent 
          className="max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>יצירת שירות חדש</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>שם השירות</Label>
              <Input
                value={newService.service_name}
                onChange={(e) => setNewService(prev => ({ ...prev, service_name: e.target.value }))}
                placeholder="שם השירות"
              />
            </div>
            <div>
              <Label>תיאור השירות</Label>
              <ReactQuill
                value={newService.service_description}
                onChange={(value) => setNewService(prev => ({ ...prev, service_description: value }))}
                modules={{
                  toolbar: [
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    ['clean']
                  ],
                }}
                formats={['bold', 'italic', 'underline', 'list', 'bullet']}
                placeholder="תיאור מפורט של השירות"
              />
            </div>
            <div>
              <Label>קטגוריה</Label>
              <Input
                value={newService.category}
                onChange={(e) => setNewService(prev => ({ ...prev, category: e.target.value }))}
                placeholder="קטגורית השירות"
              />
            </div>
            <div>
              <Label>מחיר בסיס</Label>
              <Input
                type="number"
                value={newService.base_price}
                onChange={(e) => setNewService(prev => ({ ...prev, base_price: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div>
              <Label>מספר ספקים מינימלי</Label>
              <Select
                value={String(newService.default_min_suppliers)}
                onValueChange={(value) => setNewService(prev => ({ ...prev, default_min_suppliers: parseInt(value) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="0" />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                    <SelectItem key={num} value={String(num)}>{num}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2 space-x-reverse">
              <Checkbox
                id="new-service-vat"
                checked={newService.default_includes_vat}
                onCheckedChange={(checked) => setNewService(prev => ({ ...prev, default_includes_vat: checked }))}
              />
              <Label htmlFor="new-service-vat">כולל מע"מ כברירת מחדל</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewServiceDialog(false)} disabled={isSavingNewService}>
              ביטול
            </Button>
            <Button onClick={handleCreateService} disabled={isSavingNewService}>
              {isSavingNewService ? 'שומר...' : 'צור שירות'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showNewSupplierDialog} onOpenChange={setShowNewSupplierDialog} modal={false}>
        <DialogContent 
          className="max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>יצירת ספק חדש</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>שם הספק</Label>
                <Input
                  value={newSupplier.supplier_name}
                  onChange={(e) => setNewSupplier(prev => ({ ...prev, supplier_name: e.target.value }))}
                  placeholder="שם הספק"
                />
              </div>
              <ContactPicker 
                onContactSelect={(contactData) => {
                  setNewSupplier(prev => ({
                    ...prev,
                    supplier_name: contactData.name || prev.supplier_name,
                    contact_person: contactData.name || prev.contact_person,
                    phone: contactData.phone || prev.phone,
                    contact_emails: contactData.email ? [contactData.email] : prev.contact_emails
                  }));
                }}
                className="mb-1"
              />
            </div>
            <div>
              <Label>איש קשר</Label>
              <Input
                value={newSupplier.contact_person}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, contact_person: e.target.value }))}
                placeholder="שם איש הקשר"
              />
            </div>
            <div>
              <Label>טלפון</Label>
              <Input
                value={newSupplier.phone}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="מספר טלפון"
              />
            </div>
            <div>
              <Label>אימייל</Label>
              <Input
                type="email"
                value={newSupplier.contact_emails[0]}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, contact_emails: [e.target.value] }))}
                placeholder="כתובת אימייל"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewSupplierDialog(false)} disabled={isSavingNewSupplier}>
              ביטול
            </Button>
            <Button onClick={handleCreateSupplier} disabled={isSavingNewSupplier}>
              {isSavingNewSupplier ? 'שומר...' : 'צור ספק'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPackageDialog} onOpenChange={setShowPackageDialog} modal={false}>
        <DialogContent 
          className="max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>יצירת חבילה חדשה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>שם החבילה</Label>
              <Input 
                value={packageForm.package_name} 
                onChange={(e) => setPackageForm({ ...packageForm, package_name: e.target.value })} 
              />
            </div>
            <div>
              <Label>תיאור</Label>
              <Textarea 
                value={packageForm.package_description} 
                onChange={(e) => setPackageForm({ ...packageForm, package_description: e.target.value })} 
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>מחיר</Label>
                <Input 
                  type="number" 
                  value={packageForm.package_price} 
                  onChange={(e) => setPackageForm({ ...packageForm, package_price: e.target.value })} 
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox 
                  checked={packageForm.package_includes_vat} 
                  onCheckedChange={(checked) => setPackageForm({ ...packageForm, package_includes_vat: checked })} 
                />
                <Label>כולל מע"מ</Label>
              </div>
            </div>
            <div>
              <Label>בחר שירותים</Label>
              <div className="relative mb-2">
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="חיפוש שירותים..."
                  value={packageServiceSearchTerm}
                  onChange={(e) => setPackageServiceSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
                {selectedServices.filter(s => !s.package_id).filter(s => {
                    const serviceDetails = allServices.find(s2 => s2.id === s.service_id);
                    const name = serviceDetails?.service_name || s.service_name || '';
                    return name.toLowerCase().includes(packageServiceSearchTerm.toLowerCase());
                }).map(service => {
                  const serviceDetails = allServices.find(s2 => s2.id === service.service_id);
                  return (
                    <div key={service.service_id} className="flex items-center gap-2">
                      <Checkbox
                        checked={packageForm.selectedServices.includes(service.service_id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setPackageForm({ ...packageForm, selectedServices: [...packageForm.selectedServices, service.service_id] });
                          } else {
                            setPackageForm({ ...packageForm, selectedServices: packageForm.selectedServices.filter(id => id !== service.service_id) });
                          }
                        }}
                      />
                      <Label>{serviceDetails?.service_name || service.service_name || 'שירות'}</Label>
                    </div>
                  );
                })}
                {selectedServices.filter(s => !s.package_id).filter(s => {
                    const serviceDetails = allServices.find(s2 => s2.id === s.service_id);
                    const name = serviceDetails?.service_name || s.service_name || '';
                    return name.toLowerCase().includes(packageServiceSearchTerm.toLowerCase());
                }).length === 0 && (
                    <div className="text-center text-gray-500 text-sm py-2">לא נמצאו שירותים</div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPackageDialog(false)}>ביטול</Button>
            <Button onClick={handleCreatePackage}>צור חבילה</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddExistingPackageDialog} onOpenChange={setShowAddExistingPackageDialog} modal={false}>
        <DialogContent 
          className="max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>הוספת חבילה קיימת</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>בחר חבילה</Label>
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-2">
                {allPackages.map(pkg => (
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
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddExistingPackageDialog(false)}>ביטול</Button>
            <Button onClick={handleAddExistingPackage} disabled={!selectedExistingPackage}>הוסף חבילה</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditPackageDialog} onOpenChange={setShowEditPackageDialog} modal={false}>
        <DialogContent 
          className="max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>עריכת פרטי חבילה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>שם החבילה</Label>
              <Input 
                value={editPackageForm.package_name} 
                onChange={(e) => setEditPackageForm({ ...editPackageForm, package_name: e.target.value })} 
              />
            </div>
            <div>
              <Label>תיאור</Label>
              <Textarea 
                value={editPackageForm.package_description} 
                onChange={(e) => setEditPackageForm({ ...editPackageForm, package_description: e.target.value })} 
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>מחיר</Label>
                <Input 
                  type="number" 
                  value={editPackageForm.package_price} 
                  onChange={(e) => setEditPackageForm({ ...editPackageForm, package_price: e.target.value })} 
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox 
                  checked={editPackageForm.package_includes_vat} 
                  onCheckedChange={(checked) => setEditPackageForm({ ...editPackageForm, package_includes_vat: checked })} 
                />
                <Label>כולל מע"מ</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditPackageDialog(false)}>ביטול</Button>
            <Button onClick={handleSavePackageEdit}>שמור שינויים</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}