import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Link as LinkIcon, X, Plus, Search, CalendarPlus } from 'lucide-react';
import QuickEventCreateDialog from './QuickEventCreateDialog';

/**
 * בורר שיוך אירוע להצעת מחיר ידנית.
 * מציג את האירוע המשויך הנוכחי, מאפשר חיפוש/בחירה, ניתוק, או יצירה מהירה.
 */
export default function EventLinkSelector({ linkedEventId, onChange }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data: events = [], refetch } = useQuery({
    queryKey: ['events-for-manual-quote'],
    queryFn: () => base44.entities.Event.list('-event_date'),
    staleTime: 60 * 1000
  });

  const linkedEvent = useMemo(
    () => events.find(e => e.id === linkedEventId),
    [events, linkedEventId]
  );

  const filteredEvents = useMemo(() => {
    if (!search.trim()) return events.slice(0, 30);
    const q = search.toLowerCase();
    return events.filter(e =>
      (e.event_name || '').toLowerCase().includes(q) ||
      (e.family_name || '').toLowerCase().includes(q) ||
      (e.child_name || '').toLowerCase().includes(q) ||
      (e.event_date || '').includes(q)
    ).slice(0, 30);
  }, [events, search]);

  const handleSelect = (eventId) => {
    onChange(eventId);
    setSearchOpen(false);
    setSearch('');
  };

  const handleCreated = (newEvent) => {
    refetch();
    onChange(newEvent.id);
  };

  return (
    <Card className="bg-white/95">
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-semibold">שיוך אירוע:</span>
            {linkedEvent ? (
              <Badge variant="default" className="bg-green-100 text-green-800 border-green-200 px-2 py-1">
                {linkedEvent.event_name} • {linkedEvent.event_date}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-gray-500">לא משויך</Badge>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {linkedEvent && (
              <Button variant="ghost" size="sm" onClick={() => onChange('')} className="text-red-600 hover:bg-red-50">
                <X className="h-4 w-4 ml-1" /> נתק שיוך
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setSearchOpen(o => !o)}>
              <Search className="h-4 w-4 ml-1" /> {linkedEvent ? 'שנה אירוע' : 'בחר אירוע קיים'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <CalendarPlus className="h-4 w-4 ml-1" /> צור אירוע חדש
            </Button>
          </div>
        </div>

        {searchOpen && (
          <div className="mt-3 border rounded-lg bg-gray-50 p-3">
            <Input
              autoFocus
              placeholder="חפש לפי שם אירוע / משפחה / ילד / תאריך..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filteredEvents.length === 0 ? (
                <div className="text-center text-gray-500 py-4 text-sm">לא נמצאו אירועים</div>
              ) : filteredEvents.map(ev => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => handleSelect(ev.id)}
                  className={`w-full text-right p-2 rounded hover:bg-white transition flex items-center justify-between ${
                    linkedEventId === ev.id ? 'bg-green-50 border border-green-200' : 'bg-white/70 border'
                  }`}
                >
                  <div>
                    <div className="font-medium text-sm">{ev.event_name}</div>
                    <div className="text-xs text-gray-500">
                      {ev.family_name} {ev.child_name ? `• ${ev.child_name}` : ''} • {ev.event_date}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">{ev.status}</Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        <QuickEventCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
      </CardContent>
    </Card>
  );
}