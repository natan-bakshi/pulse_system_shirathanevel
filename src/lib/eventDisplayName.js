export function getEventDisplayName(event) {
  const eventName = String(event?.event_name || '').trim();
  const familyName = String(event?.family_name || '').trim();
  return eventName || familyName || 'אירוע ללא שם';
}

export function getEventTitle(event) {
  return getEventDisplayName(event);
}