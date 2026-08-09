function parseCustomFields(customFields) {
  if (!customFields) return {};
  if (typeof customFields === 'string') {
    try {
      const parsed = JSON.parse(customFields);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof customFields === 'object' && !Array.isArray(customFields) ? customFields : {};
}

function normalizeFieldKey(key) {
  return String(key || '').replace(/[\s_\-–—:]+/g, '').toLowerCase();
}

export function getCustomEventNameFromFields(customFields) {
  const fields = parseCustomFields(customFields);
  const entry = Object.entries(fields).find(([key, value]) => {
    const normalized = normalizeFieldKey(key);
    return value && (
      normalized.startsWith('שםהאירוע') ||
      normalized.startsWith('שמהאירוע') ||
      normalized.includes('eventname') ||
      normalized.includes('eventtitle')
    );
  });

  return String(entry?.[1] || '').trim();
}

export function getEventDisplayName(event) {
  const familyName = String(event?.family_name || '').trim();
  const eventName = String(event?.event_name || '').trim();
  const customEventName = getCustomEventNameFromFields(event?.custom_organizer_fields);
  return familyName || eventName || customEventName || 'אירוע ללא שם';
}

export function getEventTitle(event) {
  return getEventDisplayName(event);
}