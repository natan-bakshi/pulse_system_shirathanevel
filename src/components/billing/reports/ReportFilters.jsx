import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from "@/components/billing/documentTypes";

// שורת הסינון הגלובלית של הדוחות הכספיים.
export default function ReportFilters({ filters, onChange, events = [] }) {
  const set = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div><Label className="text-xs text-gray-500">מתאריך</Label><Input type="date" dir="ltr" value={filters.from} onChange={(event) => set("from", event.target.value)} /></div>
      <div><Label className="text-xs text-gray-500">עד תאריך</Label><Input type="date" dir="ltr" value={filters.to} onChange={(event) => set("to", event.target.value)} /></div>
      <div>
        <Label className="text-xs text-gray-500">סוג מסמך</Label>
        <Select value={filters.type} onValueChange={(value) => set("type", value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסוגים</SelectItem>
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-gray-500">סטטוס</Label>
        <Select value={filters.status} onValueChange={(value) => set("status", value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            {Object.entries(DOCUMENT_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-gray-500">אירוע</Label>
        <Select value={filters.eventId} onValueChange={(value) => set("eventId", value)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="all">כל האירועים</SelectItem>
            {events.map((event) => <SelectItem key={event.id} value={event.id}>{event.event_name || event.family_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div><Label className="text-xs text-gray-500">חיפוש</Label><Input value={filters.search} onChange={(event) => set("search", event.target.value)} placeholder="מספר מסמך או לקוח" /></div>
    </div>
  );
}