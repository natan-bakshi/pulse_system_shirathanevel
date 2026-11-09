import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {interfaceLabels} from '../src/i18n/dictionary.js';
const require=createRequire(import.meta.url);
const parser=require('@babel/parser'),traverse=require('@babel/traverse').default;
function files(root){let result=[];for(const e of fs.readdirSync(root,{withFileTypes:true})){
 const f=path.join(root,e.name);
 if(e.isDirectory())result.push(...files(f));else if(/\.(jsx|tsx)$/.test(f))result.push(f);
}return result;}
const jsxFiles=files('src');
const parse=f=>parser.parse(fs.readFileSync(f,'utf8'),{sourceType:'module',plugins:['jsx','typescript']});
const jsxAttrPresentation=new Set(['label','placeholder','title','aria-label','alt','tooltip']);

test('Every curated English interface string is nonempty and contains no Hebrew',()=>{
 const keys=Object.entries(interfaceLabels);
 assert.ok(keys.length>=2400,'Expected extensive reviewed fixed-label coverage');
 for(const [key,value] of keys){
  assert.ok(key.trim()&&String(value).trim(),'Empty translation entry');
  assert.doesNotMatch(value,/[\u0590-\u05ff]/,'Hebrew remains in the target of '+key);
 }
});

test('No unlocalized fixed JSX copy or presentation attributes outside binding legal contract',()=>{
 const issues=[];
 for(const file of jsxFiles){
  if(file.endsWith('/legal/TermsPopup.jsx'))continue;
  traverse(parse(file),{
   JSXText(p){
    const text=p.node.value.replace(/\s+/g,' ').trim();
    if(!/[\u0590-\u05ff]/.test(text))return;
    if(file.endsWith('/quotes/OrganizerTypeEditor.jsx')&&
      (text==='[שם_שדה]'||text==='((טקסט עם [משתנה]))'))return;
    if(file.endsWith('/i18n/LanguageSwitch.jsx')&&text==='עברית')return;
    issues.push(file+':'+p.node.loc.start.line+' '+text.slice(0,100));
   },
   JSXAttribute(p){
    const attr=p.node, value=attr.value;
    if(!jsxAttrPresentation.has(attr.name?.name)||value?.type!=='StringLiteral'||
      !/[\u0590-\u05ff]/.test(value.value))return;
    issues.push(file+':'+p.node.loc.start.line+' '+attr.name.name+' '+value.value.slice(0,100));
   }
  });
 }
 assert.deepEqual(issues,[],'All fixed JSX strings should be localized');
});

test('No direct unlocalized alerts, confirmation dialogs or toasts remain',()=>{
 const errors=[];
 for(const file of jsxFiles){
  const src=fs.readFileSync(file,'utf8');
  traverse(parse(file),{CallExpression(p){
   const name=src.slice(p.node.callee.start,p.node.callee.end);
   if(!/^(?:alert|confirm|window\.(?:alert|confirm)|toast(?:\.(?:error|success|warning|info|message))?)$/.test(name))return;
   const arg=p.node.arguments[0];
   if(arg?.type==='StringLiteral'&&/[\u0590-\u05ff]/.test(arg.value))
    errors.push(file+':'+arg.loc.start.line+' '+arg.value);
  }});
 }
 assert.deepEqual(errors,[]);
});

test('Original contract, privacy and disclaimer HTML is byte-for-byte identical',()=>{
 const file='src/components/legal/TermsPopup.jsx';
 const raw=fs.readFileSync(file,'utf8');
 const hashes={
  'terms-content':'d2a0486dc4e0339695e8015039bba39f34b063b29a6d637421da37f09fc8132f',
  'privacy-content':'1cf0acff5c2685e75e9576c477c7334dc88b0e9875c736c53d4a02b50fb01452',
  'disclaimer-content':'43446d538c052a67bea64d55d4f1d700c8bbc26201f0020c83802a3442cb865b'
 };
 const found=new Set();
 traverse(parse(file),{JSXElement(p){
  const id=p.node.openingElement.attributes.find(a=>a.name?.name==='id')?.value?.value;
  if(!Object.hasOwn(hashes,id))return;
  found.add(id);
  const actual=crypto.createHash('sha256').update(raw.slice(p.node.start,p.node.end)).digest('hex');
  assert.equal(actual,hashes[id],'Binding legal source changed: '+id);
 }});
 assert.deepEqual(found,new Set(Object.keys(hashes)));
 assert.match(raw,/createAgreementHtml/);
 assert.match(raw,/calculateHash\(agreementHtml\)/);
 assert.match(raw,/הנוסח המשפטי המחייב מוצג בעברית בלבד/);
});

test('Quote language is independent of interface language in mobile native sharing',()=>{
 const source=fs.readFileSync('src/components/event-details/useQuoteShare.jsx','utf8');
 assert.match(source,/title: quoteLanguage==='en'\?'Quotation':'הצעת מחיר'/);
 assert.match(source,/preparationRevision.current\+=1/);
 assert.match(source,/revision!==preparationRevision.current/);
});

test('UI localization scripts never translate stored identifiers and protect document-language context',()=>{
 const src=fs.readFileSync('scripts/i18n-localize-jsx.mjs','utf8');
 assert.match(src,/const allowedAttr=new Set\(\['placeholder','title','aria-label','alt','tooltip','label'\]\)/);
 assert.doesNotMatch(src,/allowedAttr=new Set\([^)]*'value'/);
 const expr=fs.readFileSync('scripts/i18n-localize-ui-expressions.mjs','utf8');
 assert.match(expr,/documentLanguage\|isHebrew/);
 assert.match(expr,/exclude=new Set/);
});
