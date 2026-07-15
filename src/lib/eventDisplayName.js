export function getEventDisplayName(event) {
  const familyName = String(event?.family_name || '').trim();
  const eventName = String(event?.event_name || '').trim();
  return familyName || eventName || 'אירוע ללא שם';
}

export function getEventTitle(event) {
  const eventName = String(event?.event_name || '').trim();
  const displayName = getEventDisplayName(event);
  if (!eventName || eventName === displayName) return displayName;
  return `${eventName} - ${displayName}`;
}