// Shared, local-only helpers for importing one selected phone contact.
// The app never uploads or reads the whole address book.
export const CONTACT_FIELDS = ['name', 'tel', 'email'];

export function usableContactFields(supported) {
  if (!Array.isArray(supported)) return [...CONTACT_FIELDS];
  return CONTACT_FIELDS.filter(field => supported.includes(field));
}

function firstText(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstText(item);
      if (text) return text;
    }
  }
  if (value && typeof value === 'object') {
    return firstText(value.value) || firstText(value.text);
  }
  return '';
}

export function normalizeContactPhone(value) {
  const phone = firstText(value).replace(/[^\d+]/g, '');
  if (!phone) return '';
  if (phone.startsWith('+972')) return '0' + phone.slice(4).replace(/^0/, '');
  if (phone.startsWith('972')) return '0' + phone.slice(3).replace(/^0/, '');
  return phone;
}

export function normalizePhoneContact(contact) {
  if (!contact || typeof contact !== 'object') return { name: '', phone: '', email: '' };
  return {
    name: firstText(contact.name),
    phone: normalizeContactPhone(contact.tel ?? contact.phone),
    email: firstText(contact.email),
  };
}

function hasContactDetails(contact) {
  return Boolean(contact.name || contact.phone || contact.email);
}

export async function selectDeviceContact(contactApi, supportedFields = CONTACT_FIELDS) {
  if (!contactApi || typeof contactApi.select !== 'function') {
    throw Object.assign(new Error('Contact Picker API is unavailable'), { name: 'NotSupportedError' });
  }
  const fields = usableContactFields(supportedFields);
  if (!fields.length) {
    throw Object.assign(new Error('No supported contact fields'), { name: 'NotSupportedError' });
  }
  // Call select() directly from the user's click. No async permission probe here:
  // awaiting before select() can lose transient user activation on mobile browsers.
  const chosen = await contactApi.select(fields, { multiple: false });
  if (!chosen || (Array.isArray(chosen) && chosen.length === 0)) return null;
  const contact = normalizePhoneContact(Array.isArray(chosen) ? chosen[0] : chosen);
  if (!hasContactDetails(contact)) {
    throw Object.assign(new Error('Selected contact has no readable details'), { name: 'EmptyContactError' });
  }
  return contact;
}

function unescapeVCard(value) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;:\\])/g, '$1')
    .trim();
}

export function parseVCardContact(text) {
  if (typeof text !== 'string') throw new Error('Invalid vCard');
  // Unfold vCard 2.1/3.0/4.0 continued lines. No HTML or external lookups.
  const unfolded = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
  const card = /BEGIN:VCARD\s*\n([\s\S]*?)\nEND:VCARD/i.exec(unfolded);
  if (!card) throw new Error('Missing vCard');
  const values = { FN: '', N: '', TEL: '', EMAIL: '' };
  for (const line of card[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(';')[0].split('.').pop().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const value = unescapeVCard(line.slice(colon + 1));
    if (value && !values[key]) values[key] = value;
  }
  const nameParts = values.N.split(';');
  const fallbackName = [nameParts[1], nameParts[0]].filter(Boolean).join(' ').trim();
  const contact = {
    name: values.FN || fallbackName,
    phone: normalizeContactPhone(values.TEL),
    email: values.EMAIL,
  };
  if (!hasContactDetails(contact)) throw new Error('Empty vCard contact');
  return contact;
}
