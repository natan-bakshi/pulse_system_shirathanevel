import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTACT_FIELDS,
  normalizePhoneContact,
  normalizeContactPhone,
  usableContactFields,
  parseVCardContact,
  selectDeviceContact,
} from '../src/lib/contactPickerUtils.js';

test('native picker starts without awaiting permissions and requests only allowed fields', async () => {
  let selected = false;
  const contactApi = {
    select(fields, options) {
      selected = true;
      assert.deepEqual(fields, ['name', 'tel']);
      assert.deepEqual(options, { multiple: false });
      return Promise.resolve([{
        name: ['משה כהן'],
        tel: ['+972 52-123-4567'],
      }]);
    }
  };
  const promise = selectDeviceContact(contactApi, ['name', 'tel']);
  assert.equal(selected, true);
  assert.deepEqual(await promise, { name: 'משה כהן', phone: '0521234567', email: '' });
});

test('cancel does not populate data; missing and empty contact throw actionable errors', async () => {
  assert.equal(await selectDeviceContact({ select: async () => [] }), null);
  assert.equal(await selectDeviceContact({ select: async () => null }), null);
  await assert.rejects(selectDeviceContact({ select: async () => [{ name: [], tel: [], email: [] }] }), { name: 'EmptyContactError' });
  await assert.rejects(selectDeviceContact(undefined), { name: 'NotSupportedError' });
  await assert.rejects(selectDeviceContact({ select: async () => [{}] }, []), { name: 'NotSupportedError' });
});

test('accepts string, array and object-valued contact details', () => {
  assert.deepEqual(normalizePhoneContact({
    name: '  גל שרון ',
    tel: [{ value: '+1 (212) 555-0123' }],
    email: [{ value: ' gal@example.com ' }]
  }), { name: 'גל שרון', phone: '+12125550123', email: 'gal@example.com' });
  assert.equal(normalizeContactPhone('972-54-001-0203'), '0540010203');
  assert.equal(normalizeContactPhone('+972 (0)54 001 0203'), '0540010203');
  assert.deepEqual(usableContactFields(['email', 'address', 'name']), ['name', 'email']);
  assert.deepEqual(CONTACT_FIELDS, ['name', 'tel', 'email']);
});

test('imports standard iPhone/Android vCards locally, unfolding long lines', () => {
  assert.deepEqual(parseVCardContact(
    'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:יונתן כהן\r\nTEL;TYPE=CELL:+972-50-111-2233\r\nEMAIL;TYPE=INTERNET:example@\r\n gmail.com\r\nEND:VCARD'
  ), { name: 'יונתן כהן', phone: '0501112233', email: 'example@gmail.com' });
  assert.deepEqual(parseVCardContact(
    'BEGIN:VCARD\nVERSION:4.0\nN:Levi;Or;;;\nTEL;VALUE=uri:tel:+972-54-555-1111\nEND:VCARD'
  ), { name: 'Or Levi', phone: '0545551111', email: '' });
});

test('rejects invalid or empty vCard', () => {
  assert.throws(() => parseVCardContact('not a contact'), /Missing vCard/);
  assert.throws(() => parseVCardContact('BEGIN:VCARD\nVERSION:3.0\nEND:VCARD'), /Empty vCard contact/);
  assert.throws(() => parseVCardContact(null), /Invalid vCard/);
});

test('shared picker is used across supplier, event, transport and settings entry points', () => {
  const importer = readFileSync('src/components/ui/ContactPicker.jsx', 'utf8');
  for (const marker of ['selectDeviceContact', 'parseVCardContact', 'onContactSelect(contact)', 'setFallbackVisible(true)', "toast.error("]) {
    assert.ok(importer.includes(marker), marker);
  }
  const consumers = [
    'src/pages/SupplierManagement.jsx',
    'src/components/assignments/SupplierAssignmentDialog.jsx',
    'src/components/events/EventsBoard.jsx',
    'src/components/events/EventServicesManager.jsx',
    'src/components/events/OrganizerContactsSection.jsx',
    'src/components/event-details/ServicesCard.jsx',
    'src/components/contact/ContactSettingsEditor.jsx',
  ];
  for (const file of consumers) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /<ContactPicker\b/, file + ' must retain shared importer');
  }
});

test('contact picker shows fallback inside dialog tree, not in an inaccessible popover portal', () => {
  const picker = readFileSync('src/components/ui/ContactPicker.jsx', 'utf8');
  assert.doesNotMatch(picker, /<Popover|PopoverContent|PopoverAnchor/, 'fallback must stay clickable in Radix dialogs');
  assert.match(picker, /fallbackVisible &&/);
  assert.match(picker, /fileInputRef\.current\?\.click\(\)/);
  assert.match(picker, /בחר קובץ איש קשר VCF/);
  assert.match(picker, /!selected[\s\S]*?setFallbackVisible\(true\)/);
  assert.match(picker, /onImportStatus\?\.\(\{ kind, message \}\)/);
  assert.ok(picker.indexOf('const selectionPromise = selectDeviceContact') < picker.indexOf("report('info', 'פותח בחירת איש קשר"), 'native contact selection happens before feedback code');
});

test('supplier form renders an accessible, persistent import message in the same dialog', () => {
  const supplier = readFileSync('src/pages/SupplierManagement.jsx', 'utf8');
  assert.match(supplier, /onImportStatus=\{setContactImportFeedback\}/);
  assert.match(supplier, /contactImportFeedback\.message/);
  assert.match(supplier, /role=\{contactImportFeedback\.kind === 'error' \? 'alert' : 'status'\}/);
  assert.match(supplier, /setContactImportFeedback\(null\)/);
});
