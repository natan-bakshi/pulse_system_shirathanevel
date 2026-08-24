import React, { useState } from 'react';
import { CalendarDays, Calculator, Crown, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { calculateBarMitzvah } from '@/lib/barMitzvahCalculator';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function BarMitzvahCalculator() {
  const navigate = useNavigate();
  const [birthDate, setBirthDate] = useState('');
  const [type, setType] = useState('bar');
  const [isAfterSunset, setIsAfterSunset] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);

  React.useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  const handleCalculate = () => {
    try {
      setResult(calculateBarMitzvah(birthDate, isAfterSunset, type));
      setError('');
    } catch (calculationError) {
      setResult(null);
      setError(calculationError.message);
    }
  };

  const goToCalendar = () => {
    const month = result.barMitzvahGregorianDate.toISOString().slice(0, 7);
    navigate(`/AdminDashboard?month=${month}`);
  };

  const title = type === 'bat' ? 'בת מצווה' : 'בר מצווה';

  return (
    <div className="mx-auto w-full max-w-md py-2 sm:py-6" dir="rtl">
      <Card className="overflow-hidden border-white/40 bg-white/95 shadow-2xl backdrop-blur-sm">
        <div className="bg-gradient-to-l from-red-950 via-red-900 to-red-800 px-5 py-6 text-white sm:px-7">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-200 ring-1 ring-amber-200/30">
            <Calculator className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">מחשבון בר/בת מצווה</h1>
          <p className="mt-1 text-sm text-white/75">גיל עברי, תאריך לועזי ופרשת השבוע</p>
        </div>

        <CardContent className="space-y-5 p-5 sm:p-7">
          <div className="grid grid-cols-2 rounded-xl bg-gray-100 p-1">
            {['bar', 'bat'].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => { setType(option); setResult(null); }}
                className={`min-h-11 rounded-lg text-sm font-semibold transition-colors ${type === option ? 'bg-white text-red-900 shadow-sm' : 'text-gray-500'}`}
              >
                {option === 'bar' ? 'בר מצווה' : 'בת מצווה'}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="birth-date" className="text-sm font-semibold text-gray-700">תאריך לידה לועזי</Label>
            <Input id="birth-date" type="date" value={birthDate} onChange={(event) => { setBirthDate(event.target.value); setResult(null); }} className="h-12 text-base" />
          </div>

          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/60 px-3 text-sm text-gray-700">
            <Checkbox checked={isAfterSunset} onCheckedChange={setIsAfterSunset} />
            <span>הלידה הייתה אחרי השקיעה</span>
          </label>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p>}

          <Button onClick={handleCalculate} className="h-12 w-full bg-red-800 text-base hover:bg-red-700">
            <Sparkles className="ml-2 h-5 w-5" />חשב תאריך {title}
          </Button>

          {result && (
            <div className="space-y-3 border-t border-gray-100 pt-5">
              <div className="rounded-xl bg-gray-50 p-3 text-center">
                <p className="text-xs font-medium text-gray-500">תאריך הלידה העברי</p>
                <p className="mt-1 font-semibold text-gray-800">{result.birthHebrewDate}</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-gradient-to-l from-amber-50 to-white p-5 text-center shadow-sm">
                <Crown className="mx-auto h-5 w-5 text-amber-600" />
                <p className="mt-2 text-xs font-semibold text-amber-800">תאריך ה{title} העברי</p>
                <p className="mt-1 text-xl font-bold text-red-900">{result.barMitzvahHebrewDate}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-gray-50 p-3 text-center">
                  <p className="text-xs text-gray-500">תאריך לועזי</p>
                  <p className="mt-1 text-sm font-bold text-gray-800">{result.barMitzvahGregorianDate.toLocaleDateString('he-IL')}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3 text-center">
                  <p className="text-xs text-gray-500">פרשת השבוע</p>
                  <p className="mt-1 text-sm font-bold text-gray-800">{result.parashatHashavua}</p>
                </div>
              </div>
              {user?.role === 'admin' && (
                <Button variant="outline" onClick={goToCalendar} className="h-11 w-full border-red-200 text-red-800 hover:bg-red-50">
                  <CalendarDays className="ml-2 h-4 w-4" />מעבר ללוח השנה
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}