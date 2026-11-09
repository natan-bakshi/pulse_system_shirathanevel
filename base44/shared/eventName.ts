function parseCustomFields(customFields: unknown): Record<string, unknown> {
  if (!customFields) return {};
  if (typeof customFields === 'string') {
    try {
      const parsed = JSON.parse(customFields);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof customFields === 'object' && !Array.isArray(customFields) ? customFields as Record<string, unknown> : {};
}

function normalizeFieldKey(key: string): string {
  return String(key || '').replace(/[\s_\-–—:]+/g, '').toLowerCase();
}

export function getCustomEventNameFromFields(customFields: unknown): string {
  const fields = parseCustomFields(customFields);
  const entries = Object.entries(fields);

  const preferred = entries.find(([key, value]) => {
    const normalized = normalizeFieldKey(key);
    return value && (
      normalized.startsWith('שםהאירוע') ||
      normalized.startsWith('שמהאירוע') ||
      normalized.includes('eventname') ||
      normalized.includes('eventtitle')
    );
  });

  return String(preferred?.[1] || '').trim();
}

/**
 * English event heading shared by regular/manual quotations and PDF filenames.
 * A child's given name and the family name form one natural personal name:
 * "Bar Mitzvah for David Cohen", never "David — Cohen".
 */
export function getEnglishQuoteEventTitle(event: any): string {
  const eventType = ({
    bar_mitzvah: 'Bar Mitzvah',
    bat_mitzvah: 'Bat Mitzvah',
    wedding: 'Wedding',
    other: 'Event'
  } as Record<string,string>)[event?.event_type] || 'Event';
  const child = String(event?.child_name || '').trim();
  const displayName = getEventDisplayName(event);
  return [eventType, child ? 'for ' + child : '', displayName].filter(Boolean).join(' ').trim();
}

export function getEventDisplayName(event: any): string {
  const familyName = String(event?.family_name || '').trim();
  const eventName = String(event?.event_name || '').trim();
  const customEventName = getCustomEventNameFromFields(event?.custom_organizer_fields);
  return familyName || eventName || customEventName || 'אירוע ללא שם';
}