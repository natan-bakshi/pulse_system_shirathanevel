import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Edit, Calendar, MapPin, Users, Clock, Home, Save, Loader2, Trash2, Tag } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getCurrencySymbol } from '@/components/utils/currencyUtils';
import OrganizerTypeSelector from '@/components/quotes/OrganizerTypeSelector';
import DynamicEventFieldsSection from '@/components/events/DynamicEventFieldsSection';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

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
  // Load organizer type config to check for dynamic event_fields
  const { data: organizerTypes = [] } = useQuery({
    queryKey: ['organizerTypes'],
    queryFn: () => base44.entities.QuoteOrganizerType.list(),
    staleTime: 5 * 60 * 1000,
  });

  const currentOrgType = organizerTypes.find(t => t.type_name === event.organizer_type && t.is_active !== false);
  let eventFields = null;
  try { eventFields = currentOrgType?.event_fields ? JSON.parse(currentOrgType.event_fields) : null; } catch { eventFields = null; }
  const hasDynamicFields = eventFields && eventFields.length > 0;

  let customFieldValues = {};
  try { customFieldValues = event.custom_organizer_fields ? JSON.parse(event.custom_organizer_fields) : {}; } catch { customFieldValues = {}; }
  return (
    <>
      {/* Header Card */}
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl w-full max-w-full overflow-hidden">
        <CardHeader className="p-3 sm:p-6">
          <div className="flex flex-col gap-3">
            <div className="min-w-0 w-full">
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold break-words leading-tight">{event.event_name} - משפחת {event.family_name}</h2>
              {event.child_name && <p className="text-gray-600 mt-1 text-sm sm:text-base break-words">שם החתן/כלה: {event.child_name}</p>}
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
                    <DropdownMenuItem onClick={() => handleStatusChange('in_progress')}>אירוע תפור</DropdownMenuItem>
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
              {hasDynamicFields ? (
                <DynamicEventFieldsSection
                  fields={eventFields}
                  values={eventDetailsData._customFields || customFieldValues}
                  onChange={(vals) => setEventDetailsData(prev => ({ ...prev, _customFields: vals }))}
                  disabled={isSavingEventDetails}
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><Label>שם האירוע</Label><Input value={eventDetailsData.event_name || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, event_name: e.target.value })} /></div>
                  <div><Label>סוג אירוע</Label><Select value={eventDetailsData.event_type || ''} onValueChange={(v) => setEventDetailsData({ ...eventDetailsData, event_type: v })}><SelectTrigger><SelectValue placeholder="בחר סוג אירוע" /></SelectTrigger><SelectContent><SelectItem value="bar_mitzvah">בר מצווה</SelectItem><SelectItem value="bat_mitzvah">בת מצווה</SelectItem><SelectItem value="wedding">חתונה</SelectItem><SelectItem value="other">אחר</SelectItem></SelectContent></Select></div>
                  <div><Label>תאריך</Label><Input type="date" value={eventDetailsData.event_date || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, event_date: e.target.value })} /></div>
                  <div><Label>שעה</Label><Input type="time" value={eventDetailsData.event_time || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, event_time: e.target.value })} /></div>
                  <div><Label>מיקום</Label><Input value={eventDetailsData.location || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, location: e.target.value })} /></div>
                  <div><Label>עיר מגורים</Label><Input value={eventDetailsData.city || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, city: e.target.value })} /></div>
                  <div><Label>שם משפחה</Label><Input value={eventDetailsData.family_name || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, family_name: e.target.value })} /></div>
                  <div><Label>שם הילד/ה</Label><Input value={eventDetailsData.child_name || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, child_name: e.target.value })} /></div>
                  <div><Label>מספר אורחים</Label><Input type="number" value={eventDetailsData.guest_count || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, guest_count: e.target.value })} /></div>
                  <div><Label>קונספט</Label><Input value={eventDetailsData.concept || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, concept: e.target.value })} /></div>
                </div>
              )}
              <div className="col-span-full">
                <Label>סוג הזמנה</Label>
                <OrganizerTypeSelector value={eventDetailsData.organizer_type || ''} onChange={(v) => setEventDetailsData({ ...eventDetailsData, organizer_type: v })} />
              </div>
              {!hasDynamicFields && (
                <div className="col-span-full">
                  <Label>הערות</Label>
                  <Textarea value={eventDetailsData.notes || ''} onChange={(e) => setEventDetailsData({ ...eventDetailsData, notes: e.target.value })} rows={3} />
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditingSection(null)} disabled={isSavingEventDetails}>ביטול</Button>
                <Button onClick={handleSaveEventDetails} disabled={isSavingEventDetails}>
                  {isSavingEventDetails && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                  <Save className="h-4 w-4 ml-2" />שמור
                </Button>
              </div>
            </div>
          ) : (
            <div className="col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {hasDynamicFields ? (
                <>
                  {eventFields.sort((a,b) => (a.order||0) - (b.order||0)).map(field => {
                    const val = customFieldValues[field.id];
                    if (!val) return null;
                    return (
                      <div key={field.id} className={`flex items-center gap-2 min-w-0 ${field.type === 'textarea' ? 'col-span-full break-words' : ''}`}>
                        <strong className="text-gray-600 text-sm shrink-0">{field.name}:</strong>
                        <span className="truncate">{val}</span>
                      </div>
                    );
                  })}
                  {event.organizer_type && <div className="flex items-center gap-2 min-w-0"><Tag className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">סוג הזמנה: {event.organizer_type}</span></div>}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 min-w-0"><Calendar className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{format(new Date(event.event_date), 'dd/MM/yyyy', { locale: he })}</span></div>
                  <div className="flex items-center gap-2 min-w-0"><Clock className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.event_time}</span></div>
                  <div className="flex items-center gap-2 min-w-0"><MapPin className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.location}</span></div>
                  <div className="flex items-center gap-2 min-w-0"><Home className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.city || 'לא צוין'}</span></div>
                  <div className="flex items-center gap-2 min-w-0"><Users className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.guest_count} אורחים{event.is_price_per_guest && event.price_per_guest > 0 && ` (${getCurrencySymbol(event.primary_currency || 'ILS')}${event.price_per_guest.toLocaleString(undefined, { maximumFractionDigits: 2 })} למשתתף)`}</span></div>
                  {event.organizer_type && <div className="flex items-center gap-2 min-w-0"><Tag className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">סוג הזמנה: {event.organizer_type}</span></div>}
                  {event.concept && <div className="col-span-full break-words"><strong>קונספט:</strong> {event.concept}</div>}
                  {event.notes && <div className="col-span-full break-words"><strong>הערות:</strong> {event.notes}</div>}
                </>
              )}
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
                      _customFields: customFieldValues
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
    </>
  );
}