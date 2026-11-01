import React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Contact, FileUser } from 'lucide-react';
import { toast } from 'sonner';
import {
  CONTACT_FIELDS,
  usableContactFields,
  selectDeviceContact,
  parseVCardContact,
} from '@/lib/contactPickerUtils';

// Used by every contact-import button throughout the app (suppliers, events,
// transport pickup contacts, settings). Only the selected contact is read.
export default function ContactPicker({ onContactSelect, className = 'ml-2', disabled = false }) {
  const [availableFields, setAvailableFields] = React.useState(CONTACT_FIELDS);
  const [showFallback, setShowFallback] = React.useState(false);
  const [fallbackReason, setFallbackReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const fileInputRef = React.useRef(null);
  const pickingRef = React.useRef(false);

  // Query supported fields beforehand, not between the click and select():
  // browsers may reject a native picker once transient user activation is lost.
  React.useEffect(() => {
    const api = typeof navigator !== 'undefined' ? navigator.contacts : null;
    if (typeof api?.getProperties !== 'function') return;
    let active = true;
    Promise.resolve()
      .then(() => api.getProperties())
      .then(fields => {
        if (active) setAvailableFields(usableContactFields(fields));
      })
      .catch(error => console.warn('Could not detect supported contact fields:', error));
    return () => { active = false; };
  }, []);

  const openFallback = (reason) => {
    setFallbackReason(reason);
    setShowFallback(true);
  };

  const handlePickContact = async () => {
    if (disabled || pickingRef.current) return;
    const api = typeof navigator !== 'undefined' ? navigator.contacts : null;
    if (typeof api?.select !== 'function' || availableFields.length === 0) {
      openFallback('הדפדפן הזה אינו מאפשר בחירה ישירה מאנשי הקשר.');
      return;
    }

    pickingRef.current = true;
    setBusy(true);
    try {
      const contact = await selectDeviceContact(api, availableFields);
      if (!contact) return; // User closed the native picker without selecting.
      onContactSelect(contact);
      setShowFallback(false);
      toast.success('פרטי איש הקשר הועתקו לשדות');
    } catch (error) {
      if (error?.name === 'AbortError') return; // Explicit user cancellation.
      console.error('Failed to import selected phone contact:', error);
      openFallback(error?.name === 'SecurityError' || error?.name === 'NotAllowedError'
        ? 'הגישה לאנשי הקשר נחסמה על ידי הדפדפן או הרשאות המכשיר.'
        : 'הבחירה הישירה לא החזירה פרטי איש קשר שניתן לקרוא.');
      toast.error('לא ניתן לייבא את איש הקשר ישירות. אפשר לייבא כרטיס איש קשר.');
    } finally {
      pickingRef.current = false;
      setBusy(false);
    }
  };

  const handleVCardFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // Allow choosing the same file again after an error.
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error('קובץ איש הקשר גדול מדי. יש לייצא איש קשר בודד.');
      return;
    }
    setBusy(true);
    try {
      const contact = parseVCardContact(await file.text());
      onContactSelect(contact);
      setShowFallback(false);
      toast.success('פרטי איש הקשר הועתקו לשדות');
    } catch (error) {
      console.error('Could not import vCard file:', error);
      toast.error('לא הצלחנו לקרוא את הקובץ. יש לבחור קובץ איש קשר מסוג VCF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={showFallback} onOpenChange={setShowFallback}>
      <PopoverAnchor asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handlePickContact}
          disabled={disabled || busy}
          aria-label="בחר איש קשר מהטלפון"
          aria-expanded={showFallback}
          title="בחר מאנשי קשר"
          className={className}
        >
          <Contact className="h-4 w-4" />
        </Button>
      </PopoverAnchor>
      <PopoverContent align="end" side="bottom" dir="rtl" className="z-[100] w-72 space-y-3 text-right">
        <p className="text-sm font-medium">ייבוא איש קשר מהטלפון</p>
        <p className="text-xs text-gray-600">
          {fallbackReason} אפשר לפתוח את אנשי הקשר בטלפון, לבחור ״שיתוף איש קשר״,
          לשמור כקובץ VCF ולייבא אותו לכאן. אפשר גם להקליד את הפרטים ידנית.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".vcf,text/vcard,text/x-vcard"
          className="hidden"
          aria-label="ייבוא קובץ איש קשר"
          onChange={handleVCardFile}
          disabled={disabled || busy}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          disabled={disabled || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUser className="h-4 w-4 ml-2" />
          בחר קובץ איש קשר (VCF)
        </Button>
      </PopoverContent>
    </Popover>
  );
}
