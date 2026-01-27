import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown } from 'lucide-react';

const STATUS_OPTIONS = [
  { value: "quote", label: "הצעת מחיר" },
  { value: "confirmed", label: "אירוע סגור" },
  { value: "in_progress", label: "אירוע תפור" },
  { value: "completed", label: "אירוע עבר" },
  { value: "cancelled", label: "אירוע בוטל" }
];

const SORT_OPTIONS = [
  { value: "event_date", label: "תאריך אירוע (הקרוב ביותר)" },
  { value: "-event_date", label: "תאריך אירוע (הרחוק ביותר)" },
  { value: "created_date", label: "תאריך יצירה (הישן ביותר)" },
  { value: "-created_date", label: "תאריך יצירה (החדש ביותר)" },
  { value: "family_name", label: "שם משפחה (א-ת)" },
  { value: "-family_name", label: "שם משפחה (ת-א)" }
];

export default function EventFilters({ events, setFilteredEvents }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilters, setStatusFilters] = useState(['quote', 'confirmed', 'in_progress', 'completed', 'cancelled']);
  const [sortBy, setSortBy] = useState('-event_date');

  useEffect(() => {
    if (!events || !Array.isArray(events)) {
      setFilteredEvents([]);
      return;
    }

    let filtered = events.filter(event => {
      const matchesSearch = !searchTerm || 
        (event.event_name && event.event_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (event.family_name && event.family_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (event.child_name && event.child_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (event.location && event.location.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesStatus = statusFilters.length === 0 || statusFilters.includes(event.status);
      
      return matchesSearch && matchesStatus;
    });

    // מיון
    filtered.sort((a, b) => {
      const isDescending = sortBy.startsWith('-');
      const field = isDescending ? sortBy.substring(1) : sortBy;
      
      let aVal = a[field];
      let bVal = b[field];
      
      if (field === 'event_date' || field === 'created_date') {
        aVal = new Date(aVal || 0);
        bVal = new Date(bVal || 0);
      } else if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal || '').toLowerCase();
      }
      
      if (aVal < bVal) return isDescending ? 1 : -1;
      if (aVal > bVal) return isDescending ? -1 : 1;
      return 0;
    });

    setFilteredEvents(filtered);
  }, [events, searchTerm, statusFilters, sortBy, setFilteredEvents]);

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardContent className="p-6 space-y-4">
        <div className="relative">
          <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="חיפוש אירועים..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span>סינון לפי סטטוס ({statusFilters.length} נבחרו)</span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>הצג אירועים עם סטטוס</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {STATUS_OPTIONS.map(option => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={statusFilters.includes(option.value)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setStatusFilters([...statusFilters, option.value]);
                    } else {
                      setStatusFilters(statusFilters.filter(s => s !== option.value));
                    }
                  }}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
                <SelectValue placeholder="בחר אופן מיון" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}