import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { PAYMENT_METHOD_LABELS } from "@/components/billing/documentTypes";

// עורך בלוק התשלומים של המסמך (נדרש לקבלה ולחשבונית מס/קבלה).
export default function DocumentPaymentsEditor({ payments, onChange, symbol = "₪", expectedTotal = 0 }) {
  const update = (index, key, value) => onChange(payments.map((payment, position) => (position === index ? { ...payment, [key]: value } : payment)));
  const add = () => onChange([...payments, { amount: "", type: "cash", date: new Date().toISOString().slice(0, 10) }]);
  const remove = (index) => onChange(payments.filter((_, position) => position !== index));

  const total = payments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
  const mismatch = expectedTotal > 0 && Math.abs(total - expectedTotal) > 0.01;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>תשלומים</Label>
        <Button type="button" variant="outline" size="sm" onClick={add}><Plus className="ml-1 h-4 w-4" />הוסף תשלום</Button>
      </div>

      <div className="space-y-2">
        {payments.length === 0 && <p className="rounded border border-dashed border-gray-300 p-3 text-center text-sm text-gray-500">אין תשלומים. הוסף תשלום כדי להמשיך.</p>}
        {payments.map((payment, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 p-2 sm:grid-cols-12">
            <div className="sm:col-span-3">
              <Label className="text-xs text-gray-500">סכום</Label>
              <Input type="number" inputMode="decimal" dir="ltr" value={payment.amount} onChange={(event) => update(index, "amount", event.target.value)} />
            </div>
            <div className="sm:col-span-4">
              <Label className="text-xs text-gray-500">אמצעי תשלום</Label>
              <Select value={payment.type} onValueChange={(value) => update(index, "type", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 sm:col-span-4">
              <Label className="text-xs text-gray-500">תאריך</Label>
              <Input type="date" dir="ltr" value={payment.date} onChange={(event) => update(index, "date", event.target.value)} />
            </div>
            <div className="flex items-end sm:col-span-1">
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} aria-label="מחק תשלום"><Trash2 className="h-4 w-4 text-red-600" /></Button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-gray-50 p-3 text-sm">
        <div className="flex justify-between font-semibold"><span>סך התשלומים</span><span>{symbol}{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        {mismatch && <p className="mt-1 text-xs text-amber-600">סך התשלומים אינו זהה לסך המסמך ({symbol}{expectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Invoice4U עשוי לדחות את המסמך.</p>}
      </div>
    </div>
  );
}