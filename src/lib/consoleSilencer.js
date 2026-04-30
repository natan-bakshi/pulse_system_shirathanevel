/**
 * Console Silencer
 * 
 * משתיק את לוגי הקונסול בסביבת ייצור (production) כדי למנוע חשיפת מידע רגיש
 * (User IDs, ארכיטקטורה, ספריות בשימוש וכו').
 * 
 * - בפיתוח (localhost / 127.0.0.1): כל הלוגים נשארים פעילים לצורך דיבאג.
 * - בייצור: console.log, console.info, console.debug, console.trace מושתקים.
 * - console.error ו-console.warn נשארים פעילים תמיד כדי לאפשר זיהוי בעיות אמיתיות.
 */

(function silenceConsoleInProduction() {
  if (typeof window === 'undefined' || typeof console === 'undefined') return;

  const hostname = window.location.hostname || '';
  const isDevelopment =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.endsWith('.local');

  if (isDevelopment) return;

  const noop = () => {};
  // משתיקים רק לוגים אינפורמטיביים - שומרים על error/warn לזיהוי בעיות
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.trace = noop;
})();