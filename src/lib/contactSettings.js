export const DEFAULT_CONTACT_ACTIONS = {
  show_phone: true,
  allow_phone_copy: true,
  allow_phone_call: true,
  allow_phone_whatsapp: true,
  show_email: true,
  allow_email_copy: true,
  allow_email_send: true,
};

export function parseContactSettings(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeContact).filter(contact => contact.name || contact.phone || contact.email);
  } catch {
    return [];
  }
}

export function normalizeContact(contact = {}) {
  return {
    id: contact.id || `contact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: contact.name || '',
    role: contact.role || '',
    phone: contact.phone || '',
    email: contact.email || '',
    ...DEFAULT_CONTACT_ACTIONS,
    ...Object.fromEntries(
      Object.keys(DEFAULT_CONTACT_ACTIONS).map(key => [key, contact[key] !== false])
    ),
  };
}

export function stringifyContactSettings(contacts) {
  return JSON.stringify((contacts || []).map(normalizeContact));
}

export function getPhoneDigits(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

export function getTelLink(phone) {
  return `tel:${String(phone || '').replace(/\s/g, '')}`;
}

export function getWhatsAppLink(phone) {
  const digits = getPhoneDigits(phone);
  if (!digits) return '#';
  const normalized = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  return `https://wa.me/${normalized}`;
}