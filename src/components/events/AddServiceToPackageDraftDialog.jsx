import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Search } from 'lucide-react';

export default function AddServiceToPackageDraftDialog({
  open,
  onOpenChange,
  packageName,
  searchTerm,
  setSearchTerm,
  filteredServices,
  selected,
  setSelected,
  onAdd
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="max-w-md max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>הוספת שירות לחבילה{packageName ? `: ${packageName}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>בחר שירותים להוספה</Label>
            <div className="relative mb-2">
              <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="חיפוש שירותים..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-2">
              {filteredServices.length === 0 ? (
                <div className="text-center text-gray-500 text-sm py-3">לא נמצאו שירותים זמינים</div>
              ) : (
                filteredServices.map(service => (
                  <div key={service.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selected.includes(service.id)}
                      onCheckedChange={(checked) => {
                        setSelected(checked ? [...selected, service.id] : selected.filter(id => id !== service.id));
                        setSearchTerm('');
                      }}
                    />
                    <Label>{service.service_name}</Label>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setSearchTerm(''); }}>ביטול</Button>
          <Button onClick={onAdd} disabled={selected.length === 0} className="bg-red-800 hover:bg-red-700">הוסף לחבילה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}