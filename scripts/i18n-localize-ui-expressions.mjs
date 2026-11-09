import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {interfaceLabels} from '../src/i18n/dictionary.js';
const require=createRequire(import.meta.url);
const parser=require('@babel/parser'),traverse=require('@babel/traverse').default;
const apply=process.argv.includes('--apply');
const targets=[
 'src/components/admin',
 'src/components/assignments',
 'src/components/event-details',
 'src/components/events',
 'src/components/quotes',
 'src/components/tasks',
 'src/components/suppliers',
 'src/components/pwa',
 'src/components/notifications',
 'src/components/export',
 'src/components/calendar',
 'src/components/manualQuote',
 'src/components/billing',
 'src/pages'
];
const exclude=new Set([
 'src/components/billing/ClosingIntroduction.jsx',
 'src/components/billing/ClosingStatus.jsx',
 'src/components/billing/AgreementView.jsx',
 'src/components/billing/CurrentPaymentSchedule.jsx',
 'src/components/billing/ClosingLanguageFields.jsx',
 'src/pages/EventClosing.jsx',
 'src/pages/ModularQuoteView.jsx',
 'src/components/event-details/EventQuoteEnglishDialog.jsx',
 'src/components/modularQuote/QuoteDetails.jsx',
]);
const files=[];
function walkFiles(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walkFiles(f);else if(/\.(jsx|tsx)$/.test(f)&&!exclude.has(f))files.push(f);}}
for(const dir of targets)walkFiles(dir);
function findOwner(path){
 for(let p=path.parentPath;p;p=p.parentPath){
  if(p.isFunctionDeclaration()&&/^[A-Z]/.test(p.node.id?.name||'')&&p.node.body?.type==='BlockStatement')return p;
  if(p.isArrowFunctionExpression()||p.isFunctionExpression()){
   let holder=p.parentPath;
   while(holder&&(holder.isCallExpression()||holder.isMemberExpression()||holder.isTSAsExpression()))holder=holder.parentPath;
   if(holder?.isVariableDeclarator()&&/^[A-Z]/.test(holder.node.id?.name||'')&&p.node.body.type==='BlockStatement')return p;
  }
 }return null;
}
let changedFiles=0,total=0,blocked=0;
for(const file of files){
 const src=fs.readFileSync(file,'utf8');
 let ast;
 try{ast=parser.parse(src,{sourceType:'module',plugins:['jsx','typescript']});}catch(e){throw Error(file+': '+e.message);}
 const edits=[],owners=new Map();
 function add(p,node){
  if(!node||node.type!=='StringLiteral'||!/[א-ת]/.test(node.value)||!Object.hasOwn(interfaceLabels,node.value))return;
  const fn=findOwner(p);
  if(!fn){blocked++;return;}
  owners.set(fn.node.start,fn);
  edits.push({start:node.start,end:node.end,text:'uiTranslate('+JSON.stringify(node.value)+')'});
 }
 traverse(ast,{JSXExpressionContainer(p){
  if(!p.parentPath?.isJSXElement()&&!p.parentPath?.isJSXFragment())return;
  const e=p.node.expression;
  if(e?.type==='StringLiteral')add(p,e);
  else if(e?.type==='ConditionalExpression'){
   const test=src.slice(e.test.start,e.test.end);
   // A document-language choice is not a UI locale choice.
   if(/\b(english|isEnglish|locale|language|documentLanguage|isHebrew|formLanguage|quoteLanguage)\b/i.test(test))return;
   add(p,e.consequent);add(p,e.alternate);
  }
 }});
 if(!edits.length)continue;
 const hasImport=ast.program.body.some(n=>n.type==='ImportDeclaration'&&n.source.value==='@/i18n/LanguageProvider');
 if(!hasImport){
  const last=ast.program.body.filter(n=>n.type==='ImportDeclaration').at(-1);
  if(!last)throw Error('No imports '+file);
  edits.push({start:last.end,end:last.end,text:"\nimport {useLanguage} from '@/i18n/LanguageProvider';"});
 }
 for(const owner of owners.values()){
  const body=owner.node.body;
  if(!src.slice(body.start,body.end).includes('const {t: uiTranslate}=useLanguage();'))
   edits.push({start:body.start+1,end:body.start+1,text:"\n  const {t: uiTranslate}=useLanguage();"});
 }
 edits.sort((a,b)=>b.start-a.start||b.end-a.end);
 let output=src;
 for(const e of edits)output=output.slice(0,e.start)+e.text+output.slice(e.end);
 try{parser.parse(output,{sourceType:'module',plugins:['jsx','typescript']});}catch(e){throw Error(file+': '+e.message);}
 if(apply)fs.writeFileSync(file,output);
 total+=edits.filter(x=>x.text.startsWith('uiTranslate(')).length;
 changedFiles++;
}
console.log(JSON.stringify({apply,filesScanned:files.length,changedFiles,translatedVisibleExpressionLiterals:total,skippedUnknownOwner:blocked}));
