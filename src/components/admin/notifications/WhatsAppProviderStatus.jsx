import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';

// Explicit admin action only: no polling, no messages, no credential exposure.
export default function WhatsAppProviderStatus() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function check() {
    setBusy(true); setError('');
    try {
      const result = await base44.functions.invoke('WhatsApp_ProviderStatus', {});
      if (!result.data?.success) throw new Error('לא ניתן לבדוק את מצב הספק');
      setStatus(result.data);
    } catch (_) {
      setError('בדיקת החיבור נכשלה. ודא שהפונקציה פורסמה ושהנך מנהל.');
    } finally { setBusy(false); }
  }
  const names = {
    connected: 'מחובר', connecting: 'בתהליך התחברות', need_scan: 'ממתין לסריקת QR',
    disconnected: 'מנותק', logged_out: 'נותק מהחשבון', expired: 'פג תוקף',
    need_passkey: 'נדרש אישור קישור', not_configured: 'לא הוגדר מפתח',
    error: 'שגיאה בבדיקת הספק', unknown: 'מצב לא ידוע'
  };
  return (
    <details className="rounded-lg border border-gray-200 bg-white p-3 text-sm" dir="rtl">
      <summary className="cursor-pointer font-semibold">מצב ספק WhatsApp וגיבוי WasenderAPI</summary>
      <div className="mt-3 space-y-2">
        <p className="text-gray-600">Green API הוא הספק הראשי עד לבחירה מפורשת אחרת. בדיקה זו אינה שולחת הודעות.</p>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={check}>{busy ? 'בודק...' : 'בדוק חיבור ספק'}</Button>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {status && (
          <div className="space-y-1 rounded border bg-gray-50 p-3">
            <p>הספק הפעיל: <strong>{status.activeProvider === 'wasender' ? 'WasenderAPI' : 'Green API'}</strong></p>
            <p>Green API: {status.greenConfigured ? 'פרטי החיבור מוגדרים' : 'פרטי החיבור חסרים'}</p>
            <p>WasenderAPI: {status.wasender?.configured ? 'מפתח מוגדר' : 'מפתח חסר'}</p>
            <p>חיבור WasenderAPI: <strong>{names[status.wasender?.status] || 'מצב לא ידוע'}</strong></p>
            {status.wasender?.errorCode && <p>קוד שגיאה: {status.wasender.errorCode}</p>}
          </div>
        )}
        <p className="text-gray-600">לחיבור גיבוי: הוסף את מפתח הסשן ב־Base44 Secrets תחת WASENDER_API_KEY. אין להזין מפתחות בתבניות, ב־GitHub או בצ'אט. המעבר לספק החלופי נעשה במשתנה המאובטח WHATSAPP_ACTIVE_PROVIDER=wasender לאחר בדיקת החיבור.</p>
        <p className="text-amber-700">שים לב: בתקופת ניסיון WasenderAPI מגבילה שליחה להודעה אחת בדקה ועד 50 הודעות ביום. אל תעביר את כל התראות Pulse לספק החלופי לפני בדיקת עומס או שדרוג מסלול.</p>
      </div>
    </details>
  );
}
