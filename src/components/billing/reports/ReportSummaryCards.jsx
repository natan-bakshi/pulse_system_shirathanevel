import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Ban, FileText, Landmark, Percent, TrendingUp, Wallet } from "lucide-react";

const money = (value) => `₪${Math.round(Number(value) || 0).toLocaleString()}`;

// כרטיסי הסיכום של הדוח הכספי.
export default function ReportSummaryCards({ stats }) {
  const cards = [
    { icon: TrendingUp, label: "סה״כ הכנסות", value: money(stats.revenue) },
    { icon: Percent, label: "מע״מ נטו", value: money(stats.vat) },
    { icon: FileText, label: "מסמכים בתקופה", value: stats.documentCount.toLocaleString() },
    { icon: Landmark, label: "מסמכים פתוחים", value: `${stats.openCount} · ${money(stats.openTotal)}` },
    { icon: Ban, label: "מזוכים / מבוטלים", value: `${stats.creditedCount} · ${money(stats.creditedTotal)}` },
    { icon: Wallet, label: "סליקות כלליות", value: money(stats.generalPaymentsTotal) }
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.label} className="bg-white/95">
          <CardContent className="flex items-center gap-3 p-4">
            <card.icon className="h-7 w-7 shrink-0 text-red-800" />
            <div className="min-w-0">
              <p className="truncate text-xs text-gray-500">{card.label}</p>
              <p className="truncate text-lg font-bold">{card.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}