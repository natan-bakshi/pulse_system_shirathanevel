import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Edit, Plus, Trash2, Save, Loader2, GripVertical, Minus, X, ChevronDown, ChevronUp, Search, Package as PackageIcon, LogOut, Info, HelpCircle } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Service } from '@/entities/Service';
import { Supplier } from '@/entities/Supplier';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import ContactPicker from '../ui/ContactPicker';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { format } from 'date-fns';

function SupplierNoteInput({ serviceId, supplierId, initialNote, handleUpdateSupplierNote }) {
  const [localNote, setLocalNote] = React.useState(initialNote || '');
  return (
    <Input
      placeholder="הערה לספק..."
      value={localNote}
      onChange={(e) => setLocalNote(e.target.value)}
      onBlur={() => {
        if (localNote !== initialNote) {
          handleUpdateSupplierNote(serviceId, supplierId, localNote);
        }
      }}
      className="text-xs h-7"
    />
  );
}

function getSupplierAssignmentStatusColor(status) {
  return { pending: "bg-yellow-100 text-yellow-800", confirmed: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800" }[status] || "bg-gray-100 text-gray-800";
}

function getSupplierAssignmentStatusText(status) {
  return { pending: "בהמתנה", confirmed: "אושר", rejected: "נדחה" }[status] || status;
}

export default function ServicesCard({
  event,
  eventServices,
  allServices,
  allSuppliers,
  groupedServices,
  isAdmin,
  isClient,
  isSupplier,
  currentSupplierId,
  editingSection,
  setEditingSection,
  editableServices,
  setEditableServices,
  allInclusiveData,
  setAllInclusiveData,
  handleSaveServices,
  isSavingServices,
  selectedServicesForAction,
  setSelectedServicesForAction,
  handleDeleteSelectedServices,
  setSelectedServicesForPackage,
  setShowAddToPackageDialog,
  setShowAddServiceDialog,
  setShowAddExistingPackageDialog,
  setShowPackageDialog,
  handleDragEnd,
  handleOpenEditPackage,
  handleOpenAddServiceToPackage,
  handleDeletePackage,
  updateSupplierStatus,
  handleRemoveSupplier,
  handleUpdateSupplierNote,
  loadEventData,
  savingServiceField,
  setSavingServiceField,
  handleUpdateServiceField,
  setSelectedServiceForSupplier,
  setSupplierFormData,
  setShowSupplierDialog,
  handleRemoveFromPackage,
  handleDeleteService
}) {
  const [expandedServices, setExpandedServices] = useState({});
  const [showNewServiceDialog, setShowNewServiceDialog] = useState(false);
  const [serviceTabs, setServiceTabs] = useState({}); // לניהול לשוניות עריכה לכל שירות
  const [copiedId, setCopiedId] = useState(null); // לניהול אייקון ה-V
  const [showNewSupplierDialog, setShowNewSupplierDialog] = useState(null);
  const queryClient = useQueryClient();
  const [showLocalSupplierDialog, setShowLocalSupplierDialog] = useState(false);
  const [localSelectedService, setLocalSelectedService] = useState(null);
  const [localSupplierFormData, setLocalSupplierFormData] = useState({ supplierIds: [], notes: {} });
  const [localSupplierSearchTerm, setLocalSupplierSearchTerm] = useState("");
  
  const [newService, setNewService] = useState({
    service_name: '',
    service_description: '',
    category: '',
    base_price: '',
    default_includes_vat: false
  });
  const [newSupplier, setNewSupplier] = useState({
    supplier_name: '',
    contact_person: '',
    phone: '',
    contact_emails: ['']
  });
  const [saveGlobalPackage, setSaveGlobalPackage] = useState(false);
  const [isSavingNewService, setIsSavingNewService] = useState(false);
  const [isSavingNewSupplier, setIsSavingNewSupplier] = useState(false);

  const toggleServiceExpanded = (serviceId) => {
    setExpandedServices(prev => ({ ...prev, [serviceId]: !prev[serviceId] }));
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
        default_min_suppliers: 0,
        is_active: true
      };
      
      const newServiceRecord = await Service.create(serviceData);
      
      // Auto-add to current event
      await base44.entities.EventService.create({
        event_id: event.id,
        service_id: newServiceRecord.id,
        custom_price: serviceData.base_price,
        quantity: 1,
        includes_vat: serviceData.default_includes_vat,
        service_description: serviceData.service_description,
        min_suppliers: 0,
        order_index: (eventServices.length + 1) * 10
      });

      await base44.functions.invoke('checkEventStatus', { eventId: event.id }).catch(console.error);
      await loadEventData();
      
      setNewService({
        service_name: '',
        service_description: '',
        category: '',
        base_price: '',
        default_includes_vat: false
      });
      setShowNewServiceDialog(false);
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
      
      const newSupplierRecord = await Supplier.create(supplierData);
      
      // Auto-assign to event service if opened from specific service context
      if (showNewSupplierDialog && typeof showNewSupplierDialog === 'string') {
        const eventServiceId = showNewSupplierDialog;
        const eventService = eventServices.find(es => es.id === eventServiceId);
        if (eventService) {
            let currentSupplierIds = [];
            try { currentSupplierIds = JSON.parse(eventService.supplier_ids || '[]'); } catch(e) {}
            const updatedSupplierIds = [...currentSupplierIds, newSupplierRecord.id];
            
            await base44.entities.EventService.update(eventServiceId, {
                supplier_ids: JSON.stringify(updatedSupplierIds)
            });
        }
      }

      await loadEventData();
      
      setNewSupplier({
        supplier_name: '',
        contact_person: '',
        phone: '',
        contact_emails: ['']
      });
      setShowNewSupplierDialog(null);
      await base44.functions.invoke('checkEventStatus', { eventId: event.id }).catch(console.error);
    } catch (error) {
      console.error("Failed to create supplier:", error);
      alert("שגיאה ביצירת הספק");
    } finally {
      setIsSavingNewSupplier(false);
    }
  };

  const handleOpenLocalSupplierDialog = (service) => {
    let currentNotes = {};
    let supplierIds = [];
    try {
      currentNotes = JSON.parse(service.supplier_notes || '{}');
      supplierIds = JSON.parse(service.supplier_ids || '[]');
    } catch (e) {}
    
    setLocalSelectedService(service);
    setLocalSupplierFormData({ supplierIds, notes: currentNotes });
    setLocalSupplierSearchTerm("");
    setShowLocalSupplierDialog(true);
  };

  const handleAssignLocalSuppliers = async () => {
    if (!localSelectedService) return;
    
    try {
      await base44.entities.EventService.update(localSelectedService.id, {
        supplier_ids: JSON.stringify(localSupplierFormData.supplierIds),
        supplier_notes: JSON.stringify(localSupplierFormData.notes)
      });

      setShowLocalSupplierDialog(false);
      setLocalSelectedService(null);
      setLocalSupplierFormData({ supplierIds: [], notes: {} });
      setLocalSupplierSearchTerm("");
      await base44.functions.invoke('checkEventStatus', { eventId: event.id }).catch(console.error);
      await loadEventData();
    } catch (error) {
      console.error("Failed to assign suppliers:", error);
      alert("שגיאה בשיבוץ הספקים");
    }
  };

  const handleSaveGlobalServiceDescription = async (serviceId, description) => {
    if (!window.confirm("האם אתה בטוח שברצונך לעדכן את התיאור הגלובלי של השירות? שינוי זה ישפיע על כל האירועים העתידיים.")) return;
    
    try {
      await Service.update(serviceId, { service_description: description });
      alert("תיאור השירות עודכן בהצלחה באופן גלובלי");
      queryClient.invalidateQueries({ queryKey: ['services'] });
    } catch (error) {
      console.error("Failed to update global service description:", error);
      alert("שגיאה בעדכון תיאור השירות");
    }
  };

  const handleContactSelect = (serviceId, contactData) => {
    const updatedServices = editableServices.map(s => 
      s.id === serviceId ? { 
        ...s, 
        on_site_contact_details: {
          name: contactData.name || '',
          phone: contactData.phone || ''
        }
      } : s
    );
    setEditableServices(updatedServices);
  };

const handleCopyTransport = (service, serviceDetails) => {
    const dateStr = event.event_date ? format(new Date(event.event_date), 'dd/MM/yyyy') : '';
    const eventLoc = event.location || '';
    const sName = serviceDetails?.service_name || 'שירות';

    let units = [];
    try {
      units = JSON.parse(service.pickup_point);
      if (!Array.isArray(units)) throw new Error();
    } catch {
      units = [{
        pickupPoints: [{
          time: service.standing_time || '',
          location: service.pickup_point || '',
          contact: service.on_site_contact_details || { name: '', phone: '' }
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
          fullText += `${dateStr}`;
          if (time) fullText += ` בשעה ${time}`;
          fullText += ` ${sName} מרחבת ${loc} ל${eventLoc}. איש קשר: ${cName}${cPhone ? ' ' + cPhone : ''}`;
        } else {
          fullText += `\nנקודת איסוף נוספת: בשעה ${time} במקום ${loc}, איש קשר במקום: ${cName}${cPhone ? ' ' + cPhone : ''}`;
        }
      });
    });

    navigator.clipboard.writeText(fullText).then(() => {
      setCopiedId(service.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };
  
  const renderServiceCard = (service, serviceDetails, assignedSuppliers, supplierIds, supplierNotes, currentSupplierNote, isSaving, isInPackage = false) => {
    const isExpanded = expandedServices[service.id];
    const isTransportService = serviceDetails?.category === 'נסיעות';
    
    // PERFECT FIX: Find the editable service from state
    const editableService = editableServices.find(es => es.id === service.id) || service;
    
    return (
      <div className="mb-2">
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-2 min-w-0">
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 min-w-0">
              {isAdmin && <GripVertical className="h-4 w-4 text-gray-400 shrink-0" />}
              <div className="font-medium break-words min-w-0 flex-1">{serviceDetails?.service_name || 'שירות'}</div>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleServiceExpanded(service.id)}
                  className="h-6 px-2"
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              )}
            </div>
            
            {/* תצוגה מכווצת */}
            {!isExpanded && (
              <div className="mr-6 space-y-1 min-w-0">
                {(service.service_description || serviceDetails?.service_description) && (
                  <div className="text-xs text-gray-500 break-words" dangerouslySetInnerHTML={{ __html: service.service_description || serviceDetails.service_description }} />
                )}
                {service.client_notes && (
                  <div className="text-xs text-gray-500 italic mt-1 break-words">הערה: {service.client_notes}</div>
                )}
                {!isInPackage && !isSupplier && service.quantity > 1 && (
                  <div className="text-sm text-gray-600">כמות: {service.quantity}</div>
                )}
                {/* תצוגת פרטי נסיעות - לקריאה בלבד */}
                                {/* תצוגת פרטי נסיעות - מתוקנת ומפורמטת */}
                {isTransportService && (
                  <div className="text-xs text-blue-700 bg-blue-50 p-2 rounded mt-1 space-y-2">
                    {(() => {
                      let units = [];
                      try {
                        const parsed = JSON.parse(service.pickup_point || '[]');
                        units = Array.isArray(parsed) ? parsed : [];
                      } catch (e) {
                        // תמיכה לאחור בפורמט ישן
                        if (service.pickup_point || service.standing_time) {
                           units = [{
                             pickupPoints: [{
                               time: service.standing_time,
                               location: service.pickup_point,
                               contact: service.on_site_contact_details
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
            
                        {/* תצוגה מורחבת - כל שדות העריכה */}
            {isExpanded && isAdmin && !isSupplier && !isClient && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mr-6 mt-2">
                {!event.all_inclusive && (
                  <div>
                    <Label className="text-xs">מחיר ליחידה</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        value={editableService.custom_price || ''}
                        onChange={(e) => {
                          const updatedServices = editableServices.map(s => 
                            s.id === service.id ? { ...s, custom_price: e.target.value } : s
                          );
                          setEditableServices(updatedServices);
                        }}
                        onBlur={(e) => handleUpdateServiceField(service.id, 'custom_price', e.target.value)}
                        className="text-sm h-8"
                        disabled={isSaving && savingServiceField?.field === 'custom_price'}
                      />
                      {isSaving && savingServiceField?.field === 'custom_price' && (
                        <Loader2 className="h-3 w-3 animate-spin absolute left-2 top-2.5 text-gray-400" />
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-xs">כמות</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={editableService.quantity || 1}
                      onChange={(e) => {
                        const updatedServices = editableServices.map(s => 
                          s.id === service.id ? { ...s, quantity: e.target.value } : s
                        );
                        setEditableServices(updatedServices);
                      }}
                      onBlur={(e) => handleUpdateServiceField(service.id, 'quantity', e.target.value)}
                      className="text-sm h-8"
                      disabled={isSaving && savingServiceField?.field === 'quantity'}
                    />
                    {isSaving && savingServiceField?.field === 'quantity' && (
                      <Loader2 className="h-3 w-3 animate-spin absolute left-2 top-2.5 text-gray-400" />
                    )}
                  </div>
                </div>
                
                {/* מינימום ספקים */}
                <div>
                   <div className="flex items-center gap-1 mb-1">
                    <Label className="text-xs">מינימום ספקים</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>כמות הספקים המינימלית הנדרשת לשירות זה</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Select 
                    value={String(editableService.min_suppliers !== undefined ? editableService.min_suppliers : (serviceDetails?.default_min_suppliers !== undefined && serviceDetails?.default_min_suppliers !== null ? serviceDetails.default_min_suppliers : 0))} 
                    onValueChange={(value) => handleUpdateServiceField(service.id, 'min_suppliers', value)}
                    disabled={isSaving && savingServiceField?.field === 'min_suppliers'}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="0" />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                        <SelectItem key={num} value={String(num)}>{num}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {!event.all_inclusive && (
                  <div className="flex items-end">
                    <div className="flex items-center gap-2 h-8">
                      <Checkbox
                        id={`vat-${service.id}`}
                        checked={editableService.includes_vat || false}
                        onCheckedChange={(checked) => handleUpdateServiceField(service.id, 'includes_vat', checked)}
                        disabled={isSaving && savingServiceField?.field === 'includes_vat'}
                      />
                      <Label htmlFor={`vat-${service.id}`} className="text-xs">כולל מע"מ</Label>
                      {isSaving && savingServiceField?.field === 'includes_vat' && (
                        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                      )}
                    </div>
                  </div>
                )}

                <div className="col-span-full">
                  <Label className="text-xs">תיאור לשירות (ספציפי לאירוע)</Label>
                  <div className="relative">
                    <ReactQuill
                      value={editableService.service_description || serviceDetails?.service_description || ''}
                      onChange={(value) => {
                        const updatedServices = editableServices.map(s => 
                          s.id === service.id ? { ...s, service_description: value } : s
                        );
                        setEditableServices(updatedServices);
                      }}
                      onBlur={() => handleUpdateServiceField(service.id, 'service_description', editableService.service_description)}
                      modules={{
                        toolbar: [
                          ['bold', 'italic', 'underline', { 'list': 'ordered'}, { 'list': 'bullet' }],
                          ['clean']
                        ],
                      }}
                      formats={['bold', 'italic', 'underline', 'list', 'bullet']}
                      className="bg-white"
                      style={{ fontSize: '13px' }}
                    />
                    {isSaving && savingServiceField?.field === 'service_description' && (
                      <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>שומר...</span>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <div className="text-xs text-blue-600 italic">שינוי כאן ישפיע רק על אירוע זה</div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-xs h-6 text-purple-700 hover:text-purple-900 hover:bg-purple-50"
                      onClick={() => handleSaveGlobalServiceDescription(service.service_id, editableService.service_description)}
                    >
                      עדכן כברירת מחדל גלובלית
                      <Save className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                </div>

                <div className="col-span-full">
                  <Label className="text-xs">הערות ללקוח (יופיעו בהצעת מחיר)</Label>
                  <div className="relative">
                    <Textarea
                      value={editableService.client_notes || ''}
                      onChange={(e) => {
                        const updatedServices = editableServices.map(s => 
                          s.id === service.id ? { ...s, client_notes: e.target.value } : s
                        );
                        setEditableServices(updatedServices);
                      }}
                      onBlur={(e) => handleUpdateServiceField(service.id, 'client_notes', e.target.value)}
                      className="text-sm"
                      rows={2}
                      disabled={isSaving && savingServiceField?.field === 'client_notes'}
                    />
                    {isSaving && savingServiceField?.field === 'client_notes' && (
                      <Loader2 className="h-3 w-3 animate-spin absolute left-2 top-2 text-gray-400" />
                    )}
                  </div>
                </div>

                {/* שדות נסיעות - הבלוק החדש והמתוקן */}
                {isTransportService && (
                  <div className="col-span-full space-y-4">
                    <Label className="text-xs font-semibold text-gray-500">פרטי נסיעה (נקודות איסוף ועצירה)</Label>
                    
                    {(() => {
                      let units = [];
                      try {
                        const parsed = JSON.parse(editableService.pickup_point || '[]');
                        units = Array.isArray(parsed) ? parsed : [];
                      } catch (e) {
                        units = [{
                          pickupPoints: [{
                            time: editableService.standing_time || '',
                            location: editableService.pickup_point || '',
                            contact: editableService.on_site_contact_details || { name: '', phone: '' }
                          }]
                        }];
                      }

                      // סנכרון כמות יחידות
                      const quantity = parseInt(String(editableService.quantity || 1)) || 1;
                      if (units.length < quantity) {
                        while (units.length < quantity) {
                          units.push({ pickupPoints: [{ time: '', location: '', contact: { name: '', phone: '' } }] });
                        }
                      }

                      const handleUnitsChange = (newUnits) => {
                        const firstPoint = newUnits[0]?.pickupPoints[0] || {};
                        const updatedServices = editableServices.map(s => s.id === service.id ? { 
                            ...s, 
                            pickup_point: JSON.stringify(newUnits),
                            standing_time: firstPoint.time || '',
                            on_site_contact_details: firstPoint.contact || { name: '', phone: '' }
                        } : s);
                        setEditableServices(updatedServices);
                      };

                      const saveTransportChanges = (newUnits) => {
                         handleUpdateServiceField(service.id, 'pickup_point', JSON.stringify(newUnits));
                         // סנכרון שדות לגאסי לתצוגה רגילה
                         const firstPoint = newUnits[0]?.pickupPoints[0] || {};
                         handleUpdateServiceField(service.id, 'standing_time', firstPoint.time || '');
                         handleUpdateServiceField(service.id, 'on_site_contact_details', firstPoint.contact || { name: '', phone: '' });
                      };

                      return units.map((unit, uIdx) => (
                        <div key={uIdx} className="p-4 border-2 border-red-100 rounded-xl bg-red-50/20 space-y-4">
                          <h3 className="font-bold text-red-900 flex justify-between items-center text-sm">
                            {units.length > 1 ? `רכב ${uIdx + 1}` : 'פרטי מסלול'}
                          </h3>

                          {unit.pickupPoints.map((point, pIdx) => (
                            <div key={pIdx} className="bg-white p-3 rounded-lg border shadow-sm space-y-3">
                              <div className="flex justify-between items-center">
                                <Label className="text-xs font-bold text-gray-500">נקודה {pIdx + 1}</Label>
                                {pIdx > 0 && (
                                  <Button type="button" variant="ghost" size="sm" className="text-red-500 h-6 w-6 p-0" onClick={() => {
                                    const newUnits = [...units];
                                    newUnits[uIdx].pickupPoints.splice(pIdx, 1);
                                    handleUnitsChange(newUnits);
                                    saveTransportChanges(newUnits);
                                  }}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">שעה</Label>
                                  <Input type="time" value={point.time || ''} onChange={(e) => {
                                    const newUnits = [...units];
                                    newUnits[uIdx].pickupPoints[pIdx].time = e.target.value;
                                    handleUnitsChange(newUnits);
                                  }} onBlur={() => saveTransportChanges(units)} className="text-sm h-8" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">מיקום</Label>
                                  <Input value={point.location || ''} onChange={(e) => {
                                    const newUnits = [...units];
                                    newUnits[uIdx].pickupPoints[pIdx].location = e.target.value;
                                    handleUnitsChange(newUnits);
                                  }} onBlur={() => saveTransportChanges(units)} className="text-sm h-8" />
                                </div>
                              </div>

                              <div className="space-y-1">
                                <Label className="text-xs">איש קשר</Label>
                                <div className="flex gap-2">
                                  <Input placeholder="שם" value={point.contact?.name || ''} onChange={(e) => {
                                    const newUnits = [...units];
                                    if (!newUnits[uIdx].pickupPoints[pIdx].contact) newUnits[uIdx].pickupPoints[pIdx].contact = {};
                                    newUnits[uIdx].pickupPoints[pIdx].contact.name = e.target.value;
                                    handleUnitsChange(newUnits);
                                  }} onBlur={() => saveTransportChanges(units)} className="text-sm h-8" />
                                  <Input placeholder="טלפון" value={point.contact?.phone || ''} onChange={(e) => {
                                    const newUnits = [...units];
                                    if (!newUnits[uIdx].pickupPoints[pIdx].contact) newUnits[uIdx].pickupPoints[pIdx].contact = {};
                                    newUnits[uIdx].pickupPoints[pIdx].contact.phone = e.target.value;
                                    handleUnitsChange(newUnits);
                                  }} onBlur={() => saveTransportChanges(units)} className="text-sm h-8" />
                                  <ContactPicker onContactSelect={(c) => {
                                    const newUnits = [...units];
                                    if (!newUnits[uIdx].pickupPoints[pIdx].contact) newUnits[uIdx].pickupPoints[pIdx].contact = {};
                                    newUnits[uIdx].pickupPoints[pIdx].contact.name = c.name;
                                    newUnits[uIdx].pickupPoints[pIdx].contact.phone = c.phone;
                                    handleUnitsChange(newUnits);
                                    saveTransportChanges(newUnits);
                                  }} />
                                </div>
                              </div>
                            </div>
                          ))}

                          <Button type="button" variant="outline" size="sm" className="w-full border-dashed border-red-200 text-red-800 text-xs" onClick={() => {
                            const newUnits = [...units];
                            newUnits[uIdx].pickupPoints.push({ time: '', location: '', contact: { name: '', phone: '' } });
                            handleUnitsChange(newUnits);
                            saveTransportChanges(newUnits);
                          }}>
                            <Plus className="h-3 w-3 ml-1" />
                            הוסף נקודה
                          </Button>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}

            {currentSupplierNote && (
              <div className="text-sm text-blue-600 font-medium mr-6 mt-2">
                הערה עבורך: {currentSupplierNote}
              </div>
            )}
            
            {/* שיבוץ ספקים - תמיד גלוי (אבל לא ללקוחות) */}
            {!isClient && assignedSuppliers.length > 0 && (
              <div className="mt-2 mr-6 space-y-2">
                {assignedSuppliers.map(sup => {
                  let supplierStatuses = {};
                  try {
                    supplierStatuses = JSON.parse(service.supplier_statuses || '{}');
                  } catch (e) {}
                  const status = supplierStatuses[sup.id] || 'pending';
                  const note = supplierNotes[sup.id] || '';

                  return (
                    <div key={sup.id} className="flex items-start gap-2 p-2 bg-white rounded border">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{sup.supplier_name}</span>
                          {isAdmin ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" className="h-6 text-xs">
                                  <Badge className={getSupplierAssignmentStatusColor(status)}>
                                    {getSupplierAssignmentStatusText(status)}
                                  </Badge>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <DropdownMenuItem onClick={() => updateSupplierStatus(service.id, sup.id, 'pending')}>בהמתנה</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => updateSupplierStatus(service.id, sup.id, 'confirmed')}>אושר</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => updateSupplierStatus(service.id, sup.id, 'rejected')}>נדחה</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Badge className={getSupplierAssignmentStatusColor(status)}>
                              {getSupplierAssignmentStatusText(status)}
                            </Badge>
                          )}
                          {isAdmin && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-6 w-6 p-0"
                              onClick={() => handleRemoveSupplier(service.id, sup.id)}
                            >
                              <X className="h-3 w-3 text-red-500" />
                            </Button>
                          )}
                        </div>
                        {isAdmin && (
                          <SupplierNoteInput
                            serviceId={service.id}
                            supplierId={sup.id}
                            initialNote={note}
                            handleUpdateSupplierNote={handleUpdateSupplierNote}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
          
          {/* מחיר וכפתורי פעולה - שורה נפרדת במובייל, צד שמאל בדסקטופ */}
          <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between lg:justify-start gap-3 mt-3 lg:mt-0 w-full lg:w-auto border-t lg:border-0 pt-2 lg:pt-0">
            {/* מחיר */}
            {!isInPackage && !isSupplier && !event.all_inclusive && (
              <div className="text-right lg:text-left lg:ml-4">
                <div className="text-lg font-bold text-red-800 whitespace-nowrap">
                  ₪{((parseFloat(service.custom_price) || 0) * (parseFloat(service.quantity) || 1)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                {(parseFloat(service.quantity) || 1) > 1 && (
                  <div className="text-xs text-gray-500 whitespace-nowrap">
                    {service.quantity} × ₪{(parseFloat(service.custom_price) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                )}
                <div className="text-xs text-gray-500 whitespace-nowrap">
                  {service.includes_vat ? 'כולל מע"מ' : 'לא כולל מע"מ'}
                </div>
              </div>
            )}
            
            {/* כפתורי פעולה */}
            {isAdmin && (
              <div className="flex flex-wrap gap-2 justify-end">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="text-xs">
                            שבץ ספק
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => setShowNewSupplierDialog(service.id)}>
                            <Plus className="h-3 w-3 ml-2" />
                            צור ספק חדש
                          </DropdownMenuItem>
                          <div className="border-t my-1"></div>
                          <DropdownMenuItem onClick={() => handleOpenLocalSupplierDialog(service)}>
                            בחר מרשימת ספקים
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>שבץ ספק לשירות זה</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {isInPackage && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => handleRemoveFromPackage(service.id)}>
                          <LogOut className="h-4 w-4 text-orange-500" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>הוצא שירות זה מהחבילה והפוך אותו לשירות עצמאי</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteService(service.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>מחק שירות זה מהאירוע</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const filteredLocalSuppliers = allSuppliers.filter(supplier =>
    supplier.supplier_name.toLowerCase().includes(localSupplierSearchTerm.toLowerCase())
  );

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h3 className="text-lg font-semibold">שירותים</h3>
          {isAdmin && !editingSection && (
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            {selectedServicesForAction.length > 0 && (
              <>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        size="sm" 
                        variant="destructive"
                        onClick={handleDeleteSelectedServices}
                      >
                        <Trash2 className="h-4 w-4 ml-2" />
                        מחק {selectedServicesForAction.length} שירותים
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>מחק את השירותים המסומנים מהאירוע</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        size="sm" 
                        onClick={() => {
                          setSelectedServicesForPackage(selectedServicesForAction);
                          setShowAddToPackageDialog(true);
                        }} 
                        className="bg-amber-600 hover:bg-amber-700"
                      >
                        <PackageIcon className="h-4 w-4 ml-2" />
                        הוסף {selectedServicesForAction.length} שירותים לחבילה
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>הוסף שירותים מסומנים לחבילה חדשה או קיימת</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
              <DropdownMenu>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" className="bg-green-600 hover:bg-green-700">
                          <Plus className="h-4 w-4 ml-2" />
                          הוסף שירות
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>הוסף שירות חדש או קיים לאירוע</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => setShowNewServiceDialog(true)}>
                    <Plus className="h-4 w-4 ml-2" />
                    צור שירות חדש
                  </DropdownMenuItem>
                  <div className="border-t my-1"></div>
                  <DropdownMenuItem onClick={() => setShowAddServiceDialog(true)}>
                    הוסף שירות קיים
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" onClick={() => setShowAddExistingPackageDialog(true)} className="bg-purple-600 hover:bg-purple-700">
                      <Plus className="h-4 w-4 ml-2" />הוסף חבילה קיימת
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>הוסף חבילת שירותים מוכנה מראש</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" onClick={() => setShowPackageDialog(true)} className="bg-red-800 hover:bg-red-700">צור חבילה</Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>צור חבילה חדשה ריקה</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={() => {
                      setEditingSection('services');
                      setAllInclusiveData({
                        all_inclusive: event.all_inclusive || false,
                        all_inclusive_price: event.all_inclusive_price || '',
                        all_inclusive_includes_vat: event.all_inclusive_includes_vat
                      });
                    }}>
                      <Edit className="h-4 w-4 ml-2" />הכל כלול
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>הגדר מחיר גלובלי לכל האירוע (דריסת מחירי שירותים)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editingSection === 'services' ? (
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded space-y-3">
              <div className="flex items-center gap-2">
                <Switch checked={allInclusiveData.all_inclusive} onCheckedChange={(checked) => setAllInclusiveData({ ...allInclusiveData, all_inclusive: checked })} />
                <Label>חבילת הכל כלול</Label>
              </div>
              {allInclusiveData.all_inclusive && (
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" placeholder="מחיר החבילה" value={allInclusiveData.all_inclusive_price} onChange={(e) => setAllInclusiveData({ ...allInclusiveData, all_inclusive_price: e.target.value })} />
                  <div className="flex items-center gap-2">
                    <Checkbox checked={allInclusiveData.all_inclusive_includes_vat} onCheckedChange={(checked) => setAllInclusiveData({ ...allInclusiveData, all_inclusive_includes_vat: checked })} />
                    <Label>כולל מע"מ</Label>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditingSection(null)} disabled={isSavingServices}>ביטול</Button>
              <Button onClick={handleSaveServices} disabled={isSavingServices}>
                {isSavingServices && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                <Save className="h-4 w-4 ml-2" />
                שמור
              </Button>
            </div>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="space-y-4">
              {event.all_inclusive && event.all_inclusive_price && !isSupplier && (
                <div className="p-4 bg-blue-50 rounded">
                  <strong>חבילת הכל כלול:</strong> ₪{event.all_inclusive_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  {event.all_inclusive_includes_vat && <span className="text-sm text-gray-600"> (כולל מע"מ)</span>}
                </div>
              )}

              <Droppable droppableId="packages" type="package" isDropDisabled={!isAdmin}>
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-4">
                    {groupedServices.packages.map((pkg, index) => {
                      return (
                        <Draggable key={pkg.package_id} draggableId={pkg.package_id} index={index} isDragDisabled={!isAdmin}>
                          {(provided) => (
                            <div ref={provided.innerRef} {...provided.draggableProps} className="border border-purple-200 rounded-lg overflow-hidden">
                              <div {...provided.dragHandleProps} className="bg-purple-50 p-3 flex items-center gap-2">
                                {isAdmin && <GripVertical className="h-5 w-5 text-gray-400" />}
                                <div className="flex-1">
                                  <strong className="text-purple-800">{pkg.package_name}</strong>
                                  {pkg.package_description && (
                                    <div className="text-sm text-gray-600 mt-1" dangerouslySetInnerHTML={{ __html: pkg.package_description }} />
                                  )}
                                  {!isSupplier && !event.all_inclusive && <div className="text-sm text-purple-600">₪{(pkg.package_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} {pkg.package_includes_vat && '(כולל מע"מ)'}</div>}
                                </div>
                                {isAdmin && (
                                 <div className="flex gap-1 sm:gap-2">
                                  <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="px-2 sm:px-3" 
                                    onClick={() => handleOpenEditPackage(pkg)}
                                  >
                                    <Edit className="h-4 w-4 sm:ml-1" />
                                    <span className="hidden sm:inline">ערוך חבילה</span>
                                  </Button>

                                  <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="px-2 sm:px-3" 
                                    onClick={() => handleOpenAddServiceToPackage(pkg.package_id)}
                                  >
                                    <Plus className="h-4 w-4 sm:ml-1" />
                                    <span className="hidden sm:inline">הוסף שירות</span>
                                  </Button>

                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    className="px-2 sm:px-3" 
                                    onClick={() => handleDeletePackage(pkg.package_id)}
                                  >
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  </Button>
                                </div>                                                       
                                )}
                              </div>
                              <Droppable droppableId={pkg.package_id} type="service-in-package" isDropDisabled={!isAdmin}>
                                {(provided) => (
                                  <div {...provided.droppableProps} ref={provided.innerRef} className="p-3 space-y-2">
                                    {pkg.services.map((service, sIndex) => {
                                      const serviceDetails = allServices.find(s => s.id === service.service_id);
                                      let supplierIds = [];
                                      let supplierNotes = {};
                                      try {
                                        supplierIds = JSON.parse(service.supplier_ids || '[]');
                                        supplierNotes = JSON.parse(service.supplier_notes || '{}');
                                      } catch (e) {}
                                      
                                      let assignedSuppliers = [];
                                      if (!isClient) {
                                        assignedSuppliers = allSuppliers.filter(sup => supplierIds.includes(sup.id));
                                        if (isSupplier && currentSupplierId) {
                                          assignedSuppliers = assignedSuppliers.filter(sup => sup.id === currentSupplierId);
                                        }
                                      }

                                      let currentSupplierNote = '';
                                      if (isSupplier && currentSupplierId && supplierNotes[currentSupplierId]) {
                                        currentSupplierNote = supplierNotes[currentSupplierId];
                                      }

                                      const isSaving = savingServiceField?.serviceId === service.id;

                                      return (
                                        <Draggable key={service.id} draggableId={service.id} index={sIndex} isDragDisabled={!isAdmin}>
                                          {(provided) => (
                                            <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className="p-3 bg-gray-50 rounded">
                                              {renderServiceCard(service, serviceDetails, assignedSuppliers, supplierIds, supplierNotes, currentSupplierNote, isSaving, true)}
                                            </div>
                                          )}
                                        </Draggable>
                                      );
                                    })}
                                    {provided.placeholder}
                                  </div>
                                )}
                              </Droppable>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>

              {groupedServices.standalone.length > 0 && (
                <Droppable droppableId="standalone" type="standalone" isDropDisabled={!isAdmin}>
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                      <h4 className="font-semibold text-sm text-gray-600">שירותים בודדים</h4>
                      {groupedServices.standalone.map((service, index) => {
                        const serviceDetails = allServices.find(s => s.id === service.service_id);
                        let supplierIds = [];
                        let supplierNotes = {};
                        try {
                          supplierIds = JSON.parse(service.supplier_ids || '[]');
                          supplierNotes = JSON.parse(service.supplier_notes || '{}');
                        } catch (e) {}
                        
                        let assignedSuppliers = [];
                        if (!isClient) {
                          assignedSuppliers = allSuppliers.filter(sup => supplierIds.includes(sup.id));
                          if (isSupplier && currentSupplierId) {
                            assignedSuppliers = assignedSuppliers.filter(sup => sup.id === currentSupplierId);
                          }
                        }
                        
                        const isSelected = selectedServicesForAction.includes(service.id);

                        let currentSupplierNote = '';
                        if (isSupplier && currentSupplierId && supplierNotes[currentSupplierId]) {
                          currentSupplierNote = supplierNotes[currentSupplierId];
                        }

                        const isSaving = savingServiceField?.serviceId === service.id;

                        return (
                          <Draggable key={service.id} draggableId={service.id} index={index} isDragDisabled={!isAdmin}>
                            {(provided) => (
                              <div ref={provided.innerRef} {...provided.draggableProps} className="border rounded p-3 bg-white">
                                <div className="flex justify-between items-start">
                                  <div className="flex gap-3 flex-1">
                                    {isAdmin && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Checkbox
                                              checked={isSelected}
                                              onCheckedChange={(checked) => {
                                                if (checked) {
                                                  setSelectedServicesForAction([...selectedServicesForAction, service.id]);
                                                } else {
                                                  setSelectedServicesForAction(selectedServicesForAction.filter(id => id !== service.id));
                                                }
                                              }}
                                              className="mt-1"
                                            />
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>סמן שירות לפעולות מרובות (כמו הוספה לחבילה)</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                    <div {...provided.dragHandleProps} className="flex-1">
                                      {renderServiceCard(service, serviceDetails, assignedSuppliers, supplierIds, supplierNotes, currentSupplierNote, isSaving, false)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              )}
            </div>
          </DragDropContext>
        )}
      </CardContent>
      
      <Dialog open={showLocalSupplierDialog} onOpenChange={setShowLocalSupplierDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>שיבוץ ספקים</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="חיפוש ספקים..."
                value={localSupplierSearchTerm}
                onChange={(e) => setLocalSupplierSearchTerm(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredLocalSuppliers.map(supplier => (
                <div key={supplier.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={localSupplierFormData.supplierIds.includes(supplier.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setLocalSupplierFormData({ ...localSupplierFormData, supplierIds: [...localSupplierFormData.supplierIds, supplier.id] });
                        } else {
                          const newNotes = { ...localSupplierFormData.notes };
                          delete newNotes[supplier.id];
                          setLocalSupplierFormData({ 
                            ...localSupplierFormData, 
                            supplierIds: localSupplierFormData.supplierIds.filter(id => id !== supplier.id),
                            notes: newNotes
                          });
                        }
                      }}
                    />
                    <Label>{supplier.supplier_name}</Label>
                  </div>
                  {localSupplierFormData.supplierIds.includes(supplier.id) && (
                    <div className="mr-6">
                      <Label className="text-xs">הערה לספק</Label>
                      <Input
                        placeholder="הערה ספציפית לספק זה..."
                        value={localSupplierFormData.notes[supplier.id] || ''}
                        onChange={(e) => {
                          setLocalSupplierFormData({
                            ...localSupplierFormData,
                            notes: {
                              ...localSupplierFormData.notes,
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
            <Button variant="outline" onClick={() => { setShowLocalSupplierDialog(false); setLocalSupplierSearchTerm(""); }}>ביטול</Button>
            <Button onClick={handleAssignLocalSuppliers}>שמור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showNewServiceDialog} onOpenChange={setShowNewServiceDialog}>
        <DialogContent className="max-w-md">
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
      
      <Dialog open={!!showNewSupplierDialog} onOpenChange={(open) => !open && setShowNewSupplierDialog(null)}>
        <DialogContent className="max-w-md">
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
            <Button variant="outline" onClick={() => setShowNewSupplierDialog(null)} disabled={isSavingNewSupplier}>
              ביטול
            </Button>
            <Button onClick={handleCreateSupplier} disabled={isSavingNewSupplier}>
              {isSavingNewSupplier ? 'שומר...' : 'צור ספק'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}