import React, { useState, useEffect } from "react";
import { AppSettings } from "@/entities/AppSettings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Trash2, Loader2, Save, Package as PackageIcon } from "lucide-react";

const SETTING_KEY = "concept_defaults";

export default function ConceptDefaultsManager({ isOpen, onClose, allServices, allPackages = [] }) {
  const [concepts, setConcepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newConceptName, setNewConceptName] = useState("");
  const [appSettingId, setAppSettingId] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadConcepts();
    }
  }, [isOpen]);

  const loadConcepts = async () => {
    setLoading(true);
    try {
      const settings = await AppSettings.filter({ setting_key: SETTING_KEY });
      if (settings.length > 0) {
        setConcepts(JSON.parse(settings[0].setting_value));
        setAppSettingId(settings[0].id);
      } else {
        setConcepts([]);
        setAppSettingId(null);
      }
    } catch (error) {
      console.error("Failed to load concepts:", error);
      setConcepts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddConcept = () => {
    if (newConceptName.trim() === "" || concepts.some(c => c.concept === newConceptName.trim())) {
      alert("שם קונספט לא תקין או כבר קיים");
      return;
    }
    setConcepts([...concepts, { concept: newConceptName.trim(), service_ids: [], package_ids: [] }]);
    setNewConceptName("");
  };

  const handleRemoveConcept = (index) => {
    setConcepts(concepts.filter((_, i) => i !== index));
  };

  const handleServiceToggle = (conceptIndex, serviceId) => {
    const newConcepts = [...concepts];
    const serviceIds = newConcepts[conceptIndex].service_ids || [];
    const serviceIndex = serviceIds.indexOf(serviceId);

    if (serviceIndex > -1) {
      serviceIds.splice(serviceIndex, 1);
    } else {
      serviceIds.push(serviceId);
    }
    newConcepts[conceptIndex].service_ids = serviceIds;
    setConcepts(newConcepts);
  };

  const handlePackageToggle = (conceptIndex, packageId) => {
    const newConcepts = [...concepts];
    const packageIds = newConcepts[conceptIndex].package_ids || [];
    const pkgIndex = packageIds.indexOf(packageId);

    if (pkgIndex > -1) {
      packageIds.splice(pkgIndex, 1);
    } else {
      packageIds.push(packageId);
    }
    newConcepts[conceptIndex].package_ids = packageIds;
    setConcepts(newConcepts);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const settingValue = JSON.stringify(concepts);
      if (appSettingId) {
        await AppSettings.update(appSettingId, { setting_value: settingValue });
      } else {
        await AppSettings.create({ setting_key: SETTING_KEY, setting_value: settingValue });
      }
      onClose();
    } catch (error) {
      console.error("Failed to save concepts:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>ניהול ברירות מחדל לפי קונספט</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex-grow flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : (
          <div className="flex-grow overflow-y-auto space-y-4 pr-2">
            <div className="flex gap-2">
              <Input
                placeholder="שם קונספט חדש"
                value={newConceptName}
                onChange={(e) => setNewConceptName(e.target.value)}
              />
              <Button onClick={handleAddConcept}><Plus className="h-4 w-4 ml-1" />הוסף</Button>
            </div>
            
            <div className="space-y-4">
              {concepts.map((concept, index) => (
                <div key={index} className="p-4 border rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold">{concept.concept}</h3>
                    <Button variant="ghost" size="icon" onClick={() => handleRemoveConcept(index)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                  {allPackages.length > 0 && (
                    <>
                      <Label className="flex items-center gap-1"><PackageIcon className="h-4 w-4 text-purple-600" />בחר חבילות:</Label>
                      <div className="max-h-32 overflow-y-auto border rounded-md p-2 mt-1 mb-3 space-y-1 bg-purple-50/50">
                          {allPackages.map(pkg => (
                            <div key={pkg.id} className="flex items-center space-x-2 space-x-reverse">
                               <input
                                type="checkbox"
                                id={`pkg-${index}-${pkg.id}`}
                                checked={(concept.package_ids || []).includes(pkg.id)}
                                onChange={() => handlePackageToggle(index, pkg.id)}
                                className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                               />
                               <Label htmlFor={`pkg-${index}-${pkg.id}`} className="text-sm font-normal">{pkg.package_name}</Label>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                  <Label>בחר שירותים בודדים:</Label>
                  <div className="max-h-40 overflow-y-auto border rounded-md p-2 mt-1 space-y-1">
                      {allServices.map(service => (
                        <div key={service.id} className="flex items-center space-x-2 space-x-reverse">
                           <input
                            type="checkbox"
                            id={`service-${index}-${service.id}`}
                            checked={(concept.service_ids || []).includes(service.id)}
                            onChange={() => handleServiceToggle(index, service.id)}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                           />
                           <Label htmlFor={`service-${index}-${service.id}`} className="text-sm font-normal">{service.service_name}</Label>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
            שמור שינויים
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}