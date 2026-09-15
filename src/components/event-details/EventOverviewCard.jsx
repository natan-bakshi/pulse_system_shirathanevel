import React, { useState } from 'react';
import { useOrganizerConfig } from '@/hooks/useOrganizerConfig';
import { getField, systemKey, displayEventField, parseObject } from '@/lib/eventFields';
import GuestCountChangeDialog from '@/components/events/GuestCountChangeDialog';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Edit, Calendar, MapPin, Users, Clock, Home, Save, Loader2, Trash2, Tag } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getCurrencySymbol } from '@/components/utils/currencyUtils';
import OrganizerTypeSelector from '@/components/quotes/OrganizerTypeSelector';
import DynamicEventFieldsSection from '@/components/events/DynamicEventFieldsSection';
import { getEventTitle } from '@/lib/eventDisplayName';

function getStatusText(status) {
  const statusTexts = { quote: "הצעת מחיר", confirmed: "אירוע סגור", in_progress: "אירוע תפור", completed: "אירוע עבר", cancelled: "אירוע בוטל" };
  return statusTexts[status] || status;
}

function getStatusColor(status) {
  const colors = { quote: "bg-yellow-100 text-yellow-800", confirmed: "bg-blue-100 text-blue-800", in_progress: "bg-green-100 text-green-800", completed: "bg-gray-100 text-gray-800", cancelled: "bg-red-100 text-red-800" };
  return colors[status] || "bg-gray-100";
}

export default function EventOverviewCard({ 
  event, 
  isAdmin, 
  editingSection, 
  setEditingSection,
  eventDetailsData,
  setEventDetailsData,
  handleSaveEventDetails,
  isSavingEventDetails,
  handleStatusChange,
  handleDeleteEvent
}) {
  const { fields: eventFields, isLoading, isError } = useOrganizerConfig(editingSection === 'event_details' ? (eventDetailsData.organizer_type ?? event.organizer_type) : event.organizer_type);
  const field = key => getField(eventFields, key);
  const customFieldValues = parseObject(event.custom_organizer_fields);
  const [guestChange, setGuestChange] = useState(null);
  const onFieldChange = (key, value) => {
    if (key === 'guest_count' && event.is_price_per_guest && event.price_per_guest > 0) {
      const before = Number(eventDetailsData.guest_count || 0), after = Number(value);
      if (before > 0 && after > 0 && before !== after) setGuestChange({oldGuestCount: before, newGuestCount: after, currentPricePerGuest: eventDetailsData.price_per_guest ?? event.price_per_guest, currentTotal: (eventDetailsData.price_per_guest ?? event.price_per_guest) * before});
    }
    setEventDetailsData(prev => ({...prev, [key]: value}));
  };
  const icons = {event_date: Calendar, event_time: Clock, location: MapPin, city: Home, guest_count: Users};
  const detailsKeys = ['event_name','event_type','event_date','event_time','location','city','guest_count','concept','notes'];
  return (
    <>
      {/* Header Card */}
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl w-full max-w-full overflow-hidden">
        <CardHeader className="p-3 sm:p-6">
          <div className="flex flex-col gap-3">
            <div className="min-w-0 w-full">
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold break-words leading-tight">{getEventTitle(event)}</h2>
              {field("child_name") && event.child_name && <p className="text-gray-600 mt-1 text-sm sm:text-base break-words">{field("child_name")?.name}: {event.child_name}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="w-full sm:w-auto bg-white">
                      <Badge className={getStatusColor(event.status)}>
                        {getStatusText(event.status)}
                      </Badge>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => handleStatusChange('quote')}>הצעת מחיר</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleStatusChange('confirmed')}>אירוע סגור</DropdownMenuItem>
                    <DropdownMenuItem disabled>אירוע תפור — נקבע לפי השיבוצים והאישורים</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleStatusChange('completed')}>אירוע עבר</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleStatusChange('cancelled')}>אירוע בוטל</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {isAdmin && handleDeleteEvent && (
                <Button 
                  size="sm" 
                  variant="destructive"
                  onClick={handleDeleteEvent}
                  className="w-full sm:w-auto"
                >
                  <Trash2 className="h-4 w-4 ml-2" />
                  מחק אירוע
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          {editingSection === 'event_details' ? (
            <div className="col-span-full space-y-4 p-4 bg-gray-50 rounded-lg">
              <DynamicEventFieldsSection fields={eventFields.filter(f => !['family_name','child_name'].includes(systemKey(f)))} values={eventDetailsData._customFields || customFieldValues}
                onChange={vals => setEventDetailsData(prev => ({...prev, _customFields: vals}))}
                eventValues={eventDetailsData} onEventChange={onFieldChange} disabled={isSavingEventDetails || isLoading} compact />
              <div className="col-span-full">
                <Label>סוג הזמנה</Label>
                <OrganizerTypeSelector value={eventDetailsData.organizer_type || ''} onChange={(v) => setEventDetailsData({ ...eventDetailsData, organizer_type: v })} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditingSection(null)} disabled={isSavingEventDetails}>ביטול</Button>
                <Button onClick={handleSaveEventDetails} disabled={isSavingEventDetails || isLoading || isError || !!guestChange}>
                  {isSavingEventDetails && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                  <Save className="h-4 w-4 ml-2" />שמור
                </Button>
              </div>
            </div>
          ) : (
            <div className="col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {detailsKeys.filter(key => field(key)).map(key => {
                const definition = field(key);
                const Icon = icons[key];
                let value = displayEventField(definition, event);
                if (key === 'event_date') value = value && !Number.isNaN(Date.parse(value)) ? format(new Date(value), 'dd/MM/yyyy', { locale: he }) : 'לא צוין';
                if (['concept','notes'].includes(key) && !value) return null;
                return <div key={key} className={['concept','notes'].includes(key) ? 'col-span-full break-words' : 'flex items-center gap-2 min-w-0'}>
                  {Icon && <Icon className="h-4 w-4 text-gray-500 shrink-0" />}
                  <span className="min-w-0 break-words"><strong>{definition.name}: </strong>{value ?? 'לא צוין'}{key === 'guest_count' && event.is_price_per_guest && event.price_per_guest > 0 && ` (${getCurrencySymbol(event.primary_currency || 'ILS')}${event.price_per_guest.toLocaleString()} למשתתף)`}</span>
                </div>;
              })}
              {eventFields.filter(f => !systemKey(f) && f.category !== 'organizer_details').map(f => {
                const value = displayEventField(f, event, customFieldValues);
                return value === '' || value == null ? null : <div key={f.id} className="break-words"><strong>{f.name}: </strong>{String(value)}</div>;
              })}
              {event.organizer_type && <div className="flex items-center gap-2 min-w-0"><Tag className="h-4 w-4 text-gray-500 shrink-0" /><span>סוג הזמנה: {event.organizer_type}</span></div>}
              {isAdmin && (
                <div className="col-span-full">
                  <Button variant="outline" size="sm" onClick={() => { 
                    setEditingSection('event_details'); 
                    setEventDetailsData({ 
                      event_name: event.event_name, 
                      event_type: event.event_type,
                      event_date: event.event_date, 
                      event_time: event.event_time, 
                      location: event.location, 
                      city: event.city, 
                      family_name: event.family_name,
                      child_name: event.child_name,
                      guest_count: event.guest_count, 
                      concept: event.concept, 
                      notes: event.notes,
                      organizer_type: event.organizer_type || '',
                      _customFields: { ...customFieldValues }
                    }); 
                  }}>
                    <Edit className="h-4 w-4 ml-2" />ערוך פרטים
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {guestChange && <GuestCountChangeDialog isOpen onClose={() => { setEventDetailsData(prev => ({...prev, guest_count: guestChange.oldGuestCount})); setGuestChange(null); }} {...guestChange} currency={event.primary_currency}
        onKeepPricePerGuest={() => setGuestChange(null)}
        onKeepTotalPrice={() => { setEventDetailsData(prev => ({...prev, price_per_guest: guestChange.currentTotal / guestChange.newGuestCount})); setGuestChange(null); }} />}
    </>
  );
}
