import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const palette = ["#991b1b", "#b91c1c", "#dc2626", "#ef4444", "#f87171", "#fca5a5", "#7f1d1d", "#450a0a"];
const money = (value) => `₪${Number(value).toLocaleString()}`;

function ChartCard({ title, children, empty }) {
  return (
    <Card className="bg-white/95">
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="h-72">
        {empty ? <p className="flex h-full items-center justify-center text-sm text-gray-500">אין נתונים להצגה בתקופה זו</p> : <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>}
      </CardContent>
    </Card>
  );
}

// ארבעת הגרפים של הדוח הכספי.
export default function ReportCharts({ monthly, byType, byStatus, topEvents }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="הכנסות ומע״מ לפי חודש" empty={monthly.length === 0}>
        <AreaChart data={monthly} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={70} />
          <Tooltip formatter={money} />
          <Legend />
          <Area type="monotone" dataKey="revenue" name="הכנסות" stroke="#991b1b" fill="#991b1b" fillOpacity={0.25} />
          <Area type="monotone" dataKey="vat" name="מע״מ" stroke="#f87171" fill="#f87171" fillOpacity={0.25} />
        </AreaChart>
      </ChartCard>

      <ChartCard title="חלוקה לפי סוג מסמך" empty={byType.length === 0}>
        <PieChart>
          <Pie data={byType} dataKey="value" nameKey="name" outerRadius={95} label={(entry) => entry.name}>
            {byType.map((entry, index) => <Cell key={entry.name} fill={palette[index % palette.length]} />)}
          </Pie>
          <Tooltip formatter={money} />
        </PieChart>
      </ChartCard>

      <ChartCard title="מסמכים לפי סטטוס" empty={byStatus.length === 0}>
        <BarChart data={byStatus} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
          <Tooltip />
          <Bar dataKey="count" name="מסמכים" fill="#991b1b" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard title="הכנסות לפי אירוע (10 מובילים)" empty={topEvents.length === 0}>
        <BarChart data={topEvents} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
          <Tooltip formatter={money} />
          <Bar dataKey="value" name="הכנסות" fill="#b91c1c" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ChartCard>
    </div>
  );
}