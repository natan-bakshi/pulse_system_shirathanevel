import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link2 } from "lucide-react";
import { calculateEventFinancials } from "@/components/utils/eventFinancials";
import { getEventDisplayName } from "@/lib/eventDisplayName";

// "מי לא שילם" - יתרות פתוחות לפי אירוע, עם קיצור לשליחת דרישת תשלום.
export default function OpenBalancesTable({ events = [], eventServices = [], payments = [], vatRate = 0.18, exchangeRate = 3.6, loading = false }) {
  const rows = useMemo(() => {
    if (!events.length) return [];
    const servicesByEvent = new Map();
    eventServices.forEach((service) => {
      if (!servicesByEvent.has(service.event_id)) servicesByEvent.set(service.event_id, []);
      servicesByEvent.get(service.event_id).push(service);
    });
    const paymentsByEvent = new Map();
    payments.forEach((payment) => {
      if (!payment.event_id) return;
      if (!paymentsByEvent.has(payment.event_id)) paymentsByEvent.set(payment.event_id, []);
      paymentsByEvent.get(payment.event_id).push(payment);
    });

    return events
      .filter((event) => event.status !== "cancelled")
      .map((event) => {
        const financials = calculateEventFinancials(event, servicesByEvent.get(event.id) || [], paymentsByEvent.get(event.id) || [], vatRate, exchangeRate);
        const symbol = (event.primary_currency || "ILS") === "USD" ? "$" : "₪";
        return { event, symbol, total: Number(financials.finalTotal) || 0, paid: Number(financials.totalPaid) || 0, balance: Math.round((Number(financials.balance) || 0) * 100) / 100 };
      })
      .filter((row) => row.balance > 0.5)
      .sort((first, second) => second.balance - first.balance);
  }, [events, eventServices, payments, vatRate, exchangeRate]);

  const totalBalance = rows.reduce((sum, row) => sum + (row.symbol === "₪" ? row.balance : row.balance * exchangeRate), 0);

  return (
    <Card className="bg-white/95">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>יתרות פתוחות לפי אירוע</CardTitle>
        {rows.length > 0 && <span className="text-sm font-semibold text-red-800">סה״כ ₪{Math.round(totalBalance).toLocaleString()}</span>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-6 text-center text-gray-500">טוען יתרות...</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-gray-500">אין יתרות פתוחות - כל האירועים שולמו במלואם.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-gray-500">
                  <th className="p-2">אירוע</th>
                  <th className="p-2">תאריך</th>
                  <th className="p-2">סה״כ</th>
                  <th className="p-2">שולם</th>
                  <th className="p-2">יתרה</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ event, symbol, total, paid, balance }) => (
                  <tr key={event.id} className="border-b last:border-0">
                    <td className="p-2 font-medium">{getEventDisplayName(event)}</td>
                    <td className="p-2 text-gray-500">{event.event_date || "-"}</td>
                    <td className="p-2">{symbol}{total.toLocaleString()}</td>
                    <td className="p-2 text-green-700">{symbol}{paid.toLocaleString()}</td>
                    <td className="p-2 font-semibold text-red-800">{symbol}{balance.toLocaleString()}</td>
                    <td className="p-2">
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/EventDetails?id=${event.id}&clearing=link`}><Link2 className="h-4 w-4" />שלח דרישת תשלום</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}