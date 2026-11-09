import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {translateLabel} from '../src/i18n/dictionary.js';

const traverse=traverseModule.default||traverseModule;
const admins=[
 'src/components/billing/ClosingSettings.jsx',
 'src/components/billing/EventClosingPanel.jsx',
 'src/components/billing/MilestoneScheduleEditor.jsx',
 'src/components/billing/ClosingLanguageFields.jsx',
 'src/components/billing/BillingConfiguration.jsx'
];
test('every fixed Hebrew label in the event-closing admin settings has its English UI translation',()=>{
 const missing=[];
 for(const file of admins){
  const ast=parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']});
  traverse(ast,{StringLiteral(path){
   const value=path.node.value;
   if(/[\u0590-\u05ff]/.test(value)&&translateLabel(value,'en')===value)
    missing.push(file+':'+path.node.loc.start.line+': '+value.slice(0,70));
  }});
 }
 assert.deepEqual(missing,[]);
});
test('closing controls follow current UI direction without changing customer-document language',()=>{
 for(const file of admins.slice(0,4)){
  const src=fs.readFileSync(file,'utf8');
  if(file.includes('ClosingLanguageFields'))continue; // each editor textarea has its own document-language direction
  assert.match(src,/dir=\{dir\}/,file+' should respect UI language direction');
  assert.doesNotMatch(src,/<(?:section|fieldset|DialogContent)\b[^>]*\bdir="rtl"/);
 }
 const admin=fs.readFileSync('src/components/billing/EventClosingPanel.jsx','utf8');
 assert.match(admin,/statusLabel\(state,locale\)/);
 assert.match(admin,/quote_summary:next\.quote_summary/);
 assert.match(admin,/bank_details:next\.bank_details/);
 assert.match(admin,/english_missing/);
 const client=fs.readFileSync('src/pages/EventClosing.jsx','utf8');
 assert.match(client,/localizeClosingError/);
 assert.match(client,/opened\.available_languages/);
 assert.match(client,/call\('otp',\{language\}\)/);
});
