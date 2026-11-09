import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const parser=require('@babel/parser');
const walk=require('@babel/traverse').default;
const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>fs.readFileSync(root+path,'utf8');

test('interface language is configured only in My Account, not in dashboard header',()=>{
 const layout=read('src/Layout.jsx'),account=read('src/pages/UserSettings.jsx');
 assert.doesNotMatch(layout, /<LanguageSwitch\b|import LanguageSwitch/);
 assert.match(account, /<LanguageSwitch\s*\/>/);
 assert.match(account,/שפת המערכת/);
});

test('language preference belongs to the authenticated user and never to the quote',()=>{
 const user=JSON.parse(read('base44/entities/User.jsonc'));
 assert.deepEqual(user.properties.preferred_language.enum,['he','en']);
 const selector=read('src/i18n/LanguageSwitch.jsx');
 assert.match(selector,/auth\.updateMe\(\{preferred_language:value\}\)/);
 assert.doesNotMatch(selector, /document_language|quote_language|QuoteTemplate|EventService/);
 const layout=read('src/Layout.jsx');
 assert.match(layout,/preferred_language==='en'\?'en':'he'/);
});

test('key administrator and supplier pages have no unlocalized fixed JSX text',()=>{
 const pages=['ServiceManagement','SupplierManagement','ClientManagement',
   'EventManagement','SettingsPage','SupplierDashboard','MyTasks'];
 for(const name of pages){
  const code=read('src/pages/'+name+'.jsx');
  const ast=parser.parse(code,{sourceType:'module',plugins:['jsx','typescript']});
  const missed=[];
  walk(ast,{JSXText(p){const s=p.node.value.trim();if(/[\u0590-\u05ff]/.test(s))missed.push(s);}});
  assert.deepEqual(missed,[],name+' has unlocalized fixed JSX');
 }
});

test('curated fixed labels are English and do not contain customer data',async()=>{
 const {pageLabels}=await import('../src/i18n/pageLabels.js');
 for(const [source,target] of Object.entries(pageLabels)){
  assert.ok(source.trim(), 'empty source label');
  assert.ok(target.trim(), 'empty translated label');
  assert.doesNotMatch(target,/[\u0590-\u05ff]/,'untranslated label: '+source);
 }
});
