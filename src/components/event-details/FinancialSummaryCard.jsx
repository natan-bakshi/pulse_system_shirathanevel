import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Edit, Save, Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

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
                total_override: event.total_override || '',
                total_override_includes_vat: event.total_override_includes_vat !== false
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
                <Label>הנחה (₪)</Label>
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
            <div className="flex justify-between"><span>סה"כ לפני מע"מ:</span><span>₪{financials.totalCostWithoutVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between"><span>מע"מ (18%):</span><span>₪{financials.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between"><span>סה"כ כולל מע"מ:</span><span>₪{financials.totalCostWithVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            {financials.discountAmount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>הנחה{event.discount_reason && ` (${event.discount_reason})`}:</span>
                <span>-₪{financials.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg border-t pt-2"><span>סה"כ לתשלום:</span><span>₪{financials.finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between text-green-600"><span>שולם:</span><span>₪{financials.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between font-bold text-lg"><span>יתרה לתשלום:</span><span>₪{financials.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}