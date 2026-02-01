import React, { useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Save, X, Plus, Search } from 'lucide-react';
import ContactPicker from '@/components/ui/ContactPicker';

export default function SupplierAssignmentDialog({
  isOpen,
  onClose,
  eventServiceData,
  eventName,
  serviceName,
  allServices,
  suppliers,
  onSaved
}) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [supplierSearchInDialog, setSupplierSearchInDialog] = useState('');
  const [showNewSupplierDialog, setShowNewSupplierDialog] = useState(false);
  const [isSavingNewSupplier, setIsSavingNewSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({
    supplier_name: '',
    contact_person: '',
    phone: '',
    contact_emails: ['']
  });

  const [editingService, setEditingService] = useState(null);

  // Initialize editing state when dialog opens
  React.useEffect(() => {
    if (isOpen && eventServiceData) {
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

      setEditingService({
        eventServiceId: eventServiceData.id,
        eventName,
        serviceName: serviceName || service?.service_name || 'שירות לא ידוע',
        supplierIds,
        supplierStatuses,
        supplierNotes,
        serviceNotes: eventServiceData.client_notes || '',
        minSuppliers: (eventServiceData.min_suppliers !== undefined && eventServiceData.min_suppliers !== null)
          ? eventServiceData.min_suppliers
          : (service?.default_min_suppliers || 0)
      });
    }
  }, [isOpen, eventServiceData, eventName, serviceName, allServices]);

  const handleSaveService = useCallback(async () => {
    if (!editingService) return;

    setIsSaving(true);
    try {
      await base44.entities.EventService.update(editingService.eventServiceId, {
        supplier_ids: JSON.stringify(editingService.supplierIds),
        supplier_statuses: JSON.stringify(editingService.supplierStatuses),
        supplier_notes: JSON.stringify(editingService.supplierNotes),
        client_notes: editingService.serviceNotes,
        min_suppliers: parseInt(editingService.minSuppliers) || 0
      });

      queryClient.invalidateQueries({ queryKey: ['eventServices'] });
      
      if (onSaved) onSaved();
      onClose();
    } catch (error) {
      console.error('Failed to save service:', error);
      alert('שגיאה בשמירת השירות');
    } finally {
      setIsSaving(false);
    }
  }, [editingService, queryClient, onSaved, onClose]);

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

  const filteredSuppliersInDialog = useMemo(() => {
    return suppliers.filter(supplier =>
      supplier.supplier_name.toLowerCase().includes(supplierSearchInDialog.toLowerCase())
    );
  }, [suppliers, supplierSearchInDialog]);

  if (!editingService) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>ניהול שיבוץ ספקים</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2 bg-gray-50 p-3 rounded-lg">
              <div className="text-sm text-gray-700"><span className="font-semibold">אירוע:</span> {editingService.eventName}</div>
              <div className="text-sm text-gray-700"><span className="font-semibold">שירות:</span> {editingService.serviceName}</div>
            </div>
            
            <div className="space-y-2">
              <Label>שיבוצים נדרשים</Label>
              <Select value={String(editingService.minSuppliers || 0)} onValueChange={(v) => setEditingService(p => ({ ...p, minSuppliers: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>הערות לשירות</Label>
              <Textarea 
                value={editingService.serviceNotes} 
                onChange={(e) => setEditingService(p => ({ ...p, serviceNotes: e.target.value }))} 
                className="resize-none" 
              />
            </div>
            
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
                    {suppliers.filter(s => editingService.supplierIds.includes(s.id)).map(s => (
                      <div key={s.id} className="p-2 rounded-lg border bg-green-50 border-green-200 flex items-center justify-between group">
                        <div className="text-sm font-medium text-green-900">{s.supplier_name}</div>
                        <button onClick={() => handleToggleSupplier(s.id)} className="p-1 hover:bg-red-100 text-red-500 rounded-full transition-colors" title="הסר שיבוץ">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>ביטול</Button>
            <Button onClick={handleSaveService} className="bg-red-800 hover:bg-red-700">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 ml-2" />}
              שמור שינויים
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Supplier Dialog */}
      <Dialog open={showNewSupplierDialog} onOpenChange={setShowNewSupplierDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>יצירת ספק חדש</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>שם הספק</Label>
                <Input value={newSupplier.supplier_name} onChange={(e) => setNewSupplier(prev => ({ ...prev, supplier_name: e.target.value }))} placeholder="שם הספק" />
              </div>
              <ContactPicker onContactSelect={(contactData) => { 
                setNewSupplier(prev => ({ 
                  ...prev, 
                  supplier_name: contactData.name || prev.supplier_name, 
                  contact_person: contactData.name || prev.contact_person, 
                  phone: contactData.phone || prev.phone, 
                  contact_emails: contactData.email ? [contactData.email] : prev.contact_emails 
                })); 
              }} className="mb-1" />
            </div>
            <div>
              <Label>איש קשר</Label>
              <Input value={newSupplier.contact_person} onChange={(e) => setNewSupplier(prev => ({ ...prev, contact_person: e.target.value }))} placeholder="שם איש הקשר" />
            </div>
            <div>
              <Label>טלפון</Label>
              <Input value={newSupplier.phone} onChange={(e) => setNewSupplier(prev => ({ ...prev, phone: e.target.value }))} placeholder="מספר טלפון" />
            </div>
            <div>
              <Label>אימייל</Label>
              <Input type="email" value={newSupplier.contact_emails[0]} onChange={(e) => setNewSupplier(prev => ({ ...prev, contact_emails: [e.target.value] }))} placeholder="כתובת אימייל" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewSupplierDialog(false)} disabled={isSavingNewSupplier}>ביטול</Button>
            <Button onClick={handleCreateSupplier} disabled={isSavingNewSupplier} className="bg-red-800 hover:bg-red-700">
              {isSavingNewSupplier ? (<><Loader2 className="h-4 w-4 ml-2 animate-spin" />שומר...</>) : ('צור ספק')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}