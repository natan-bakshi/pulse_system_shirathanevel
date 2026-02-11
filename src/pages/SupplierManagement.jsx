import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, Edit, Trash2, Phone, Mail, Save, Loader2, Users, ChevronDown, ChevronUp, Link as LinkIcon, Calendar, Download, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ContactPicker from "../components/ui/ContactPicker";
import PhoneNumber from "../components/ui/PhoneNumber";
import EmailAddress from "../components/ui/EmailAddress";
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import ExportDialog from "../components/export/ExportDialog";

const SupplierEventsList = ({ supplierId }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadSupplierEvents = useCallback(async () => {
    setLoading(true);
    try {
      const allEventServices = await base44.entities.EventService.list();
      const allEvents = await base44.entities.Event.list();
      const allServices = await base44.entities.Service.list();
      
      const supplierEventServices = allEventServices.filter(es => {
        let ids = [];
        try { ids = JSON.parse(es.supplier_ids || '[]'); } catch(e) {}
        return ids.includes(supplierId);
      });

      const eventDetails = supplierEventServices.map(es => {
        const event = allEvents.find(e => e.id === es.event_id);
        const service = allServices.find(s => s.id === es.service_id);
        return {
          ...event,
          serviceName: service?.service_name || 'לא ידוע',
          eventServiceId: es.id
        };
      }).filter(Boolean);
      
      setEvents(eventDetails);
    } catch (error) {
      console.error('Failed to load supplier events:', error);
    } finally {
      setLoading(false);
    }
  }, [supplierId]);
  
  useEffect(() => {
    loadSupplierEvents();
  }, [loadSupplierEvents]);

  const removeSupplierFromEvent = useCallback(async (eventServiceId) => {
    if (!window.confirm("האם להסיר את הספק מהאירוע?")) return;
    try {
      const eventService = await base44.entities.EventService.get(eventServiceId);
      let supplierIds = [];
      try { supplierIds = JSON.parse(eventService.supplier_ids || '[]'); } catch(e) {}
      
      const newSupplierIds = supplierIds.filter(id => id !== supplierId);
      
      await base44.entities.EventService.update(eventServiceId, { supplier_ids: JSON.stringify(newSupplierIds) });
      
      loadSupplierEvents();
    } catch(error) {
      console.error("Failed to remove supplier from event:", error);
      alert("שגיאה בהסרת הספק מהאירוע.");
    }
  }, [supplierId, loadSupplierEvents]);

  if (loading) return <div className="p-4 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>;
  if (events.length === 0) return <p className="p-4 text-sm text-gray-500">הספק אינו משובץ לאירועים.</p>;

  return (
    <div className="space-y-2 mt-2">
      {events.map(event => (
        <div key={`${event.id}-${event.eventServiceId}`} className="flex justify-between items-center bg-gray-50 p-2 rounded">
          <div className="text-sm">
            <Link to={createPageUrl(`EventDetails?id=${event.id}`)} className="font-medium text-blue-600 hover:underline">
              משפחת {event.family_name}
            </Link>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Calendar className="h-3 w-3" />
              {format(new Date(event.event_date), 'dd/MM/yy')}
              <span className="text-gray-400">|</span>
              <span>שירות: {event.serviceName}</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => removeSupplierFromEvent(event.eventServiceId)} title="הסר מהאירוע">
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      ))}
    </div>
  );
};

export default function SupplierManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("supplier_name");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [expandedSuppliers, setExpandedSuppliers] = useState({});
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [formData, setFormData] = useState({
    supplier_name: "",
    contact_person: "",
    phone: "",
    contact_emails: "",
    services_provided: "",
    whatsapp_group_url: "",
    whatsapp_enabled: true,
    preferred_channel: "phone"
  });

  // Debouncing effect for search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const { data: suppliers = [], isLoading: loading, refetch } = useQuery({
    queryKey: ['suppliers', sortBy],
    queryFn: () => base44.entities.Supplier.list(sortBy),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000
  });
  
  const toggleSupplierExpansion = useCallback((supplierId) => {
    setExpandedSuppliers(prev => ({ ...prev, [supplierId]: !prev[supplierId] }));
  }, []);

  const handleContactSelect = useCallback((contactData) => {
    setFormData(prev => ({
      ...prev,
      supplier_name: contactData.name || prev.supplier_name,
      contact_person: contactData.name || prev.contact_person,
      phone: contactData.phone || prev.phone,
      contact_emails: contactData.email ? contactData.email : prev.contact_emails
    }));
  }, []);

  const handleNew = useCallback(() => {
    setEditingSupplier(null);
    setFormData({
      supplier_name: "",
      contact_person: "",
      phone: "",
      contact_emails: "",
      services_provided: "",
      whatsapp_group_url: "",
      whatsapp_enabled: true,
      preferred_channel: "phone"
    });
    setIsDialogOpen(true);
  }, []);
  
  const handleEdit = useCallback((supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      supplier_name: supplier.supplier_name,
      contact_person: supplier.contact_person,
      phone: supplier.phone,
      contact_emails: (supplier.contact_emails || []).join(', '),
      services_provided: (supplier.services_provided || []).join(', '),
      whatsapp_group_url: supplier.whatsapp_group_url || "",
      whatsapp_enabled: supplier.whatsapp_enabled ?? true,
      preferred_channel: supplier.preferred_channel || "phone"
    });
    setIsDialogOpen(true);
  }, []);

  const handleDelete = useCallback(async (supplierId) => {
    if(window.confirm("האם למחוק ספק זה?")) {
      try {
        await base44.entities.Supplier.delete(supplierId);
        refetch();
      } catch(error) {
        console.error("Failed to delete supplier:", error);
      }
    }
  }, [refetch]);
  
  const handleSaveSupplier = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const dataToSave = {
        ...formData,
        contact_emails: formData.contact_emails.split(',').map(s => s.trim()).filter(Boolean),
        services_provided: formData.services_provided.split(',').map(s => s.trim()).filter(Boolean),
        whatsapp_group_url: formData.whatsapp_group_url,
        whatsapp_enabled: formData.whatsapp_enabled,
        preferred_channel: formData.preferred_channel
      };
      
      if (editingSupplier) {
        await base44.entities.Supplier.update(editingSupplier.id, dataToSave);
      } else {
        await base44.entities.Supplier.create(dataToSave);
      }
      setIsDialogOpen(false);
      refetch();
    } catch(error) {
      console.error("Failed to save supplier:", error);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, formData, editingSupplier, refetch]);

  const filteredSuppliers = useMemo(() => {
    return (suppliers || []).filter(s => {
      const term = debouncedSearchTerm.toLowerCase();
      
      const nameMatch = (s.supplier_name || "").toLowerCase().includes(term);
      const contactMatch = (s.contact_person || "").toLowerCase().includes(term);
      const phoneMatch = (s.phone || "").toLowerCase().includes(term);
      const emailMatch = Array.isArray(s.contact_emails) && 
        s.contact_emails.some(email => (email || "").toLowerCase().includes(term));
      const servicesMatch = Array.isArray(s.services_provided) && 
        s.services_provided.some(service => (service || "").toLowerCase().includes(term));
      
      return nameMatch || contactMatch || phoneMatch || emailMatch || servicesMatch;
    });
  }, [suppliers, debouncedSearchTerm]);
  
  const exportColumns = useMemo(() => [
    { key: 'supplier_name', title: 'שם ספק' },
    { key: 'contact_person', title: 'איש קשר' },
    { key: 'phone', title: 'טלפון' },
    { key: 'contact_emails', title: 'אימיילים', render: (val) => Array.isArray(val) ? val.join(', ') : '' },
    { key: 'services_provided', title: 'שירותים', render: (val) => Array.isArray(val) ? val.join(', ') : '' },
  ], []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-white">ניהול ספקים</h1>
        <div className="flex gap-2">
            <Button onClick={() => setShowExportDialog(true)} variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20">
              <Download className="h-4 w-4 ml-2" />
              ייצא
            </Button>
            <Button onClick={handleNew} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg">
              <Plus className="h-4 w-4 ml-2" />
              הוסף ספק
            </Button>
        </div>
      </div>

      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="חיפוש ספקים..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="sort-suppliers" className="whitespace-nowrap">מיין לפי:</Label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger id="sort-suppliers" className="w-full">
                  <SelectValue placeholder="בחר מיון" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supplier_name">שם ספק (א-ת)</SelectItem>
                  <SelectItem value="-supplier_name">שם ספק (ת-א)</SelectItem>
                  <SelectItem value="-created_date">תאריך הוספה (החדש ביותר)</SelectItem>
                  <SelectItem value="created_date">תאריך הוספה (הישן ביותר)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSuppliers.map(supplier => (
          <Card key={supplier.id} className="bg-white/95 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-shadow duration-300 flex flex-col">
            <CardHeader className="cursor-pointer" onClick={() => toggleSupplierExpansion(supplier.id)}>
              <div className="flex justify-between items-start">
                  <div>
                      <CardTitle>{supplier.supplier_name}</CardTitle>
                      <p className="text-sm text-gray-600">{supplier.contact_person}</p>
                  </div>
                  {expandedSuppliers[supplier.id] ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </div>
            </CardHeader>
            <CardContent className="flex-grow">
              <div className="space-y-2 text-sm">
                <PhoneNumber phone={supplier.phone} />
                {(supplier.contact_emails || []).map(email => (
                    <EmailAddress key={email} email={email} />
                ))}
                <div className="pt-2">
                    <h4 className="text-sm font-semibold mb-1">שירותים:</h4>
                    <div className="flex flex-wrap gap-2">
                        {(supplier.services_provided || []).map(service => (
                            <Badge key={service} variant="secondary">{service}</Badge>
                        ))}
                    </div>
                </div>
                {supplier.whatsapp_enabled && (
                  <div className="pt-2 flex items-center gap-2 text-green-600 text-xs font-medium">
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>WhatsApp פעיל ({supplier.preferred_channel === 'group' ? 'קבוצה' : supplier.preferred_channel === 'both' ? 'קבוצה + פרטי' : 'פרטי'})</span>
                  </div>
                )}
              </div>
              {expandedSuppliers[supplier.id] && <SupplierEventsList supplierId={supplier.id} />}
            </CardContent>
            <div className="border-t p-4 flex gap-2">
                 <Button onClick={() => handleEdit(supplier)} variant="outline" size="sm" className="w-full"><Edit className="h-3 w-3 ml-1"/> עריכה</Button>
                 <Button onClick={() => handleDelete(supplier.id)} variant="outline" size="sm" className="text-red-600 hover:text-red-700 w-full"><Trash2 className="h-3 w-3 ml-1"/> מחיקה</Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? 'ערוך ספק' : 'הוסף ספק'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-2">
              <Input 
                id="s_name" 
                value={formData.supplier_name} 
                onChange={e => setFormData({...formData, supplier_name: e.target.value})}
                placeholder="שם הספק"
                className="flex-1"
              />
              <ContactPicker 
                onContactSelect={handleContactSelect}
                className="shrink-0"
              />
            </div>
            <div><Label htmlFor="s_contact">איש קשר</Label><Input id="s_contact" value={formData.contact_person} onChange={e => setFormData({...formData, contact_person: e.target.value})} /></div>
            <div><Label htmlFor="s_phone">טלפון</Label><Input id="s_phone" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} /></div>
            <div><Label htmlFor="s_emails">אימיילים (מופרדים בפסיק)</Label><Input id="s_emails" value={formData.contact_emails} onChange={e => setFormData({...formData, contact_emails: e.target.value})} /></div>
            
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center gap-2 mb-4">
                <MessageCircle className="h-5 w-5 text-green-600" />
                <h3 className="font-semibold text-gray-900">הגדרות WhatsApp</h3>
              </div>
              
              <div className="grid gap-4">
                <div className="flex items-center justify-between border p-3 rounded-md bg-green-50/50">
                  <Label htmlFor="s_wa_enabled" className="cursor-pointer flex-1">הפעל התראות WhatsApp</Label>
                  <Switch 
                    id="s_wa_enabled" 
                    checked={formData.whatsapp_enabled} 
                    onCheckedChange={checked => setFormData({...formData, whatsapp_enabled: checked})} 
                  />
                </div>

                {formData.whatsapp_enabled && (
                  <>
                    <div>
                      <Label htmlFor="s_wa_channel">ערוץ מועדף</Label>
                      <Select 
                        value={formData.preferred_channel} 
                        onValueChange={val => setFormData({...formData, preferred_channel: val})}
                      >
                        <SelectTrigger id="s_wa_channel">
                          <SelectValue placeholder="בחר ערוץ" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="phone">טלפון ישיר</SelectItem>
                          <SelectItem value="group">קבוצת WhatsApp</SelectItem>
                          <SelectItem value="both">גם וגם</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="s_wa_group">קישור לקבוצת WhatsApp</Label>
                      <div className="relative">
                        <LinkIcon className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                        <Input 
                          id="s_wa_group" 
                          value={formData.whatsapp_group_url} 
                          onChange={e => setFormData({...formData, whatsapp_group_url: e.target.value})} 
                          placeholder="https://chat.whatsapp.com/..."
                          className="pr-10 dir-ltr text-left"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mt-4"><Label htmlFor="s_services">שירותים (מופרדים בפסיק)</Label><Textarea id="s_services" value={formData.services_provided} onChange={e => setFormData({...formData, services_provided: e.target.value})} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>ביטול</Button>
            <Button onClick={handleSaveSupplier} disabled={isSaving}>
              {isSaving ? <Loader2 className="animate-spin h-4 w-4 ml-2" /> : <Save className="h-4 w-4 ml-2"/>}
              שמור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        data={filteredSuppliers}
        columns={exportColumns}
        title="רשימת ספקים"
        exportTypes={['csv', 'html']}
      />
    </div>
  );
}