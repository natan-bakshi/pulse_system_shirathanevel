import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {translateLabel} from '../src/i18n/dictionary.js';
const require=createRequire(import.meta.url);
const parser=require('@babel/parser');
const traverse=require('@babel/traverse').default;
const files=[];
function visit(dir){
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  const filename=path.join(dir,item.name);
  if(item.isDirectory())visit(filename);
  else if(/\.(jsx|tsx)$/.test(filename))files.push(filename);
 }
}
visit('src');

test('every fixed label passed to t or uiTranslate anywhere in JSX has a real English translation',()=>{
 const missing=[];
 for(const filename of files){
  const parsed=parser.parse(fs.readFileSync(filename,'utf8'),{
   sourceType:'module',plugins:['jsx','typescript']
  });
  traverse(parsed,{CallExpression(p){
   const callee=p.node.callee;
   if(callee.type!=='Identifier'||!['t','uiTranslate'].includes(callee.name))return;
   const arg=p.node.arguments[0];
   if(arg?.type!=='StringLiteral'||!/[\u0590-\u05ff]/.test(arg.value))return;
   const english=translateLabel(arg.value,'en');
   if(english===arg.value||/[\u0590-\u05ff]/.test(english))
    missing.push(filename+':'+arg.loc.start.line+' '+arg.value.slice(0,90));
  }});
 }
 assert.deepEqual(missing,[]);
 assert.ok(files.length>=250);
});

test('event communication selector stays independent and event form respects RTL and LTR',()=>{
 const code=fs.readFileSync('src/components/events/EventForm.jsx','utf8');
 assert.match(code,/const \{t: uiTranslate,dir\}=useLanguage\(\)/);
 assert.match(code,/<DialogContent dir=\{dir\}/);
 assert.match(code,/client_notice_language: event\?\.client_notice_language === "en"/);
 assert.match(code,/client_notice_language: "he"/);
 assert.match(code,/onValueChange=\{v=>setFormData\(prev=>\(\{\.\.\.prev,client_notice_language/);
 assert.doesNotMatch(code,/client_notice_language.*(?:document_language|quote_language)/);
});
