import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronsUpDown, Link2 } from "lucide-react";
import { calculateEventFinancials } from "@/components/utils/eventFinancials";
import { getEventDisplayName } from "@/lib/eventDisplayName";

// סטטוסי האירוע בעברית המלאה - זהים לתוויות בכרטיסיות ובסינון האירועים.
const STATUS_OPTIONS = [
  { value: "quote", label: "הצעת מחיר" },
  { value: "confirmed", label: "אירוע סגור" },
  { value: "in_progress", label: "אירוע תפור" },
  { value: "completed", label: "אירוע עבר" },
  { value: "cancelled", label: "אירוע בוטל" }
];

const DEFAULT_STATUSES = ["confirmed", "in_progress", "completed"];

// "מי לא שילם" - יתרות פתוחות לפי אירוע, עם קיצור לשליחת דרישת תשלום.
export default function OpenBalancesTable({ events = [], eventServices = [], payments = [], vatRate = 0.18, exchangeRate = 3.6, loading = false }) {
  const [open, setOpen] = useState(false);
  const [statusFilters, setStatusFilters] = useState(DEFAULT_STATUSES);

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
      .filter((event) => statusFilters.includes(event.status || "quote"))
      .map((event) => {
        const financials = calculateEventFinancials(event, servicesByEvent.get(event.id) || [], paymentsByEvent.get(event.id) || [], vatRate, exchangeRate);
        const symbol = (event.primary_currency || "ILS") === "USD" ? "$" : "₪";
        return { event, symbol, total: Number(financials.finalTotal) || 0, paid: Number(financials.totalPaid) || 0, balance: Math.round((Number(financials.balance) || 0) * 100) / 100 };
      })
      .filter((row) => row.balance > 0.5)
      .sort((first, second) => second.balance - first.balance);
  }, [events, eventServices, payments, vatRate, exchangeRate, statusFilters]);

  const totalBalance = rows.reduce((sum, row) => sum + (row.symbol === "₪" ? row.balance : row.balance * exchangeRate), 0);

  return (
    <Card className="bg-white/95">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex items-center gap-2 text-right">
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
              <CardTitle>יתרות פתוחות לפי אירוע</CardTitle>
            </button>
          </CollapsibleTrigger>
          {rows.length > 0 && <span className="text-sm font-semibold text-red-800">סה״כ ₪{Math.round(totalBalance).toLocaleString()}</span>}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between sm:w-72">
                  <span>סינון לפי סטטוס ({statusFilters.length} נבחרו)</span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>הצג אירועים עם סטטוס</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {STATUS_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={statusFilters.includes(option.value)}
                    onCheckedChange={(checked) => setStatusFilters(checked ? [...statusFilters, option.value] : statusFilters.filter((status) => status !== option.value))}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {loading ? (
              <p className="py-6 text-center text-gray-500">טוען יתרות...</p>
            ) : rows.length === 0 ? (
              <p className="py-6 text-center text-gray-500">אין יתרות פתוחות לפי הסינון שנבחר.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-center text-xs text-gray-500">
                      <th className="p-2 text-center">אירוע</th>
                      <th className="p-2 text-center">תאריך</th>
                      <th className="p-2 text-center">סה״כ</th>
                      <th className="p-2 text-center">שולם</th>
                      <th className="p-2 text-center">יתרה</th>
                      <th className="p-2 text-center"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ event, symbol, total, paid, balance }) => (
                      <tr key={event.id} className="border-b last:border-0 text-center">
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
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}