import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {interfaceLabels} from '../src/i18n/dictionary.js';
const require=createRequire(import.meta.url);
const parser=require('@babel/parser');
const traverse=require('@babel/traverse').default;
const apply=process.argv.includes('--apply');
const paths=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const allowedAttr=new Set(['placeholder','title','aria-label','alt']);
const files=[];
function scan(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){
 const full=path.join(dir,f.name);
 if(f.isDirectory()&&!full.includes('node_modules'))scan(full);
 else if(/\.(jsx|tsx)$/.test(f.name))files.push(full);
}}
if(paths.length)for(const f of paths)if(fs.statSync(f).isDirectory())scan(f);else files.push(f);
else {scan('src/pages');scan('src/components');}
function owner(p){
 let cur=p.parentPath;
 while(cur){
  if(cur.isFunctionDeclaration()&&/^[A-Z]/.test(cur.node.id?.name||'')&&cur.node.body?.type==='BlockStatement')return cur;
  if(cur.isArrowFunctionExpression()||cur.isFunctionExpression()){
    const n=cur.node;
    let holder=cur.parentPath;
    while(holder && (holder.isCallExpression() || holder.isMemberExpression() || holder.isTSAsExpression()))holder=holder.parentPath;
    if(holder?.isVariableDeclarator()&&/^[A-Z]/.test(holder.node.id?.name||'')&&n.body?.type==='BlockStatement')return cur;
  }
  cur=cur.parentPath;
 }
 return null;
}
let all=0,modified=0,skipped=0;
const stats=[];
for(const file of [...new Set(files)]){
 const source=fs.readFileSync(file,'utf8');
 let ast;try{ast=parser.parse(source,{sourceType:'module',plugins:['jsx','typescript']});}catch(e){stats.push(file+' PARSE_ERROR '+e.message);continue}
 const edits=[],components=new Map();let missed=0,jsxCount=0,attrCount=0;
 const process=(p,start,end,replacement)=>{
  const fn=owner(p);
  if(!fn){missed++;return}
  if(!components.has(fn.node.start))components.set(fn.node.start,fn);
  edits.push({start,end,replacement});
 };
 traverse(ast,{
 JSXText(p){
  const fragment=source.slice(p.node.start,p.node.end);
  const key=fragment.replace(/\s+/g,' ').trim();
  if(!/[\u0590-\u05ff]/.test(key)||!Object.hasOwn(interfaceLabels,key))return;
  const lead=fragment.match(/^\s*/)?.[0]||'';
  const tail=fragment.match(/\s*$/)?.[0]||'';
  process(p,p.node.start,p.node.end,lead+'{uiTranslate('+JSON.stringify(key)+')}'+tail);
  jsxCount++;
 },
 JSXAttribute(p){
  const a=p.node;
  if(!allowedAttr.has(a.name?.name)||a.value?.type!=='StringLiteral')return;
  const key=a.value.value;
  if(!/[\u0590-\u05ff]/.test(key)||!Object.hasOwn(interfaceLabels,key))return;
  process(p,a.value.start,a.value.end,'{uiTranslate('+JSON.stringify(key)+')}');
  attrCount++;
 }
 });
 if(!edits.length){if(missed)stats.push(file+' SKIPPED_NO_OWNER '+missed);skipped+=missed;continue}
 const originalImports=[...ast.program.body.filter(n=>n.type==='ImportDeclaration')];
 const importExists=source.includes("import {useLanguage} from '@/i18n/LanguageProvider'")||source.includes('import { useLanguage } from "@/i18n/LanguageProvider"');
 const importsSrc=source.match(/import[\s\S]*?from\s*['"]@\/i18n\/LanguageProvider['"]/);
 const hasImport=!!importsSrc;
 if(!hasImport){
   const spot=originalImports.at(-1)?.end;
   if(spot==null)throw Error('No import to insert before '+file);
   edits.push({start:spot,end:spot,replacement:"\nimport {useLanguage} from '@/i18n/LanguageProvider';"});
 }
 for(const fn of components.values()){
  const body=fn.node.body;
  if(body.type!=='BlockStatement')throw Error('Unexpected implicit component '+file);
  // Local alias avoids collisions with map callback parameters named "t".
  const initial=source.slice(body.start,body.end);
  if(initial.includes('const {t: uiTranslate}=useLanguage();'))continue;
  edits.push({start:body.start+1,end:body.start+1,replacement:"\n  const {t: uiTranslate}=useLanguage();"});
 }
 edits.sort((a,b)=>b.start-a.start||b.end-a.end);
 let output=source;
 for(const e of edits)output=output.slice(0,e.start)+e.replacement+output.slice(e.end);
 try{parser.parse(output,{sourceType:'module',plugins:['jsx','typescript']})}catch(e){throw Error(file+': '+e.message);}
 if(apply)fs.writeFileSync(file,output);
 all+=edits.length-components.size-(hasImport?0:1);modified++;skipped+=missed;
 stats.push(file+' JSX='+jsxCount+' ATTR='+attrCount+' COMPONENTS='+components.size+' SKIPPED='+missed);
}
console.log(JSON.stringify({apply,filesProcessed:files.length,modified,localized:all,skippedWithoutOwner:skipped}));
console.log(stats.filter(x=>x.includes('SKIPPED=')&&!x.endsWith('SKIPPED=0')).slice(0,50).join('\n'));
