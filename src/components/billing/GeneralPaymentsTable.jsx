import React from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { format } from "date-fns";

const statusLabels = { completed: "הושלם", pending: "ממתין", failed: "נכשל", cancelled: "בוטל" };

// תיעוד סליקות כלליות (ללא שיוך לאירוע) בלשונית התשלומים.
export default function GeneralPaymentsTable({ payments, documentsById }) {
  if (payments.length === 0) return <p className="py-6 text-center text-gray-500">אין סליקות כלליות להצגה</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-right text-gray-500">
            <th className="p-2">תאריך</th>
            <th className="p-2">סכום</th>
            <th className="p-2">משלם</th>
            <th className="p-2">סטטוס</th>
            <th className="p-2">מסמך</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => {
            const document = payment.financial_document_id ? documentsById.get(payment.financial_document_id) : null;
            const pdf = document?.pdf_original_url || document?.pdf_certified_url;
            return (
              <tr key={payment.id} className="border-t border-gray-100">
                <td className="p-2">{payment.payment_date ? format(new Date(payment.payment_date), "dd/MM/yyyy") : "-"}</td>
                <td className="p-2">₪{Number(payment.amount || 0).toLocaleString()}</td>
                <td className="p-2">
                  <div>{payment.payer_name || payment.customer_name_on_card || "-"}</div>
                  {payment.payer_phone && <div dir="ltr" className="text-xs text-gray-500">{payment.payer_phone}</div>}
                </td>
                <td className="p-2">{statusLabels[payment.payment_status] || payment.payment_status || "-"}</td>
                <td className="p-2">{document?.document_number || payment.invoice4u_document_number || "-"}</td>
                <td className="p-2">
                  {pdf && (
                    <Button asChild variant="ghost" size="icon" title="צפייה והורדה">
                      <a href={pdf} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" /></a>
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}