import React from 'react';
import { CalendarDays, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function BarMitzvahResult({ result, title, canOpenCalendar, onOpenCalendar }) {
  const gregorianDate = result.barMitzvahGregorianDate.toLocaleDateString('he-IL');

  return (
    <section className="space-y-3 border-t border-gray-100 pt-5 lg:border-r lg:border-t-0 lg:pr-7 lg:pt-0">
      <div className="rounded-xl bg-gray-50 p-3 text-center">
        <p className="text-xs font-medium text-gray-500">תאריך הלידה העברי</p>
        <p className="mt-1 font-semibold text-gray-800">{result.birthHebrewDate}</p>
      </div>
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-l from-amber-50 to-white p-5 text-center shadow-sm sm:p-6">
        <Crown className="mx-auto h-5 w-5 text-amber-600" />
        <p className="mt-2 text-xs font-semibold text-amber-800">תאריך ה{title}</p>
        <p className="mt-2 text-xl font-bold text-red-900 sm:text-2xl">{result.barMitzvahHebrewDate}</p>
        <div className="mx-auto my-3 h-px max-w-xs bg-amber-200" />
        <p className="text-xs font-medium text-gray-500">התאריך הלועזי</p>
        <p className="mt-1 text-base font-bold text-gray-800 sm:text-lg">{gregorianDate}</p>
      </div>
      <div className="rounded-xl bg-gray-50 p-3 text-center">
        <p className="text-xs text-gray-500">פרשת השבוע</p>
        <p className="mt-1 text-sm font-bold text-gray-800">{result.parashatHashavua}</p>
      </div>
      {canOpenCalendar && (
        <Button variant="outline" onClick={onOpenCalendar} className="h-11 w-full border-red-200 text-red-800 hover:bg-red-50">
          <CalendarDays className="ml-2 h-4 w-4" />מעבר ללוח השנה
        </Button>
      )}
    </section>
  );
}