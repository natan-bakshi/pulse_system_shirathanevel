import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FileText, Loader2, Search, Download, Trash2 } from 'lucide-react';

export function ExportDialog({ open, onOpenChange, exportOptions, setExportOptions, onConfirmExport }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>ייצוא אירוע</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {Object.keys(exportOptions).map(key => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox checked={exportOptions[key]} onCheckedChange={(checked) => setExportOptions({ ...exportOptions, [key]: checked })} />
                <Label>{key === 'eventDetails' ? 'פרטי אירוע' : key === 'familyDetails' ? 'פרטי משפחה' : key === 'services' ? 'שירותים' : key === 'suppliers' ? 'ספקים' : key === 'payments' ? 'תשלומים' : key === 'financials' ? 'סיכום פיננסי' : 'הערות'}</Label>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={onConfirmExport}>ייצא</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentDialog({ open, onOpenChange, paymentForm, setPaymentForm, onAddPayment, onUploadReceipt, uploadingReceipt }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>הוספת תשלום</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>סכום</Label><Input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} placeholder="0" /></div>
          <div><Label>תאריך תשלום</Label><Input type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} /></div>
          <div>
            <Label>אמצעי תשלום</Label>
            <Select value={paymentForm.payment_method} onValueChange={(value) => setPaymentForm({ ...paymentForm, payment_method: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">מזומן</SelectItem>
                <SelectItem value="bank_transfer">העברה בנקאית</SelectItem>
                <SelectItem value="check">צ'ק</SelectItem>
                <SelectItem value="credit_card">כרטיס אשראי</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>הערות</Label><Textarea value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} placeholder="הערות על התשלום (אופציונלי)" /></div>
          <div>
            <Label>אסמכתא (תמונה)</Label>
            <div className="space-y-2">
              <Input type="file" accept="image/*" onChange={onUploadReceipt} disabled={uploadingReceipt} />
              {uploadingReceipt && <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /><span>מעלה קובץ...</span></div>}
              {paymentForm.receipt_image_url && <div className="flex items-center gap-2 text-sm text-green-600"><FileText className="h-4 w-4" /><span>אסמכתא הועלתה בהצלחה</span></div>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={onAddPayment} disabled={uploadingReceipt}>הוסף תשלום</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SupplierAssignDialog({ open, onOpenChange, searchTerm, setSearchTerm, filteredSuppliers, formData, setFormData, onAssign }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>שיבוץ ספקים</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
            <Input placeholder="חיפוש ספקים..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-10" />
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredSuppliers.map(supplier => (
              <div key={supplier.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox checked={formData.supplierIds.includes(supplier.id)} onCheckedChange={(checked) => {
                    if (checked) { setFormData({ ...formData, supplierIds: [...formData.supplierIds, supplier.id] }); }
                    else { const n = { ...formData.notes }; delete n[supplier.id]; setFormData({ ...formData, supplierIds: formData.supplierIds.filter(id => id !== supplier.id), notes: n }); }
                  }} />
                  <Label>{supplier.supplier_name}</Label>
                </div>
                {formData.supplierIds.includes(supplier.id) && (
                  <div className="mr-6"><Label className="text-xs">הערה לספק</Label>
                    <Input placeholder="הערה ספציפית לספק זה..." value={formData.notes[supplier.id] || ''} onChange={(e) => setFormData({ ...formData, notes: { ...formData.notes, [supplier.id]: e.target.value } })} className="text-sm" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setSearchTerm(""); }}>ביטול</Button>
          <Button onClick={onAssign}>שמור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PackageDialog({ open, onOpenChange, form, setForm, searchTerm, setSearchTerm, filteredServices, isCreating, onCreate }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>יצירת חבילה חדשה</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>שם החבילה</Label><Input value={form.package_name} onChange={(e) => setForm({ ...form, package_name: e.target.value })} /></div>
          <div><Label>תיאור</Label><Textarea value={form.package_description} onChange={(e) => setForm({ ...form, package_description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>מחיר</Label><Input type="number" value={form.package_price} onChange={(e) => setForm({ ...form, package_price: e.target.value })} /></div>
            <div className="flex items-center gap-2 pt-6"><Checkbox checked={form.package_includes_vat} onCheckedChange={(checked) => setForm({ ...form, package_includes_vat: checked })} /><Label>כולל מע"מ</Label></div>
          </div>
          <div>
            <Label>בחר שירותים</Label>
            <div className="relative mb-2"><Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" /><Input placeholder="חיפוש שירותים..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-10" /></div>
            <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
              {filteredServices.map(service => (
                <div key={service.id} className="flex items-center gap-2">
                  <Checkbox checked={form.selectedServices.includes(service.id)} onCheckedChange={(checked) => { if (checked) setForm({ ...form, selectedServices: [...form.selectedServices, service.id] }); else setForm({ ...form, selectedServices: form.selectedServices.filter(id => id !== service.id) }); }} />
                  <Label>{service.service_name}</Label>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setSearchTerm(""); }} disabled={isCreating}>ביטול</Button>
          <Button onClick={onCreate} className="bg-red-800 hover:bg-red-700" disabled={isCreating}>{isCreating ? <><Loader2 className="h-4 w-4 ml-2 animate-spin" />יוצר חבילה...</> : 'צור חבילה'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditPackageDialog({ open, onOpenChange, form, setForm, isSaving, onSave }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>עריכת פרטי חבילה</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>שם החבילה</Label><Input value={form.package_name} onChange={(e) => setForm({ ...form, package_name: e.target.value })} /></div>
          <div><Label>תיאור</Label><Textarea value={form.package_description} onChange={(e) => setForm({ ...form, package_description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>מחיר</Label><Input type="number" value={form.package_price} onChange={(e) => setForm({ ...form, package_price: e.target.value })} /></div>
            <div className="flex items-center gap-2 pt-6"><Checkbox checked={form.package_includes_vat} onCheckedChange={(checked) => setForm({ ...form, package_includes_vat: checked })} /><Label>כולל מע"מ</Label></div>
          </div>
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded"><p className="text-sm text-yellow-800">שינויים אלו יחולו רק על האירוע הנוכחי ולא ישנו את החבילה הגלובלית</p></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>ביטול</Button>
          <Button onClick={onSave} className="bg-red-800 hover:bg-red-700" disabled={isSaving}>{isSaving ? <><Loader2 className="h-4 w-4 ml-2 animate-spin" />שומר...</> : 'שמור שינויים'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddServiceDialog({ open, onOpenChange, searchTerm, setSearchTerm, filteredServices, selected, setSelected, isAdding, onAdd }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>הוספת שירותים</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>בחר שירותים להוספה</Label>
            <div className="relative mb-2"><Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" /><Input placeholder="חיפוש שירותים..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-10" /></div>
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-2">
              {filteredServices.map(service => (
                <div key={service.id} className="flex items-center gap-2">
                  <Checkbox checked={selected.includes(service.id)} onCheckedChange={(checked) => { if (checked) setSelected([...selected, service.id]); else setSelected(selected.filter(id => id !== service.id)); }} />
                  <Label>{service.service_name}</Label>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setSearchTerm(""); }} disabled={isAdding}>ביטול</Button>
          <Button onClick={onAdd} className="bg-green-600 hover:bg-green-700" disabled={isAdding}>{isAdding ? <><Loader2 className="h-4 w-4 ml-2 animate-spin" />מוסיף...</> : 'הוסף שירותים'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddExistingPackageDialog({ open, onOpenChange, searchTerm, setSearchTerm, filteredPackages, selected, setSelected, isAdding, onAdd }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>הוספת חבילה קיימת</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>בחר חבילה להוספה</Label>
            <div className="relative mb-2"><Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" /><Input placeholder="חיפוש חבילות..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-10" /></div>
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-2">
              {filteredPackages.map(pkg => (
                <div key={pkg.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded">
                  <Checkbox checked={selected === pkg.id} onCheckedChange={(checked) => setSelected(checked ? pkg.id : null)} />
                  <div className="flex-1">
                    <div className="font-medium">{pkg.package_name}</div>
                    <div className="text-sm text-gray-600">₪{(pkg.package_price || 0).toLocaleString()} {pkg.package_includes_vat && '(כולל מע"מ)'}</div>
                    {pkg.package_description && <div className="text-xs text-gray-500 mt-1">{pkg.package_description}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setSearchTerm(""); }} disabled={isAdding}>ביטול</Button>
          <Button onClick={onAdd} className="bg-purple-600 hover:bg-purple-700" disabled={!selected || isAdding}>{isAdding ? <><Loader2 className="h-4 w-4 ml-2 animate-spin" />מוסיף...</> : 'הוסף חבילה'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddToPackageDialog({ open, onOpenChange, searchTerm, setSearchTerm, filteredServices, selectedServices, setSelectedServices, targetPackageId, setTargetPackageId, groupedPackages, newPackageData, setNewPackageData, saveGlobalPackage, setSaveGlobalPackage, isAdding, onAdd }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>הוספת שירותים לחבילה</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>בחר שירותים</Label>
            <div className="relative mb-2"><Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" /><Input placeholder="חיפוש שירותים..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-10" /></div>
            <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
              {filteredServices.map(service => (
                <div key={service.id} className="flex items-center gap-2">
                  <Checkbox checked={selectedServices.includes(service.id)} onCheckedChange={(checked) => { if (checked) setSelectedServices([...selectedServices, service.id]); else setSelectedServices(selectedServices.filter(id => id !== service.id)); }} />
                  <Label>{service.service_name}</Label>
                </div>
              ))}
            </div>
          </div>
          <div>
            <Label>בחר חבילה</Label>
            <Select value={targetPackageId} onValueChange={setTargetPackageId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">חבילה חדשה</SelectItem>
                {groupedPackages.map(pkg => <SelectItem key={pkg.package_id} value={pkg.package_id}>{pkg.package_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {targetPackageId === 'new' && (
            <>
              <div><Label>שם החבילה</Label><Input value={newPackageData.name} onChange={(e) => setNewPackageData({ ...newPackageData, name: e.target.value })} placeholder="שם החבילה החדשה" /></div>
              <div><Label>תיאור החבילה</Label><Textarea value={newPackageData.description} onChange={(e) => setNewPackageData({ ...newPackageData, description: e.target.value })} placeholder="תיאור החבילה (אופציונלי)" /></div>
              <div><Label>מחיר החבילה</Label><Input type="number" value={newPackageData.price} onChange={(e) => setNewPackageData({ ...newPackageData, price: e.target.value })} placeholder="0" /></div>
              <div className="flex items-center space-x-2 space-x-reverse"><Checkbox id="new-package-vat" checked={newPackageData.includes_vat} onCheckedChange={(checked) => setNewPackageData({ ...newPackageData, includes_vat: checked })} /><Label htmlFor="new-package-vat">כולל מע"מ</Label></div>
              <div className="flex items-center gap-2 mt-4 p-3 bg-blue-50 rounded-md border border-blue-100">
                <Checkbox id="save-global" checked={saveGlobalPackage} onCheckedChange={setSaveGlobalPackage} />
                <div className="flex flex-col"><Label htmlFor="save-global" className="cursor-pointer font-medium text-blue-900">שמור כתבנית גלובלית</Label><span className="text-xs text-blue-700">החבילה תישמר ותהיה זמינה לשימוש באירועים עתידיים</span></div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setSearchTerm(""); }} disabled={isAdding}>ביטול</Button>
          <Button onClick={() => onAdd(saveGlobalPackage)} className="bg-red-800 hover:bg-red-700" disabled={isAdding}>{isAdding ? <><Loader2 className="h-4 w-4 ml-2 animate-spin" />מוסיף...</> : 'הוסף לחבילה'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddServiceToPackageDialog({ open, onOpenChange, searchTerm, setSearchTerm, filteredServices, selected, setSelected, isAdding, onAdd }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>הוסף שירות לחבילה</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>בחר שירותים</Label>
            <div className="relative mb-2"><Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" /><Input placeholder="חיפוש שירותים..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-10" /></div>
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-2">
              {filteredServices.map(service => (
                <div key={service.id} className="flex items-center gap-2">
                  <Checkbox checked={selected.includes(service.id)} onCheckedChange={(checked) => { if (checked) setSelected([...selected, service.id]); else setSelected(selected.filter(id => id !== service.id)); }} />
                  <Label>{service.service_name}</Label>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setSearchTerm(""); }} disabled={isAdding}>ביטול</Button>
          <Button onClick={onAdd} className="bg-red-800 hover:bg-red-700" disabled={isAdding}>{isAdding ? <><Loader2 className="h-4 w-4 ml-2 animate-spin" />מוסיף...</> : 'הוסף שירות'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReceiptDialog({ open, onOpenChange, receiptUrl, paymentId, isAdmin, onDeleteReceipt }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>צפייה באסמכתא</DialogTitle></DialogHeader>
        <div className="space-y-4">{receiptUrl && <img src={receiptUrl} alt="אסמכתת תשלום" className="w-full h-auto max-h-[70vh] object-contain" />}</div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>סגור</Button>
          {isAdmin && <Button variant="destructive" onClick={() => onDeleteReceipt(paymentId)}><Trash2 className="h-4 w-4 ml-2" />מחק אסמכתא</Button>}
          <Button asChild><a href={receiptUrl} download target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4 ml-2" />הורד</a></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}