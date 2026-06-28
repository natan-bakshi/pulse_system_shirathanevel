import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function renderField(field, value, onChange, disabled) {
  switch (field.type) {
    case 'textarea':
      return <Textarea value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || field.name} disabled={disabled} />;
    case 'select':
      return (
        <Select value={value || ""} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger><SelectValue placeholder={field.placeholder || field.name} /></SelectTrigger>
          <SelectContent>
            {(field.options || []).map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    case 'date':
      return <Input type="date" value={value} onChange={e => onChange(e.target.value)} required={field.required} disabled={disabled} />;
    case 'time':
      return <Input type="time" value={value} onChange={e => onChange(e.target.value)} disabled={disabled} />;
    case 'number':
      return <Input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || field.name} disabled={disabled} />;
    case 'email':
      return <Input type="email" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || field.name} disabled={disabled} />;
    case 'phone':
      return <Input type="tel" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || field.name} disabled={disabled} />;
    case 'url':
      return <Input type="url" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || field.name} disabled={disabled} />;
    default:
      return <Input value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || field.name} required={field.required} disabled={disabled} />;
  }
}

export default function DynamicEventFieldsSection({ fields, values, onChange, disabled, eventDate, onEventDateChange }) {
  const sorted = [...fields].sort((a, b) => (a.order || 0) - (b.order || 0));
  const eventDetailFields = sorted.filter(f => f.category !== 'organizer_details');
  const organizerFields = sorted.filter(f => f.category === 'organizer_details');

  const handleFieldChange = (fieldId, value) => {
    onChange({ ...values, [fieldId]: value });
  };

  return (
    <>
      {(eventDetailFields.length > 0 || onEventDateChange) && (
        <div className="p-3 sm:p-6 border rounded-lg bg-gray-50/80">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 border-b pb-2">פרטי אירוע</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {onEventDateChange && (
              <div>
                <Label>תאריך האירוע *</Label>
                <Input type="date" value={eventDate || ''} onChange={e => onEventDateChange(e.target.value)} required disabled={disabled} />
                <p className="text-xs text-gray-500 mt-1">שדה מערכת קבוע שמגדיר את תאריך האירוע בלוח ובכל ההתראות.</p>
              </div>
            )}
            {eventDetailFields.map(field => (
              <div key={field.id} className={field.type === 'textarea' ? 'col-span-full' : ''}>
                <Label>{field.name}{field.required ? ' *' : ''}</Label>
                {renderField(field, values[field.id] || '', (v) => handleFieldChange(field.id, v), disabled)}
              </div>
            ))}
          </div>
        </div>
      )}
      {organizerFields.length > 0 && (
        <div className="p-3 sm:p-6 border rounded-lg bg-gray-50/80">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 border-b pb-2">פרטי מזמין</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {organizerFields.map(field => (
              <div key={field.id}>
                <Label>{field.name}{field.required ? ' *' : ''}</Label>
                {renderField(field, values[field.id] || '', (v) => handleFieldChange(field.id, v), disabled)}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}