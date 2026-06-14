import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Edit, Save, Loader2, Users } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { getCurrencySymbol } from '@/components/utils/currencyUtils';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

export default function FinancialSummaryCard({
  event,
  financials,
  isAdmin,
  editingSection,
  setEditingSection,
  financialEditData,
  setFinancialEditData,
  handleSaveFinancial,
  isSavingFinancial
}) {
  const cs = getCurrencySymbol(event?.primary_currency || 'ILS');

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">סיכום פיננסי</h3>
          {isAdmin && editingSection !== 'financial' && (
            <Button variant="outline" size="sm" onClick={() => { 
              setEditingSection('financial'); 
              setFinancialEditData({ 
                discount_amount: event.discount_amount || '', 
                discount_reason: event.discount_reason || '', 
                discount_before_vat: event.discount_before_vat || false,
                discount_type: event.discount_type || 'fixed',
                total_override: event.total_override || '',
                total_override_includes_vat: event.total_override_includes_vat !== false,
                is_price_per_guest: event.is_price_per_guest || false,
                price_per_guest: event.price_per_guest || ''
              }); 
            }}>
              <Edit className="h-4 w-4 ml-2" />ערוך
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editingSection === 'financial' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>דריסת מחיר כולל</Label>
                <Input type="number" placeholder="0" value={financialEditData.total_override} onChange={(e) => setFinancialEditData({ ...financialEditData, total_override: e.target.value })} />
                <div className="flex items-center gap-2">
                  <Checkbox 
                    id="total_override_vat" 
                    checked={financialEditData.total_override_includes_vat} 
                    onCheckedChange={(checked) => setFinancialEditData({ ...financialEditData, total_override_includes_vat: checked })} 
                  />
                  <Label htmlFor="total_override_vat" className="text-sm font-normal">המחיר כולל מע"מ</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>הנחה ({cs})</Label>
                <Input type="number" placeholder="0" value={financialEditData.discount_amount} onChange={(e) => setFinancialEditData({ ...financialEditData, discount_amount: e.target.value })} />
                <div className="flex items-center gap-2">
                  <Checkbox 
                    id="discount_vat" 
                    checked={financialEditData.discount_before_vat} 
                    onCheckedChange={(checked) => setFinancialEditData({ ...financialEditData, discount_before_vat: checked })} 
                  />
                  <Label htmlFor="discount_vat" className="text-sm font-normal">הנחה לפני חישוב מע"מ</Label>
                </div>
              </div>
              <div className="col-span-full">
                <Label>סיבת הנחה</Label>
                <Input value={financialEditData.discount_reason} onChange={(e) => setFinancialEditData({ ...financialEditData, discount_reason: e.target.value })} />
              </div>
              {financialEditData.is_price_per_guest && (
                <div className="col-span-full flex items-center gap-2">
                  <Checkbox 
                    id="edit_discount_per_guest" 
                    checked={financialEditData.discount_type === 'per_guest'} 
                    onCheckedChange={(checked) => setFinancialEditData({ ...financialEditData, discount_type: checked ? 'per_guest' : 'fixed' })} 
                  />
                  <Label htmlFor="edit_discount_per_guest" className="text-sm font-normal">הנחה למשתתף (תוכפל במספר המשתתפים)</Label>
                </div>
              )}
              {/* Price Per Guest Toggle */}
              <div className="col-span-full border-t pt-3 mt-2">
                <div className="flex items-center gap-3">
                  <Switch
                    id="edit_ppg_toggle"
                    checked={financialEditData.is_price_per_guest}
                    onCheckedChange={(checked) => {
                      const gc = parseInt(event.guest_count) || 0;
                      if (checked && gc <= 0) {
                        toast.info("יש להזין מספר משתתפים באירוע לפני הפעלת מחיר למשתתף");
                        return;
                      }
                      if (checked) {
                        // Calculate ppg from current total
                        const ppg = financials.totalCostWithoutVat / gc;
                        setFinancialEditData({ ...financialEditData, is_price_per_guest: true, price_per_guest: Math.round(ppg * 100) / 100 });
                      } else {
                        setFinancialEditData({ ...financialEditData, is_price_per_guest: false, price_per_guest: '' });
                      }
                    }}
                  />
                  <Label htmlFor="edit_ppg_toggle" className="text-sm font-semibold">מחיר למשתתף</Label>
                  {financialEditData.is_price_per_guest && financialEditData.price_per_guest > 0 && (
                    <span className="text-sm text-blue-700 font-medium">
                      ({cs}{Number(financialEditData.price_per_guest).toLocaleString(undefined, { maximumFractionDigits: 2 })} × {parseInt(event.guest_count) || 0} = {cs}{(Number(financialEditData.price_per_guest) * (parseInt(event.guest_count) || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })})
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditingSection(null)} disabled={isSavingFinancial}>ביטול</Button>
              <Button onClick={handleSaveFinancial} disabled={isSavingFinancial}>
                {isSavingFinancial && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                <Save className="h-4 w-4 ml-2" />
                שמור
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {financials.isPricePerGuest && financials.effectivePricePerGuest > 0 && (
              <div className="flex justify-between items-center bg-blue-50 p-2 rounded border border-blue-200 mb-1">
                <span className="text-blue-800 flex items-center gap-1"><Users className="h-3.5 w-3.5" />מחיר למשתתף ({financials.guestCount} משתתפים):</span>
                <span className="font-bold text-blue-700">{cs}{financials.effectivePricePerGuest.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between"><span>סה"כ לפני מע"מ:</span><span>{cs}{financials.totalCostWithoutVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            {event.discount_before_vat && financials.discountAmount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>
                  הנחה{financials.discountType === 'per_guest' ? ` (${cs}${financials.rawDiscountAmount} × ${financials.guestCount})` : ''}{event.discount_reason && ` - ${event.discount_reason}`}:
                </span>
                <span>-{cs}{financials.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between"><span>מע"מ (18%):</span><span>{cs}{financials.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between"><span>סה"כ כולל מע"מ:</span><span>{cs}{financials.totalCostWithVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            {!event.discount_before_vat && financials.discountAmount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>
                  הנחה{financials.discountType === 'per_guest' ? ` (${cs}${financials.rawDiscountAmount} × ${financials.guestCount})` : ''}{event.discount_reason && ` - ${event.discount_reason}`}:
                </span>
                <span>-{cs}{financials.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg border-t pt-2"><span>סה"כ לתשלום:</span><span>{cs}{financials.finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between text-green-600"><span>שולם:</span><span>{cs}{financials.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between font-bold text-lg"><span>יתרה לתשלום:</span><span>{cs}{financials.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}