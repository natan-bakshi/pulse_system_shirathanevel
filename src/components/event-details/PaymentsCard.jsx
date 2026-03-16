import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { getCurrencySymbol, getEffectiveCurrency, convertCurrency, DEFAULT_EXCHANGE_RATE } from '@/components/utils/currencyUtils';

function getPaymentMethodText(method) {
  const methods = { cash: 'מזומן', bank_transfer: 'העברה בנקאית', check: 'צ\'ק', credit_card: 'כרטיס אשראי' };
  return methods[method] || method;
}

export default function PaymentsCard({
  event,
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
                  <div className="font-medium">{getCurrencySymbol(payment.currency || event?.primary_currency || 'ILS')}{payment.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}</div>
                  {(() => {
                    const paymentCurrency = getEffectiveCurrency(payment.currency, event?.primary_currency);
                    const eventCurrency = event?.primary_currency || 'ILS';
                    const amount = parseFloat(payment.amount) || 0;
                    if (amount > 0 && paymentCurrency !== eventCurrency) {
                      const converted = convertCurrency(amount, paymentCurrency, eventCurrency, DEFAULT_EXCHANGE_RATE);
                      return (
                        <div className="text-xs text-gray-500">
                          ≈ {getCurrencySymbol(eventCurrency)}{converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      );
                    }
                    return null;
                  })()}
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