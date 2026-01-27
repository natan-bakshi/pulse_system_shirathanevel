import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";

export default function PaymentManager({ payments = [], onPaymentsChange, isReadOnly = false }) {
  const [localPayments, setLocalPayments] = useState(payments);

  const addPayment = () => {
    const newPayment = {
      id: `temp_${Date.now()}`,
      amount: 0,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: 'cash',
      notes: '',
      isNew: true
    };
    
    const updatedPayments = [...localPayments, newPayment];
    setLocalPayments(updatedPayments);
    onPaymentsChange(updatedPayments);
  };

  const removePayment = (paymentId) => {
    const updatedPayments = localPayments.filter(p => p.id !== paymentId);
    setLocalPayments(updatedPayments);
    onPaymentsChange(updatedPayments);
  };

  const updatePayment = (paymentId, field, value) => {
    const updatedPayments = localPayments.map(p => 
      p.id === paymentId ? { ...p, [field]: value } : p
    );
    setLocalPayments(updatedPayments);
    onPaymentsChange(updatedPayments);
  };

  const getPaymentMethodText = (method) => {
    const methods = {
      cash: "מזומן",
      bank_transfer: "העברה בנקאית",
      check: "צ'ק",
      credit_card: "כרטיס אשראי"
    };
    return methods[method] || method;
  };

  const totalPaid = localPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            תשלומים
          </CardTitle>
          {!isReadOnly && (
            <Button type="button" onClick={addPayment} size="sm">
              <Plus className="h-4 w-4 ml-2" />
              הוסף תשלום
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {localPayments.map(payment => (
            <div key={payment.id} className="border rounded-lg p-4 bg-gray-50">
              {!isReadOnly ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>סכום</Label>
                    <Input
                      type="number"
                      value={payment.amount}
                      onChange={(e) => updatePayment(payment.id, 'amount', e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label>תאריך תשלום</Label>
                    <Input
                      type="date"
                      value={payment.payment_date}
                      onChange={(e) => updatePayment(payment.id, 'payment_date', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>אמצעי תשלום</Label>
                    <Select
                      value={payment.payment_method}
                      onValueChange={(value) => updatePayment(payment.id, 'payment_method', value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">מזומן</SelectItem>
                        <SelectItem value="bank_transfer">העברה בנקאית</SelectItem>
                        <SelectItem value="check">צ'ק</SelectItem>
                        <SelectItem value="credit_card">כרטיס אשראי</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      onClick={() => removePayment(payment.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="md:col-span-2">
                    <Label>הערות</Label>
                    <Textarea
                      value={payment.notes || ''}
                      onChange={(e) => updatePayment(payment.id, 'notes', e.target.value)}
                      placeholder="הערות על התשלום..."
                    />
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-bold">₪{payment.amount?.toLocaleString()}</p>
                    <p className="text-sm text-gray-600">
                      {format(new Date(payment.payment_date), "dd/MM/yyyy", { locale: he })} - {getPaymentMethodText(payment.payment_method)}
                    </p>
                    {payment.notes && <p className="text-sm text-gray-500">{payment.notes}</p>}
                  </div>
                </div>
              )}
            </div>
          ))}
          
          {localPayments.length === 0 && (
            <p className="text-center text-gray-500 py-4">לא נוספו תשלומים</p>
          )}
          
          {localPayments.length > 0 && (
            <div className="border-t pt-4">
              <div className="flex justify-between items-center font-bold text-lg">
                <span>סה"כ שולם:</span>
                <span className="text-green-600">₪{totalPaid.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}