import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, FileText } from 'lucide-react';
import { format } from 'date-fns';

function getPaymentMethodText(method) {
  const methods = { cash: 'מזומן', bank_transfer: 'העברה בנקאית', check: 'צ\'ק', credit_card: 'כרטיס אשראי' };
  return methods[method] || method;
}

export default function PaymentsCard({
  payments,
  isAdmin,
  setShowPaymentDialog,
  handleDeletePayment,
  setCurrentReceiptUrl,
  setCurrentReceiptPaymentId,
  setShowReceiptDialog
}) {
  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">תשלומים</h3>
          {isAdmin && <Button size="sm" onClick={() => setShowPaymentDialog(true)}><Plus className="h-4 w-4 ml-2" />הוסף תשלום</Button>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {payments && payments.length > 0 ? (
            payments.map(payment => (
              <div key={payment.id} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <div className="flex-1">
                  <div className="font-medium">₪{payment.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}</div>
                  <div className="text-sm text-gray-600">
                    {format(new Date(payment.payment_date), 'dd/MM/yyyy')} - {getPaymentMethodText(payment.payment_method)}
                  </div>
                  {payment.notes && <div className="text-sm text-gray-500">{payment.notes}</div>}
                  {payment.receipt_image_url && payment.receipt_image_url.trim() !== '' && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-2"
                      onClick={() => {
                        setCurrentReceiptUrl(payment.receipt_image_url);
                        setCurrentReceiptPaymentId(payment.id);
                        setShowReceiptDialog(true);
                      }}
                    >
                      <FileText className="h-4 w-4 ml-2" />
                      צפה באסמכתא
                    </Button>
                  )}
                </div>
                {isAdmin && (
                  <Button variant="ghost" size="sm" onClick={() => handleDeletePayment(payment.id)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-4 text-gray-500">אין תשלומים להצגה</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}