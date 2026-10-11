import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle, MessageCircle, RefreshCw, Save } from 'lucide-react';

const names = {
  connected: 'מחובר', connecting: 'בתהליך התחברות', need_scan: 'ממתין לסריקת QR',
  disconnected: 'מנותק', logged_out: 'נותק מהחשבון', expired: 'פג תוקף',
  need_passkey: 'נדרש אישור קישור', not_configured: 'לא הוגדר מפתח',
  error: 'שגיאה בבדיקת הספק', unknown: 'מצב לא ידוע'
};
const titleFor = provider => provider === 'wasender' ? 'WasenderAPI' : 'Green API';

// Used only in the protected system settings page. Switching requires explicit save,
// and the server independently verifies authorization, credentials and session status.
export default function WhatsAppProviderStatus() {
  const [status, setStatus] = useState(null);
  const [choice, setChoice] = useState('green');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    base44.functions.invoke('WhatsApp_ProviderConfig', { action: 'get' })
      .then(response => {
        if (!active) return;
        const data = response.data;
        if (!data?.success) throw new Error('Cannot read provider');
        setStatus(data);
        setChoice(data.provider);
      })
      .catch(() => { if (active) setError('לא ניתן לקרוא את בחירת הספק. ודא שהפונקציה פורסמה ושיש לך הרשאת מנהל מערכת.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function check() {
    setChecking(true); setError(''); setNotice('');
    try {
      const response = await base44.functions.invoke('WhatsApp_ProviderConfig', { action: 'check' });
      if (!response.data?.success) throw new Error('Provider status unavailable');
      setStatus(response.data);
      setNotice('בדיקת התקשורת הסתיימה. היא אינה שולחת הודעות WhatsApp.');
    } catch (_) {
      setError('בדיקת ספק ה־WhatsApp נכשלה. בדוק שהמפתח קיים ושיש תקשורת לספק.');
    } finally { setChecking(false); }
  }

  async function save() {
    if (!status || choice === status.provider) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await base44.functions.invoke('WhatsApp_ProviderConfig', { action: 'set', provider: choice });
      const data = response.data;
      if (!data?.success || data.provider !== choice) {
        const message = data?.error === 'WASENDER_API_KEY is not configured in Secrets'
          ? 'לא נמצא מפתח WASENDER_API_KEY ב־Base44 Secrets.'
          : data?.connectionStatus
            ? `אי אפשר לעבור ל־WasenderAPI: מצב הסשן הוא ${names[data.connectionStatus] || data.connectionStatus}.`
            : 'בחירת הספק לא נשמרה. ודא שהחיבור של הספק החדש פעיל.';
        throw new Error(message);
      }
      setStatus(prev => ({ ...prev, ...data, wasender: prev?.wasender }));
      setNotice(`נשמר: ${titleFor(choice)} הוא כעת ספק WhatsApp ברירת המחדל לכל השליחות החדשות.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שמירת בחירת הספק נכשלה.');
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4" dir="rtl" aria-label="ספק WhatsApp">
      <p className="text-sm text-gray-600">הבחירה כאן משפיעה על שליחת הודעות שיבוץ, התראות, קישורים וחשבוניות — כולל תהליכים אוטומטיים. לא מתבצע מעבר אוטומטי בעקבות כשל, כדי למנוע הודעות כפולות.</p>
      <div className="space-y-2 max-w-sm">
        <Label htmlFor="whatsapp-default-provider">ספק WhatsApp ברירת המחדל</Label>
        <Select value={choice} onValueChange={value => { setChoice(value); setError(''); setNotice(''); }} disabled={loading || busy}>
          <SelectTrigger id="whatsapp-default-provider"><SelectValue placeholder={loading ? 'טוען...' : 'בחר ספק'} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="green">Green API</SelectItem>
            <SelectItem value="wasender">WasenderAPI</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500">{status ? `פעיל כרגע: ${titleFor(status.provider)}` : 'אין עדיין מידע על הספק הפעיל.'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={loading || busy || checking || !status || choice === status.provider} size="sm">
          <Save className="h-4 w-4 ml-2" />{busy ? 'שומר...' : 'שמור ספק ברירת מחדל'}
        </Button>
        <Button type="button" onClick={check} variant="outline" size="sm" disabled={loading || busy || checking}>
          <RefreshCw className="h-4 w-4 ml-2" />{checking ? 'בודק...' : 'בדוק חיבור'}
        </Button>
      </div>
      {error && <p role="alert" className="flex items-start gap-2 text-sm text-red-700"><AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 text-sm text-green-700"><CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />{notice}</p>}
      {status && (
        <div className="rounded-lg border bg-gray-50 p-3 text-sm space-y-1">
          <p><MessageCircle className="inline h-4 w-4 ml-1" />Green API: {status.greenConfigured ? 'מפתחות מוגדרים' : 'מפתחות חסרים'}</p>
          <p>WasenderAPI: {status.wasenderConfigured ? 'מפתח סשן הוגדר' : 'מפתח סשן חסר'}</p>
          {status.wasender && <p>מצב הסשן ב־WasenderAPI: <strong>{names[status.wasender.status] || status.wasender.status}</strong></p>}
          {!status.wasenderConfigured && <p className="text-amber-700">יש להדביק את מפתח הסשן ב־Base44 Secrets בשם WASENDER_API_KEY. אין להכניס מפתחות ל־GitHub או לצ'אט.</p>}
        </div>
      )}
      <p className="text-xs text-amber-700">בתקופת הניסיון של WasenderAPI עשויה להיות מגבלת שליחה של הודעה אחת לדקה ועד 50 הודעות ליום. אין לבצע שליחה המונית ללא בדיקת המכסה.</p>
      <p className="text-xs text-gray-500">בחירת הספק נשמרת כאן מיד בלחיצה על ״שמור ספק ברירת מחדל״ — אין צורך בלחצן השמירה הכללי. שינוי הספק אינו שולח מחדש הודעות שכבר נכשלו ואינו מנתק מכשירים.</p>
    </section>
  );
}
