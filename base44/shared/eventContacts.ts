export function formatEventContacts(eventObj) {
  if (!eventObj) return '';

  const parseArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const contacts = [];
  const seen = new Set();

  const addContact = (contact, fallbackName) => {
    if (!contact || typeof contact !== 'object') return;

    const rawName = String(contact.name || contact.full_name || contact.contact_name || '').trim();
    const role = String(contact.role || contact.title || contact.description || '').trim();
    const phone = String(contact.phone || contact.mobile || contact.telephone || '').trim();
    const email = String(contact.email || contact.mail || '').trim();

    if (!rawName && !role && !phone && !email) return;

    const name = rawName || fallbackName || 'איש קשר';
    const key = `${name}|${phone}|${email}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const title = [name, role].filter(Boolean).join(' - ');
    const details = [];
    if (phone) details.push(`טלפון: ${phone}`);
    if (email) details.push(`מייל: ${email}`);

    contacts.push(details.length ? `• ${title}: ${details.join(' | ')}` : `• ${title}`);
  };

  parseArray(eventObj.parents).forEach(contact => addContact(contact, 'איש קשר'));
  parseArray(eventObj.organizer_contacts || eventObj.organizercontacts).forEach(contact => addContact(contact, 'איש קשר'));

  return contacts.join('\n');
}