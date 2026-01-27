import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Search, User as UserIcon, Calendar, Download, Home } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import ExportDialog from "../components/export/ExportDialog";
import PhoneNumber from "../components/ui/PhoneNumber";
import EmailAddress from "../components/ui/EmailAddress";

const ParentInfo = ({ parent }) => {
    return (
         <div className="flex flex-col text-sm border-b border-gray-200 py-2 last:border-b-0">
            <span className="font-medium">{parent.name}</span>
            <PhoneNumber phone={parent.phone} className="text-gray-600" />
            <EmailAddress email={parent.email} className="text-gray-600" />
        </div>
    )
};

export default function ClientManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("-event_date");
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [expandedCards, setExpandedCards] = useState({});

  // Debouncing effect for search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // React Query for events data
  const { data: events = [], isLoading: loading } = useQuery({
    queryKey: ['events', sortBy],
    queryFn: () => base44.entities.Event.list(sortBy),
    staleTime: 2 * 60 * 1000, // 2 minutes
    cacheTime: 5 * 60 * 1000, // 5 minutes
    select: (data) => Array.isArray(data) ? data : []
  });

  const toggleCardExpansion = useCallback((eventId) => {
    setExpandedCards(prev => ({...prev, [eventId]: !prev[eventId]}));
  }, []);

  const filteredClients = useMemo(() => {
    return (events || []).filter(event => 
      event.family_name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (event.child_name || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
      (event.parents || []).some(p => p.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
    );
  }, [events, debouncedSearchTerm]);

  // עמודות לייצוא לקוחות
  const exportColumns = useMemo(() => [
    { key: 'family_name', title: 'שם משפחה' },
    { key: 'child_name', title: 'שם ילד/ה' },
    { key: 'city', title: 'עיר מגורים' },
    { key: 'event_name', title: 'אירוע' },
    { key: 'event_date', title: 'תאריך אירוע', render: (value) => format(new Date(value), "dd/MM/yyyy", { locale: he }) },
    { key: 'location', title: 'מיקום' },
    { key: 'guest_count', title: 'מספר אורחים' },
    { key: 'parent1_name', title: 'הורה 1 - שם', render: (value, row) => row.parents?.[0]?.name || '' },
    { key: 'parent1_phone', title: 'הורה 1 - טלפון', render: (value, row) => row.parents?.[0]?.phone || '' },
    { key: 'parent1_email', title: 'הורה 1 - אימייל', render: (value, row) => row.parents?.[0]?.email || '' },
    { key: 'parent2_name', title: 'הורה 2 - שם', render: (value, row) => row.parents?.[1]?.name || '' },
    { key: 'parent2_phone', title: 'הורה 2 - טלפון', render: (value, row) => row.parents?.[1]?.phone || '' },
    { key: 'parent2_email', title: 'הורה 2 - אימייל', render: (value, row) => row.parents?.[1]?.email || '' },
    { key: 'notes', title: 'הערות' }
  ], []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-white">ניהול לקוחות</h1>
        <Button 
          onClick={() => setShowExportDialog(true)} 
          variant="outline"
          className="bg-white/10 border-white/20 text-white hover:bg-white/20"
        >
          <Download className="h-4 w-4 ml-2" />
          ייצא לקוחות
        </Button>
      </div>

      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="חיפוש לקוחות..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-10"
              />
            </div>
             <div className="flex items-center gap-2">
              <Label htmlFor="sort-clients" className="whitespace-nowrap">מיין לפי:</Label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger id="sort-clients" className="w-full">
                  <SelectValue placeholder="בחר מיון" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="-event_date">תאריך אירוע (האחרון קודם)</SelectItem>
                  <SelectItem value="event_date">תאריך אירוע (הקרוב קודם)</SelectItem>
                  <SelectItem value="family_name">שם משפחה (א-ת)</SelectItem>
                  <SelectItem value="-family_name">שם משפחה (ת-א)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredClients.map(event => {
          const parents = event.parents || [];
          const isExpanded = expandedCards[event.id];
          const parentsToShow = isExpanded ? parents : parents.slice(0, 2);
          const hasMoreParents = parents.length > 2;

          return (
            <Card key={event.id} className="bg-white/95 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-shadow duration-300 h-full flex flex-col">
              <CardHeader>
                <Link to={createPageUrl(`EventDetails?id=${event.id}`)}>
                    <CardTitle>משפחת {event.family_name}</CardTitle>
                    <p className="text-sm text-gray-600">אירוע: {event.event_name}</p>
                </Link>
              </CardHeader>
              <CardContent className="space-y-2 flex-grow">
                <div className="flex items-center gap-2 text-sm">
                  <UserIcon className="h-4 w-4 text-gray-500" />
                  <span>{event.child_name || 'לא צוין'}</span>
                </div>
                {event.city && (
                  <div className="flex items-center gap-2 text-sm">
                    <Home className="h-4 w-4 text-gray-500" />
                    <span>{event.city}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <span>{format(new Date(event.event_date), "dd/MM/yyyy", { locale: he })}</span>
                </div>
                <div>
                  <h4 className="font-semibold text-sm mt-2 mb-1">הורים:</h4>
                  {parentsToShow.map((parent, index) => (
                    <ParentInfo key={index} parent={parent} />
                  ))}
                  {hasMoreParents && (
                    <Button 
                      variant="link" 
                      size="sm" 
                      onClick={() => toggleCardExpansion(event.id)} 
                      className="p-0 h-auto text-xs"
                    >
                      {isExpanded ? 'הצג פחות...' : `הצג עוד ${parents.length - 2} הורים...`}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        data={filteredClients}
        columns={exportColumns}
        title="רשימת לקוחות"
        exportTypes={['csv', 'html']}
      />
    </div>
  );
}