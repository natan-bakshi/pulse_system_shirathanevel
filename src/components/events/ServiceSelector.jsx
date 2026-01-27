import React, { useState, useEffect } from 'react';
import { Service } from '@/entities/Service';
import { Supplier } from '@/entities/Supplier';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Trash2, Edit, Plus, Building, Briefcase, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const quillModules = {
  toolbar: [
    ['bold', 'italic', 'underline'],
    [{'list': 'ordered'}, {'list': 'bullet'}],
    [{ 'align': [] }, { 'direction': 'rtl' }],
    ['clean']
  ],
};

export default function ServiceSelector({ selectedServices, onServicesChange, concept }) {
  const [allServices, setAllServices] = useState([]);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [expandedDescriptions, setExpandedDescriptions] = useState({});
  const [expandedSettings, setExpandedSettings] = useState({});
  const [savingDescription, setSavingDescription] = useState(null);
  
  const [showNewServiceDialog, setShowNewServiceDialog] = useState(false);
  const [newService, setNewService] = useState({
    service_name: '',
    service_description: '',
    category: '',
    base_price: '',
    default_includes_vat: false
  });
  const [isSavingService, setIsSavingService] = useState(false);

  const [showNewSupplierDialog, setShowNewSupplierDialog] = useState(false);
  const [newSupplier, setNewSupplier] = useState({
    supplier_name: '',
    contact_person: '',
    phone: '',
    contact_emails: ['']
  });
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [servicesList, suppliersList] = await Promise.all([
          Service.list(),
          Supplier.list()
        ]);
        
        setAllServices(servicesList);
        setAllSuppliers(suppliersList);
      } catch (error) {
        console.error("Failed to fetch services and suppliers:", error);
      }
    };
    fetchData();
  }, []);

  const toggleDescriptionEditor = (serviceId) => {
    setExpandedDescriptions(prev => ({
      ...prev,
      [serviceId]: !prev[serviceId]
    }));
  };

  const toggleSettings = (serviceId) => {
    setExpandedSettings(prev => ({
      ...prev,
      [serviceId]: !prev[serviceId]
    }));
  };

  const handleToggleAndSaveDescription = async (serviceInList) => {
    const serviceId = serviceInList.service_id;
    const isCurrentlyExpanded = expandedDescriptions[serviceId];

    if (isCurrentlyExpanded) {
        setSavingDescription(serviceId);
        try {
            const serviceDetailsFromDB = allServices.find(s => s.id === serviceId);
            const currentDescription = serviceInList.service_description;

            if (serviceDetailsFromDB && currentDescription !== serviceDetailsFromDB.service_description) {
                await Service.update(serviceId, { service_description: currentDescription });
                
                setAllServices(prevAllServices => prevAllServices.map(s => 
                    s.id === serviceId ? { ...s, service_description: currentDescription } : s
                ));
            }
        } catch (error) {
            console.error("Failed to update service description:", error);
            alert("שגיאה בעדכון תיאור השירות. השינויים לא נשמרו.");
            setSavingDescription(null);
            return;
        } finally {
            setSavingDescription(null);
        }
    }
    
    toggleDescriptionEditor(serviceId);
  };

  const handleAddService = (value) => {
    if (value === '__new_service__') {
      setShowNewServiceDialog(true);
      return;
    }
    
    const service = allServices.find(s => s.id === value);
    if (!service || selectedServices.some(s => s.service_id === value)) return;
    
    const newServiceEntry = {
      service_id: service.id,
      service_name: service.service_name,
      custom_price: service.base_price || 0,
      quantity: 1,
      includes_vat: service.default_includes_vat || false,
      client_notes: '',
      service_description: service.service_description || '',
      supplier_ids: '[]',
      supplier_statuses: '{}',
      supplier_notes: '{}',
      admin_notes: '',
      notes: ''
    };
    onServicesChange([...selectedServices, newServiceEntry]);
  };

  const handleRemoveService = (serviceId) => {
    onServicesChange(selectedServices.filter(s => s.service_id !== serviceId));
  };

  const handleServiceChange = (serviceId, field, value) => {
    const updatedServices = selectedServices.map(s => {
      if (s.service_id === serviceId) {
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

  const handleCreateService = async () => {
    setIsSavingService(true);
    try {
      const serviceData = {
        service_name: newService.service_name,
        service_description: newService.service_description,
        category: newService.category,
        base_price: parseFloat(newService.base_price) || 0,
        default_includes_vat: newService.default_includes_vat,
        is_active: true
      };
      
      const createdService = await Service.create(serviceData);
      setAllServices(prev => [...prev, createdService]);
      
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
      setIsSavingService(false);
    }
  };

  const handleCreateSupplier = async () => {
    setIsSavingSupplier(true);
    try {
      const supplierData = {
        supplier_name: newSupplier.supplier_name,
        contact_person: newSupplier.contact_person,
        phone: newSupplier.phone,
        contact_emails: newSupplier.contact_emails.filter(email => email.trim() !== ''),
        is_active: true
      };
      
      const createdSupplier = await Supplier.create(supplierData);
      setAllSuppliers(prev => [...prev, createdSupplier]);
      
      setNewSupplier({
        supplier_name: '',
        contact_person: '',
        phone: '',
        contact_emails: ['']
      });
      setShowNewSupplierDialog(false);
      
    } catch (error) {
      console.error("Failed to create supplier:", error);
      alert("שגיאה ביצירת הספק");
    } finally {
      setIsSavingSupplier(false);
    }
  };
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">בחירת שירותים</h3>
        <Select onValueChange={handleAddService}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="הוסף שירות חדש" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__new_service__" className="font-semibold text-blue-600">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                <span>+ צור שירות חדש</span>
              </div>
            </SelectItem>
            <div className="border-t my-1"></div>
            <div className="p-2">
              <Input
                placeholder="חפש שירות..."
                onChange={(e) => {
                  const searchTerm = e.target.value.toLowerCase();
                  const options = e.currentTarget.closest('[data-radix-popper-content]')
                                  .querySelectorAll('[role="option"]');
                  options.forEach(option => {
                    const text = option.textContent.toLowerCase();
                    const value = option.getAttribute('data-value');
                    if (value && value !== '__new_service__') {
                      option.style.display = text.includes(searchTerm) ? 'block' : 'none';
                    }
                  });
                }}
                className="mb-2"
              />
            </div>
            {allServices.map(service => (
              <SelectItem key={service.id} value={service.id}>
                {service.service_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedServices.map(service => {
        const serviceDetails = allServices.find(s => s.id === service.service_id);
        const isDescriptionExpanded = expandedDescriptions[service.service_id];
        const isSettingsExpanded = expandedSettings[service.service_id];
        const isSavingThisDescription = savingDescription === service.service_id;
        
        return (
          <Card key={service.service_id} className="bg-white overflow-hidden">
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex-grow">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold">{serviceDetails?.service_name || 'שירות לא ידוע'}</h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSettings(service.service_id)}
                      className="h-6 px-2"
                    >
                      {isSettingsExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  
                  {isSettingsExpanded && (
                    <>
                      <div className="mt-3">
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-gray-500">תיאור השירות:</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleAndSaveDescription(service)}
                            className="h-6 px-2 text-xs"
                            disabled={isSavingThisDescription}
                          >
                            {isSavingThisDescription ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                                <>
                                    {isDescriptionExpanded ? 'סגור עורך' : 'ערוך תיאור'}
                                    <Edit className="h-3 w-3 mr-1" />
                                </>
                            )}
                          </Button>
                        </div>
                        
                        {isDescriptionExpanded ? (
                          <div className="mt-2">
                            <ReactQuill 
                              theme="snow"
                              value={service.service_description || ''}
                              onChange={(content) => {
                                handleServiceChange(service.service_id, 'service_description', content);
                              }}
                              modules={quillModules}
                              placeholder="תיאור השירות שיוצג בהצעת המחיר..."
                              className="text-sm"
                            />
                          </div>
                        ) : (
                          <div 
                            className="text-xs text-gray-500 mt-1 p-2 bg-gray-50 rounded cursor-pointer"
                            onClick={() => handleToggleAndSaveDescription(service)}
                            dangerouslySetInnerHTML={{ 
                              __html: service.service_description || 'לחץ לעריכת תיאור השירות...' 
                            }}
                          />
                        )}
                      </div>
                      
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end">
                        <div>
                          <Label className="text-xs">מחיר ליחידה</Label>
                          <Input
                            type="number"
                            value={service.custom_price || ''}
                            onChange={(e) => handleServiceChange(service.service_id, 'custom_price', e.target.value)}
                            placeholder="מחיר"
                          />
                        </div>
                        <div className="flex items-center space-x-2 space-x-reverse pt-5">
                          <Checkbox
                            id={`vat-${service.service_id}`}
                            checked={service.includes_vat}
                            onCheckedChange={(checked) => handleServiceChange(service.service_id, 'includes_vat', checked)}
                          />
                          <Label htmlFor={`vat-${service.service_id}`} className="text-xs">כולל מע"מ</Label>
                        </div>
                        <div>
                          <Label className="text-xs">כמות</Label>
                          <Input
                            type="number"
                            value={service.quantity || ''}
                            onChange={(e) => handleServiceChange(service.service_id, 'quantity', e.target.value)}
                            placeholder="כמות"
                          />
                        </div>
                      </div>
                      <div className="mt-3">
                         <Label className="text-xs">הערה ללקוח (יוצג בהצעה)</Label>
                         <Input
                            value={service.client_notes || ''}
                            onChange={(e) => handleServiceChange(service.service_id, 'client_notes', e.target.value)}
                            placeholder="הערה שתוצג בהצעת המחיר עבור שירות זה"
                          />
                      </div>
                    </>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleRemoveService(service.service_id)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
      
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
              <Textarea
                value={newService.service_description}
                onChange={(e) => setNewService(prev => ({ ...prev, service_description: e.target.value }))}
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
            <Button variant="outline" onClick={() => setShowNewServiceDialog(false)} disabled={isSavingService}>
              ביטול
            </Button>
            <Button onClick={handleCreateService} disabled={isSavingService}>
              {isSavingService ? 'שומר...' : 'צור שירות'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showNewSupplierDialog} onOpenChange={setShowNewSupplierDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>יצירת ספק חדש</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>שם הספק</Label>
              <Input
                value={newSupplier.supplier_name}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, supplier_name: e.target.value }))}
                placeholder="שם הספק"
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
            <Button variant="outline" onClick={() => setShowNewSupplierDialog(false)} disabled={isSavingSupplier}>
              ביטול
            </Button>
            <Button onClick={handleCreateSupplier} disabled={isSavingSupplier}>
              {isSavingSupplier ? 'שומר...' : 'צור ספק'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}