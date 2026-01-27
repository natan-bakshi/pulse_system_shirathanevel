import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Edit, Trash2, Star, Settings, Loader2, Download, Package as PackageIcon, X, GripVertical, HelpCircle } from "lucide-react";
import ConceptDefaultsManager from "../components/services/ConceptDefaultsManager";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ExportDialog from "../components/export/ExportDialog";
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

export default function ServiceManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false);
  const [isConceptsOpen, setIsConceptsOpen] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [editingPackage, setEditingPackage] = useState(null);
  const [activeTab, setActiveTab] = useState("services");
  
  const [formData, setFormData] = useState({
    service_name: "",
    service_description: "",
    base_price: "",
    category: "",
    default_includes_vat: false,
    default_min_suppliers: 0,
    admin_notes: "",
  });

  const [packageFormData, setPackageFormData] = useState({
    package_name: "",
    package_description: "",
    package_price: "",
    package_includes_vat: false,
    service_ids: [],
    category: ""
  });
  const [packageServiceSearchTerm, setPackageServiceSearchTerm] = useState("");

  const queryClient = useQueryClient();

  // Debouncing effect for search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // React Query for services
  const { data: services = [], isLoading: servicesLoading } = useQuery({
    queryKey: ['services'],
    queryFn: () => base44.entities.Service.list(),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => {
      const servicesArray = Array.isArray(data) ? data : [];
      // Sort by default_order_index, then by service_name if default_order_index is null/undefined
      return servicesArray.sort((a, b) => {
        if (a.default_order_index != null && b.default_order_index != null) {
          return a.default_order_index - b.default_order_index;
        }
        if (a.default_order_index != null) return -1;
        if (b.default_order_index != null) return 1;
        return (a.service_name || "").localeCompare(b.service_name || "");
      });
    }
  });

  // React Query for packages
  const { data: packages = [], isLoading: packagesLoading } = useQuery({
    queryKey: ['packages'],
    queryFn: () => base44.entities.Package.list('package_name'),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  const loading = servicesLoading || packagesLoading;

  // Handler for drag and drop reordering of services
  const handleServiceDragEnd = useCallback(async (result) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;

    const currentFilteredServices = services.filter(service =>
      service.service_name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (service.category && service.category.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
    );

    const reorderedServices = Array.from(currentFilteredServices);
    const [movedService] = reorderedServices.splice(result.source.index, 1);
    reorderedServices.splice(result.destination.index, 0, movedService);

    const newOrderMap = new Map();
    reorderedServices.forEach((service, index) => {
      newOrderMap.set(service.id, index);
    });

    const fullServiceUpdates = services.map(service => ({
      ...service,
      default_order_index: newOrderMap.has(service.id) ? newOrderMap.get(service.id) : service.default_order_index
    }));

    // Optimistically update the cache with the new order
    queryClient.setQueryData(['services'], fullServiceUpdates.sort((a, b) => {
      if (a.default_order_index != null && b.default_order_index != null) {
        return a.default_order_index - b.default_order_index;
      }
      if (a.default_order_index != null) return -1;
      if (b.default_order_index != null) return 1;
      return (a.service_name || "").localeCompare(b.service_name || "");
    }));

    try {
      const updatesToDb = reorderedServices.map((service, index) => 
        base44.entities.Service.update(service.id, { default_order_index: index })
      );
      await Promise.all(updatesToDb);
      queryClient.invalidateQueries({ queryKey: ['services'] });
    } catch (error) {
      console.error("Failed to reorder services:", error);
      queryClient.invalidateQueries({ queryKey: ['services'] });
    }
  }, [services, queryClient, debouncedSearchTerm]);


  const handleEdit = useCallback((service) => {
    setEditingService(service);
    setFormData({
      service_name: service.service_name,
      service_description: service.service_description,
      base_price: service.base_price,
      category: service.category,
      default_includes_vat: service.default_includes_vat || false,
      default_min_suppliers: service.default_min_suppliers || 0,
      admin_notes: service.admin_notes || "",
    });
    setIsDialogOpen(true);
  }, []);

  const handleNew = useCallback(() => {
    setEditingService(null);
    setFormData({
      service_name: "",
      service_description: "",
      base_price: "",
      category: "",
      default_includes_vat: false,
      default_min_suppliers: 0,
      admin_notes: "",
    });
    setIsDialogOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const dataToSave = { ...formData, base_price: parseFloat(formData.base_price) || 0 };
      if (editingService) {
        await base44.entities.Service.update(editingService.id, dataToSave);
      } else {
        const maxOrderIndex = services.reduce((max, s) => Math.max(max, s.default_order_index || 0), -1);
        dataToSave.default_order_index = maxOrderIndex + 1;
        await base44.entities.Service.create(dataToSave);
      }
      setIsDialogOpen(false);
      
      queryClient.invalidateQueries({ queryKey: ['services'] });
    } catch (error) {
      console.error("Failed to save service:", error);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, formData, editingService, queryClient, services]);

  const handleDelete = useCallback(async (serviceId) => {
    if (window.confirm("האם אתה בטוח שברצונך למחוק שירות זה?")) {
      try {
        await base44.entities.Service.delete(serviceId);
        
        queryClient.invalidateQueries({ queryKey: ['services'] });
      } catch (error) {
        console.error("Failed to delete service:", error);
      }
    }
  }, [queryClient]);

  const toggleDefault = useCallback(async (service) => {
    try {
      await base44.entities.Service.update(service.id, { is_default: !service.is_default });
      
      queryClient.invalidateQueries({ queryKey: ['services'] });
    } catch (error) {
      console.error("Failed to toggle default status:", error);
    }
  }, [queryClient]);
  
  const toggleDefaultVat = useCallback(async (service) => {
    try {
      await base44.entities.Service.update(service.id, { default_includes_vat: !service.default_includes_vat });
      
      queryClient.invalidateQueries({ queryKey: ['services'] });
    } catch (error) {
      console.error("Failed to toggle default VAT status:", error);
    }
  }, [queryClient]);

  const handleEditPackage = useCallback((pkg) => {
    setEditingPackage(pkg);
    setPackageFormData({
      package_name: pkg.package_name,
      package_description: pkg.package_description || "",
      package_price: pkg.package_price,
      package_includes_vat: pkg.package_includes_vat || false,
      service_ids: pkg.service_ids || [],
      category: pkg.category || ""
    });
    setIsPackageDialogOpen(true);
  }, []);

  const handleNewPackage = useCallback(() => {
    setEditingPackage(null);
    setPackageFormData({
      package_name: "",
      package_description: "",
      package_price: "",
      package_includes_vat: false,
      service_ids: [],
      category: ""
    });
    setIsPackageDialogOpen(true);
  }, []);

  const handleSavePackage = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const dataToSave = { 
        ...packageFormData, 
        package_price: parseFloat(packageFormData.package_price) || 0,
        is_active: true
      };
      if (editingPackage) {
        await base44.entities.Package.update(editingPackage.id, dataToSave);
      } else {
        await base44.entities.Package.create(dataToSave);
      }
      setIsPackageDialogOpen(false);
      
      queryClient.invalidateQueries({ queryKey: ['packages'] });
    } catch (error) {
      console.error("Failed to save package:", error);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, packageFormData, editingPackage, queryClient]);

  const handleDeletePackage = useCallback(async (packageId) => {
    if (window.confirm("האם אתה בטוח שברצונך למחוק חבילה זו?")) {
      try {
        await base44.entities.Package.delete(packageId);
        
        queryClient.invalidateQueries({ queryKey: ['packages'] });
      } catch (error) {
        console.error("Failed to delete package:", error);
      }
    }
  }, [queryClient]);

  const handleAddServiceToPackage = useCallback((serviceId) => {
    if (!packageFormData.service_ids.includes(serviceId)) {
      setPackageFormData(prev => ({
        ...prev,
        service_ids: [...prev.service_ids, serviceId]
      }));
    }
  }, [packageFormData.service_ids]);

  const handleRemoveServiceFromPackage = useCallback((serviceId) => {
    setPackageFormData(prev => ({
      ...prev,
      service_ids: prev.service_ids.filter(id => id !== serviceId)
    }));
  }, []);

  const filteredServices = useMemo(() => {
    return services.filter(service =>
      service.service_name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (service.category && service.category.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
    );
  }, [services, debouncedSearchTerm]);

  const filteredPackages = useMemo(() => {
    return packages.filter(pkg =>
      pkg.package_name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (pkg.category && pkg.category.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
    );
  }, [packages, debouncedSearchTerm]);
  
  const exportColumns = useMemo(() => [
    { key: 'service_name', title: 'שם השירות' },
    { key: 'service_description', title: 'תיאור' },
    { key: 'base_price', title: 'מחיר בסיס' },
    { key: 'category', title: 'קטגוריה' },
    { key: 'is_default', title: 'ברירת מחדל', render: (val) => val ? 'כן' : 'לא' },
    { key: 'default_includes_vat', title: 'כולל מע"מ כברירת מחדל', render: (val) => val ? 'כן' : 'לא' },
    { key: 'default_min_suppliers', title: 'מינימום ספקים' },
    { key: 'admin_notes', title: 'הערות מנהל' },
  ], []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Loader2 className="h-12 w-12 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">ניהול שירותים וחבילות</h1>
          <p className="text-white/80 mt-1">הוסף, ערוך ונהל את כל השירותים והחבילות המוצעים</p>
        </div>
        <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setShowExportDialog(true)} variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20">
              <Download className="h-4 w-4 ml-2" />
              ייצא
            </Button>
            <Button onClick={() => setIsConceptsOpen(true)} variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20">
                <Settings className="h-4 w-4 ml-2" />
                נהל ברירות מחדל
            </Button>
            {activeTab === "services" && (
              <Button onClick={handleNew} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg">
                  <Plus className="h-4 w-4 ml-2" />
                  שירות חדש
              </Button>
            )}
            {activeTab === "packages" && (
              <Button onClick={handleNewPackage} className="bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg">
                  <Plus className="h-4 w-4 ml-2" />
                  חבילה חדשה
              </Button>
            )}
        </div>
      </div>

      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardContent className="p-6">
          <div className="relative">
            <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="חיפוש שירות או חבילה..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-10"
            />
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-white/95 backdrop-blur-sm">
          <TabsTrigger value="services">שירותים</TabsTrigger>
          <TabsTrigger value="packages">חבילות</TabsTrigger>
        </TabsList>
        
        <TabsContent value="services" className="mt-6">
          <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-800">💡 גרור ושחרר שירותים לשינוי סדר ברירת המחדל שלהם באירועים חדשים</p>
          </div>
          
          <DragDropContext onDragEnd={handleServiceDragEnd}>
            <Droppable droppableId="services-list">
              {(provided) => (
                <div 
                  {...provided.droppableProps} 
                  ref={provided.innerRef}
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                >
                  {filteredServices.map((service, index) => (
                    <Draggable key={service.id} draggableId={service.id} index={index}>
                      {(provided, snapshot) => (
                        <Card 
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`bg-white/95 backdrop-blur-sm shadow-xl flex flex-col ${snapshot.isDragging ? 'shadow-2xl ring-2 ring-blue-400' : ''}`}
                        >
                          <CardHeader className="flex flex-row items-start justify-between">
                            <div className="flex items-start gap-2 flex-1">
                              <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing mt-1 p-1 -m-1 rounded-sm hover:bg-gray-100">
                                <GripVertical className="h-5 w-5 text-gray-400" />
                              </div>
                              <div className="flex-1">
                                <CardTitle>{service.service_name}</CardTitle>
                                {service.category && <Badge variant="secondary" className="mt-1">{service.category}</Badge>}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleDefault(service)}
                              title="סמן כשירות ברירת מחדל"
                            >
                              <Star className={`h-5 w-5 transition-colors ${service.is_default ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400 hover:text-yellow-300'}`} />
                            </Button>
                          </CardHeader>
                          <CardContent className="flex-grow">
                            <p className="text-sm text-gray-600 mb-4" dangerouslySetInnerHTML={{ __html: service.service_description }}></p>
                            <div className="flex justify-between items-center mb-4">
                              <p className="font-bold text-lg">₪{service.base_price.toLocaleString()}</p>
                              <div className="flex items-center space-x-2 space-x-reverse">
                                  <Switch
                                      id={`vat-toggle-${service.id}`}
                                      checked={service.default_includes_vat}
                                      onCheckedChange={() => toggleDefaultVat(service)}
                                  />
                                  <Label htmlFor={`vat-toggle-${service.id}`} className="text-xs">כולל מע"מ</Label>
                              </div>
                            </div>
                          </CardContent>
                          <div className="p-4 border-t flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleEdit(service)} className="flex-1">
                              <Edit className="h-4 w-4 ml-1" /> ערוך
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDelete(service.id)} className="flex-1">
                              <Trash2 className="h-4 w-4 ml-1" /> מחק
                            </Button>
                          </div>
                        </Card>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </TabsContent>

        <TabsContent value="packages" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPackages.map(pkg => {
              const packageServices = services.filter(s => pkg.service_ids?.includes(s.id));
              
              return (
                <Card key={pkg.id} className="bg-white/95 backdrop-blur-sm shadow-xl flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <PackageIcon className="h-5 w-5 text-purple-600" />
                          {pkg.package_name}
                        </CardTitle>
                        {pkg.category && <Badge variant="secondary" className="mt-1">{pkg.category}</Badge>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    {pkg.package_description && (
                      <div className="text-sm text-gray-600 mb-4" dangerouslySetInnerHTML={{ __html: pkg.package_description }} />
                    )}
                    <div className="flex justify-between items-center mb-4">
                      <p className="font-bold text-lg text-purple-700">₪{pkg.package_price.toLocaleString()}</p>
                      <Badge variant={pkg.package_includes_vat ? "default" : "outline"}>
                        {pkg.package_includes_vat ? 'כולל מע"מ' : 'לא כולל מע"מ'}
                      </Badge>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">שירותים בחבילה ({packageServices.length}):</h4>
                      {packageServices.length > 0 ? (
                        <ul className="text-xs space-y-1">
                          {packageServices.slice(0, 5).map(service => (
                            <li key={service.id} className="flex items-center gap-1 text-gray-600">
                              <span className="w-1 h-1 rounded-full bg-purple-400"></span>
                              {service.service_name}
                            </li>
                          ))}
                          {packageServices.length > 5 && (
                            <li className="text-gray-500">ועוד {packageServices.length - 5} שירותים...</li>
                          )}
                        </ul>
                      ) : (
                        <p className="text-xs text-gray-400">אין שירותים בחבילה</p>
                      )}
                    </div>
                  </CardContent>
                  <div className="p-4 border-t flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleEditPackage(pkg)} className="flex-1">
                      <Edit className="h-4 w-4 ml-1" /> ערוך
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDeletePackage(pkg.id)} className="flex-1">
                      <Trash2 className="h-4 w-4 ml-1" /> מחק
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Service Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingService ? "עריכת שירות" : "שירות חדש"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>שם השירות</Label>
              <Input 
                placeholder="שם השירות" 
                value={formData.service_name} 
                onChange={e => setFormData({ ...formData, service_name: e.target.value })} 
              />
            </div>
            <div>
              <Label>תיאור השירות</Label>
              <ReactQuill
                value={formData.service_description}
                onChange={(value) => setFormData({ ...formData, service_description: value })}
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
              <Label>מחיר בסיס</Label>
              <Input 
                type="number" 
                placeholder="מחיר בסיס" 
                value={formData.base_price} 
                onChange={e => setFormData({ ...formData, base_price: e.target.value })} 
              />
            </div>
            <div>
              <Label>קטגוריה</Label>
              <Input 
                placeholder="קטגוריה" 
                value={formData.category} 
                onChange={e => setFormData({ ...formData, category: e.target.value })} 
              />
            </div>
            
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label>מספר ספקים מינימלי (ברירת מחדל)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>מספר הספקים המינימלי שצריך לשבץ לשירות זה כדי שהאירוע ייחשב "תפור" (ברירת מחדל)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select
                value={String(formData.default_min_suppliers)}
                onValueChange={(value) => setFormData({ ...formData, default_min_suppliers: parseInt(value) })}
              >
                <SelectTrigger className="w-full">
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
              <Switch
                id="default_includes_vat"
                checked={formData.default_includes_vat}
                onCheckedChange={(checked) => setFormData({ ...formData, default_includes_vat: checked })}
              />
              <Label htmlFor="default_includes_vat">ברירת מחדל: המחיר כולל מע"מ</Label>
            </div>
            <div>
              <Label>הערות מנהל (פנימי)</Label>
              <Textarea 
                placeholder="הערות פנימיות למנהל (לא יוצג ללקוחות)" 
                value={formData.admin_notes} 
                onChange={e => setFormData({ ...formData, admin_notes: e.target.value })} 
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ביטול</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="animate-spin h-4 w-4 ml-2" /> : 'שמור'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Package Dialog */}
      <Dialog open={isPackageDialogOpen} onOpenChange={setIsPackageDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPackage ? "עריכת חבילה" : "חבילה חדשה"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input 
              placeholder="שם החבילה" 
              value={packageFormData.package_name} 
              onChange={e => setPackageFormData({ ...packageFormData, package_name: e.target.value })} 
            />
            <Textarea 
              placeholder="תיאור החבילה (יוצג בהצעת המחיר)" 
              value={packageFormData.package_description} 
              onChange={e => setPackageFormData({ ...packageFormData, package_description: e.target.value })}
              rows={3}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input 
                type="number" 
                placeholder="מחיר החבילה" 
                value={packageFormData.package_price} 
                onChange={e => setPackageFormData({ ...packageFormData, package_price: e.target.value })} 
              />
              <Input 
                placeholder="קטגוריה" 
                value={packageFormData.category} 
                onChange={e => setPackageFormData({ ...packageFormData, category: e.target.value })} 
              />
            </div>
            <div className="flex items-center space-x-2 space-x-reverse">
              <Switch
                id="package_includes_vat"
                checked={packageFormData.package_includes_vat}
                onCheckedChange={(checked) => setPackageFormData({ ...packageFormData, package_includes_vat: checked })}
              />
              <Label htmlFor="package_includes_vat">המחיר כולל מע"מ</Label>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold mb-3">שירותים בחבילה</h3>
              
              <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                  {packageFormData.service_ids.map(serviceId => {
                    const service = services.find(s => s.id === serviceId);
                    if (!service) return null;
                    return (
                      <div key={serviceId} className="flex items-center justify-between bg-purple-50 p-2 rounded border border-purple-100">
                        <span className="text-sm font-medium">{service.service_name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveServiceFromPackage(serviceId)}
                          className="h-6 w-6 hover:bg-purple-100"
                        >
                          <X className="h-3 w-3 text-red-500" />
                        </Button>
                      </div>
                    );
                  })}
                  {packageFormData.service_ids.length === 0 && (
                      <p className="text-sm text-gray-500 italic">לא נבחרו שירותים</p>
                  )}
              </div>

              <Label className="mb-2 block">הוסף שירותים</Label>
              <div className="relative mb-2">
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="חפש שירות להוספה..."
                  value={packageServiceSearchTerm}
                  onChange={(e) => setPackageServiceSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="border rounded-md max-h-48 overflow-y-auto p-1 space-y-1 bg-gray-50">
                  {services
                    .filter(s => !packageFormData.service_ids.includes(s.id))
                    .filter(s => s.service_name.toLowerCase().includes(packageServiceSearchTerm.toLowerCase()))
                    .map(service => (
                      <div 
                        key={service.id} 
                        className="flex items-center justify-between p-2 hover:bg-white rounded cursor-pointer transition-colors"
                        onClick={() => handleAddServiceToPackage(service.id)}
                      >
                        <span className="text-sm">{service.service_name}</span>
                        <Plus className="h-3 w-3 text-green-600" />
                      </div>
                    ))}
                   {services
                    .filter(s => !packageFormData.service_ids.includes(s.id))
                    .filter(s => s.service_name.toLowerCase().includes(packageServiceSearchTerm.toLowerCase()))
                    .length === 0 && (
                        <div className="text-center py-2 text-xs text-gray-400">לא נמצאו שירותים נוספים</div>
                    )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPackageDialogOpen(false)}>ביטול</Button>
            <Button onClick={handleSavePackage} disabled={isSaving}>
              {isSaving ? <Loader2 className="animate-spin h-4 w-4 ml-2" /> : 'שמור'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <ConceptDefaultsManager
        isOpen={isConceptsOpen}
        onClose={() => setIsConceptsOpen(false)}
        allServices={services}
      />
      
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        data={filteredServices}
        columns={exportColumns}
        title="רשימת שירותים"
        exportTypes={['csv', 'html']}
      />
    </div>
  );
}