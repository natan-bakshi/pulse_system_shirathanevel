import React from 'react';
import { Button } from '@/components/ui/button';
import { Contact, FileUser } from 'lucide-react';
import { toast } from 'sonner';
import {
  CONTACT_FIELDS,
  usableContactFields,
  selectDeviceContact,
  parseVCardContact,
} from '@/lib/contactPickerUtils';
import {useLanguage} from '@/i18n/LanguageProvider';

// A single contact-import path shared by supplier forms, event contacts and
// pickup-point contacts. The selected data is processed only in the browser.
export default function ContactPicker({
  onContactSelect,
  onImportStatus,
  className = 'ml-2',
  disabled = false,
}) {
  const {t: uiTranslate}=useLanguage();
  const contactApi = typeof navigator !== 'undefined' ? navigator.contacts : null;
  const nativeSupported = typeof contactApi?.select === 'function';
  const [availableFields, setAvailableFields] = React.useState(CONTACT_FIELDS);
  const [fallbackVisible, setFallbackVisible] = React.useState(!nativeSupported);
  const [busy, setBusy] = React.useState(false);
  const fileInputRef = React.useRef(null);
  const pickingRef = React.useRef(false);

  const report = (kind, message) => {
    onImportStatus?.({ kind, message });
    if (kind === 'success') toast.success(message);
    else if (kind === 'error') toast.error(message);
    else toast.info(message);
  };

  React.useEffect(() => {
    const pickerApi = typeof navigator !== 'undefined' ? navigator.contacts : null;
    if (typeof pickerApi?.getProperties !== 'function') return;
    let active = true;
    Promise.resolve()
      .then(() => pickerApi.getProperties())
      .then(properties => {
        if (active) setAvailableFields(usableContactFields(properties));
      })
      .catch(error => console.warn('Could not check contact fields; native picker will be tried:', error));
    return () => { active = false; };
  }, []);

  const handlePickContact = async () => {
    if (disabled || pickingRef.current) return;
    if (!nativeSupported || availableFields.length === 0) {
      setFallbackVisible(true);
      report('error', 'הדפדפן אינו מאפשר גישה ישירה לאנשי קשר. השתמש בכפתור קובץ איש הקשר (VCF) שלידו.');
      return;
    }
    pickingRef.current = true;
    setBusy(true);
    try {
      // Invoke the native picker first, before any UI state reporting; it must
      // retain the browser's transient user activation on Android Chrome.
      // Explicit checkbox selection on Android avoids ambiguous single-tap flows
      // that may finish with an empty result after the contact detail is viewed.
      const selectionPromise = selectDeviceContact(contactApi, availableFields, { multiple: true });
      report('info', 'פותח בחירת איש קשר…');
      const selected = await selectionPromise;
      if (!selected) {
        setFallbackVisible(true);
        report('error', 'הטלפון לא העביר איש קשר. נסה שוב: סמן ✓ ליד איש קשר אחד ברשימה ואז לחץ אישור או שיתוף. אם עדיין לא עובד, אפשר לייבא קובץ VCF.');
        return;
      }
      onContactSelect(selected);
      report('success', 'פרטי איש הקשר הועתקו לשדות. ניתן לבדוק אותם לפני שמירה.');
      setFallbackVisible(false);
    } catch (error) {
      console.error('Failed to import phone contact:', error?.name, error?.message);
      if (error?.name === 'AbortError') {
        report('info', 'בחירת איש הקשר בוטלה, ולא שונו שדות.');
      } else if (error?.name === 'MultipleContactsError') {
        report('error', 'סומנו כמה אנשי קשר. נסה שוב וסמן ✓ ליד איש קשר אחד בלבד, ואז לחץ אישור.');
      } else {
        setFallbackVisible(true);
        report('error', error?.name === 'SecurityError' || error?.name === 'NotAllowedError'
          ? 'הדפדפן חסם את בחירת איש הקשר. אפשר לייבא קובץ VCF בכפתור שליד.'
          : 'לא התקבלו פרטים שניתן למלא. אפשר לייבא קובץ VCF בכפתור שליד.');
      }
    } finally {
      pickingRef.current = false;
      setBusy(false);
    }
  };

  const handleVCardFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // Allow retrying the same contact file.
    if (!file) return;
    if (file.size > 512 * 1024) {
      report('error', 'קובץ איש הקשר גדול מדי. יש לייצא איש קשר בודד.');
      return;
    }
    setBusy(true);
    try {
      const contact = parseVCardContact(await file.text());
      onContactSelect(contact);
      report('success', 'פרטי איש הקשר יובאו לשדות מקובץ VCF.');
    } catch (error) {
      console.error('Failed to import vCard contact:', error?.name, error?.message);
      report('error', 'לא הצלחנו לקרוא את הקובץ. יש לבחור קובץ איש קשר מסוג VCF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handlePickContact}
        disabled={disabled || busy}
        aria-label="בחר איש קשר מהטלפון באמצעות סימון ואישור"
        title={nativeSupported ? 'בחר איש קשר אחד, סמן ✓ ליד שמו ולחץ אישור' : 'בדפדפן זה יש לייבא קובץ איש קשר'}
        className={className}
      >
        <Contact className="h-4 w-4" />
      </Button>
      {fallbackVisible && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || busy}
          aria-label="ייבא כרטיס איש קשר מקובץ VCF"
          title="ייבוא כרטיס איש קשר (VCF) — שיתוף איש קשר מהטלפון ושמירה לקבצים"
          className="shrink-0 px-2"
        >
          <FileUser className="h-4 w-4" />
          <span className="sr-only">{uiTranslate("ייבוא קובץ VCF")}</span>
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".vcf,text/vcard,text/x-vcard"
        className="sr-only"
        tabIndex={-1}
        aria-label="בחר קובץ איש קשר VCF"
        onChange={handleVCardFile}
        disabled={disabled || busy}
      />
    </span>
  );
}
