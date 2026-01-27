import React, { useState, useMemo, useEffect } from "react"; // הוספתי useEffect
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, setMonth, setYear } from "date-fns";
import { he } from "date-fns/locale";

export default function EventsCalendar({ events, onDateClick, onEventClick }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [holidays, setHolidays] = useState({}); // סטייט חדש לחגים
  const [expandedDays, setExpandedDays] = useState({}); // סטייט לניהול חשיפת אירועים נוספים

  // מיפוי מספרים לאותיות ליום בחודש העברי
  const hebrewDaysGematria = {
    1: "א'", 2: "ב'", 3: "ג'", 4: "ד'", 5: "ה'", 6: "ו'", 7: "ז'", 8: "ח'", 9: "ט'", 10: "י'",
    11: 'י"א', 12: 'י"ב', 13: 'י"ג', 14: 'י"ד', 15: 'ט"ו', 16: 'ט"ז', 17: 'י"ז', 18: 'י"ח', 19: 'י"ט', 20: "כ'",
    21: 'כ"א', 22: 'כ"ב', 23: 'כ"ג', 24: 'כ"ד', 25: 'כ"ה', 26: 'כ"ו', 27: 'כ"ז', 28: 'כ"ח', 29: 'כ"ט', 30: "ל'"
  };

  // שליפת חגים מה-API של Hebcal ללא ספריות חיצוניות
  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    
    fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=on&year=${year}&month=${month}&ss=on&mf=on&c=off&geo=none&m=0&lg=h`)
      .then(res => res.json())
      .then(data => {
        const holidayMap = {};
        data.items.forEach(item => {
          holidayMap[item.date] = item.title;
        });
        setHolidays(holidayMap);
      })
      .catch(err => console.error("Error fetching holidays:", err));
  }, [currentDate]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    
    // יצירת טווח הימים שיוצגו בלוח השנה
    // weekStartsOn: 0 = יום ראשון (ברירת מחדל בישראל)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentDate]);

  const eventsMap = useMemo(() => {
    const map = {};
    events.forEach(event => {
      // שמירת התאריך בפורמט yyyy-MM-dd כדי להתאים למפתח
      const dateKey = format(new Date(event.event_date), 'yyyy-MM-dd');
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(event);
    });
    return map;
  }, [events]);

  const handleDateClick = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    onDateClick(dateStr);
  };

  const handleEventClick = (event, e) => {
    e.stopPropagation();
    onEventClick(event);
  };

  const handleMonthChange = (monthValue) => {
    setCurrentDate(setMonth(currentDate, parseInt(monthValue)));
  };

  const handleYearChange = (yearValue) => {
    setCurrentDate(setYear(currentDate, parseInt(yearValue)));
  };

  const getStatusColor = (status) => {
    const colors = {
      quote: "bg-yellow-100 text-yellow-800",
      confirmed: "bg-blue-100 text-blue-800", 
      in_progress: "bg-green-100 text-green-800",
      completed: "bg-gray-100 text-gray-800",
      cancelled: "bg-red-100 text-red-800"
    };
    return colors[status] || "bg-gray-100";
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);

  const months = [
    { value: 0, label: 'ינואר' },
    { value: 1, label: 'פברואר' },
    { value: 2, label: 'מרץ' },
    { value: 3, label: 'אפריל' },
    { value: 4, label: 'מאי' },
    { value: 5, label: 'יוני' },
    { value: 6, label: 'יולי' },
    { value: 7, label: 'אוגוסט' },
    { value: 8, label: 'ספטמבר' },
    { value: 9, label: 'אוקטובר' },
    { value: 10, label: 'נובמבר' },
    { value: 11, label: 'דצמבר' }
  ];

  // ימי השבוע מיום ראשון עד שבת
  const weekDays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(subMonths(currentDate, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          
          <div className="flex items-center gap-2">
            <Select value={currentDate.getMonth().toString()} onValueChange={handleMonthChange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map(month => (
                  <SelectItem key={month.value} value={month.value.toString()}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={currentDate.getFullYear().toString()} onValueChange={handleYearChange}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map(year => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" onClick={() => setCurrentDate(addMonths(currentDate, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 mb-4">
          {weekDays.map(day => (
            <div key={day} className="p-2 text-center font-semibold text-gray-600">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map(date => {
            const dateKey = format(date, 'yyyy-MM-dd');
            const dayEvents = eventsMap[dateKey] || [];
            const isCurrentMonth = isSameMonth(date, currentDate);
            const isToday = isSameDay(date, new Date());
            
            // המרה לתאריך עברי בעזרת Intl המובנה בדפדפן
            const hebDayNumber = new Intl.DateTimeFormat('he-u-ca-hebrew', {day: 'numeric'}).format(date);
            const hebDaySymbol = hebrewDaysGematria[parseInt(hebDayNumber)] || hebDayNumber;
            const hebMonthName = new Intl.DateTimeFormat('he-u-ca-hebrew', {month: 'long'}).format(date);
            
            const holidayName = holidays[dateKey];
            const isExpanded = expandedDays[dateKey];

            return (
              <div
                key={dateKey}
                onClick={() => handleDateClick(date)}
                className={`
                  min-h-[100px] p-1 border border-gray-200 cursor-pointer hover:bg-blue-50 transition-colors
                  ${!isCurrentMonth ? 'bg-gray-50 text-gray-400' : 'bg-white'}
                  ${isToday ? 'ring-2 ring-blue-500' : ''}
                `}
              >
                <div className="flex justify-between items-start mb-1">
                  <div className={`text-sm font-medium ${isToday ? 'text-blue-600' : ''}`}>
                    {format(date, 'd')}
                  </div>
                  {/* הצגת יום בחודש העברי באותיות, ושם חודש במסכים גדולים */}
                  <div className="text-[10px] text-gray-400 font-light text-left">
                    {hebDaySymbol} 
                    <span className="hidden md:inline mr-1 text-[9px]">{hebMonthName}</span>
                  </div>
                </div>

                {/* הצגת שם החג אם קיים */}
                {holidayName && (
                  <div className="text-[9px] text-red-500 font-bold leading-tight truncate mb-1" title={holidayName}>
                    {holidayName}
                  </div>
                )}

                <div 
                  className={`space-y-1 overflow-y-auto transition-all duration-300 ${isExpanded ? 'max-h-[140px]' : 'max-h-[52px]'}`}
                >
                  {dayEvents.map(event => (
                    <div
                      key={event.id}
                      onClick={(e) => handleEventClick(event, e)}
                      className={`text-xs p-1 rounded truncate cursor-pointer hover:opacity-80 ${getStatusColor(event.status)}`}
                      title={`${event.event_name} - משפחת ${event.family_name}`}
                    >
                      {event.family_name}
                    </div>
                  ))}
                </div>

                {/* כפתור גילוי/סגירת אירועים נוספים */}
                {dayEvents.length > 2 && (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedDays(prev => ({ ...prev, [dateKey]: !isExpanded }));
                    }}
                    className="text-[10px] text-blue-600 font-bold mt-1 hover:underline text-center"
                  >
                    {isExpanded ? 'סגור' : `+${dayEvents.length - 2} עוד`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}