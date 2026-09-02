// רשימת אנשי הקשר של האירוע (הורים + אנשי הקשר של המזמין) לשימוש בבחירת נמענים.
const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export function getEventContactList(event) {
  if (!event) return [];
  const contacts = [];
  const seen = new Set();

  [...parseArray(event.parents), ...parseArray(event.organizer_contacts)].forEach((contact) => {
    if (!contact || typeof contact !== 'object') return;
    const name = String(contact.name || contact.full_name || '').trim();
    const phone = String(contact.phone || contact.mobile || '').trim();
    const email = String(contact.email || contact.mail || '').trim();
    if (!phone && !email) return;
    const key = `${phone}|${email}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push({ name: name || 'איש קשר', phone, email });
  });

  return contacts;
}