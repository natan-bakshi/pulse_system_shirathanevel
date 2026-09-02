import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, Loader2, Table2 } from "lucide-react";
import ReportFilters from "@/components/billing/reports/ReportFilters";
import ReportSummaryCards from "@/components/billing/reports/ReportSummaryCards";
import ReportCharts from "@/components/billing/reports/ReportCharts";
import ReportDetailTable from "@/components/billing/reports/ReportDetailTable";
import OpenBalancesTable from "@/components/billing/reports/OpenBalancesTable";
import { buildReportRows, buildStats, byStatusSeries, byTypeSeries, defaultFilters, downloadCsv, filterDocuments, monthlySeries, topEventsSeries } from "@/components/billing/reports/billingReportUtils";

// דוחות וסטטיסטיקות כספיות - מבוססים על המסמכים הפיננסיים והסליקות הקיימים.
export default function BillingReports({ documents = [], events = [], eventsById, generalPayments = [], eventServices = [], allPayments = [], vatRate = 0.18, exchangeRate = 3.6, balancesLoading = false }) {
  const [filters, setFilters] = useState(defaultFilters);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");

  const filtered = useMemo(() => filterDocuments(documents, filters), [documents, filters]);
  const stats = useMemo(() => buildStats(filtered, generalPayments), [filtered, generalPayments]);
  const monthly = useMemo(() => monthlySeries(filtered), [filtered]);
  const byType = useMemo(() => byTypeSeries(filtered), [filtered]);
  const byStatus = useMemo(() => byStatusSeries(filtered), [filtered]);
  const topEvents = useMemo(() => topEventsSeries(filtered, eventsById), [filtered, eventsById]);
  const rows = useMemo(() => buildReportRows(filtered, eventsById), [filtered, eventsById]);

  const exportCsv = () => downloadCsv(rows, `billing-report-${filters.from}-${filters.to}.csv`);

  const exportSheets = async () => {
    setExporting(true);
    setExportMessage("");
    try {
      const response = await base44.functions.invoke("exportBillingReport", { title: `דוח כספי ${filters.from} עד ${filters.to}`, rows });
      if (response.data?.error) throw new Error(response.data.error);
      setExportMessage(response.data.spreadsheetUrl);
    } catch (error) {
      setExportMessage("");
      alert("לא ניתן לייצא ל-Google Sheets: " + (error.response?.data?.error || error.message));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="bg-white/95">
        <CardContent className="space-y-4 p-4">
          <ReportFilters filters={filters} onChange={setFilters} events={events} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={rows.length <= 1}><Download className="ml-2 h-4 w-4" />ייצוא ל-CSV</Button>
            <Button variant="outline" onClick={exportSheets} disabled={exporting || rows.length <= 1}>
              {exporting ? <><Loader2 className="ml-2 h-4 w-4 animate-spin" />מייצא...</> : <><Table2 className="ml-2 h-4 w-4" />ייצוא ל-Google Sheets</>}
            </Button>
            <Button variant="ghost" onClick={() => setFilters(defaultFilters())}>אפס סינון</Button>
            {exportMessage && <a href={exportMessage} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">הגיליון נוצר - לחץ לצפייה</a>}
          </div>
        </CardContent>
      </Card>

      <OpenBalancesTable events={events} eventServices={eventServices} payments={allPayments} vatRate={vatRate} exchangeRate={exchangeRate} loading={balancesLoading} />
      <ReportSummaryCards stats={stats} />
      <ReportCharts monthly={monthly} byType={byType} byStatus={byStatus} topEvents={topEvents} />
      <ReportDetailTable rows={rows} />
    </div>
  );
}