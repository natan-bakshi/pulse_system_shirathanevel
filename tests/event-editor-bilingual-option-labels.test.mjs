import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EVENT_TYPE_OPTIONS, makeSystemField, displayEventOptionLabel
} from '../src/lib/eventFields.js';
import {translateLabel} from '../src/i18n/dictionary.js';

const forLocale = locale => value => translateLabel(value,locale);

test('built-in event types display in the selected interface language without changing stored values',()=>{
  const field=makeSystemField('event_type');
  for(const option of EVENT_TYPE_OPTIONS){
    assert.equal(displayEventOptionLabel(field,option,forLocale('he')),option.label);
    const english=displayEventOptionLabel(field,option,forLocale('en'));
    assert.equal(english,translateLabel(option.label,'en'));
    assert.doesNotMatch(english,/[\u0590-\u05ff]/u);
    assert.match(option.value,/^[a-z_]+$/);
  }
});

test('currency dropdown translates its label, never the stored currency code or symbol',()=>{
  const field=makeSystemField('primary_currency');
  assert.deepEqual(field.options.map(item=>item.value),['ILS','USD']);
  for(const option of field.options){
    assert.equal(displayEventOptionLabel(field,option,forLocale('he')),option.label);
    assert.equal(displayEventOptionLabel(field,option,forLocale('en')),translateLabel(option.label,'en'));
    assert.doesNotMatch(displayEventOptionLabel(field,option,forLocale('en')),/[֐-׿]/u);
  }
});

test('custom organizer dropdown labels remain literal even when a translation key happens to match',()=>{
  const custom={id:'custom-event-type',source:'custom',type:'select',name:'Custom choice'};
  assert.equal(displayEventOptionLabel(custom,'בר מצווה',forLocale('en')),'בר מצווה');
  assert.equal(displayEventOptionLabel(custom,{value:'v',label:'משפחה'},forLocale('en')),'משפחה');
  assert.equal(displayEventOptionLabel({...makeSystemField('event_type'),source:'custom'},'בר מצווה',forLocale('en')),'בר מצווה');
});

test('event editor and organizer controls wire localized display only, not business field values',()=>{
  const form=fs.readFileSync('src/components/events/EventForm.jsx','utf8');
  const input=fs.readFileSync('src/components/events/EventFieldInput.jsx','utf8');
  const organizer=fs.readFileSync('src/components/quotes/OrganizerTypeSelector.jsx','utf8');
  const contacts=fs.readFileSync('src/components/events/OrganizerContactsSection.jsx','utf8');
  assert.match(input,/displayEventOptionLabel\(field,o,uiTranslate\)/);
  assert.match(form,/uiTranslate\(getField\(organizerEventFields, "schedule"\)\?\.name/);
  assert.match(organizer,/<DialogContent dir=\{dir\}/);
  assert.match(organizer,/value=\{type\.type_name\}/);
  assert.match(organizer,/\['משפחה','מוסד \/ ארגון'\]\.includes\(type\.type_name\)/);
  assert.match(contacts,/standardLabels\.has\(label\)/);
  assert.match(contacts,/custom_field_labels:.*extra\.name/);
  assert.equal(translateLabel('מוסד / ארגון','en'),'Institution / Organization');
});
