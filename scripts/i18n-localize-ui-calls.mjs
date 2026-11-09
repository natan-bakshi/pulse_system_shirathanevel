import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {interfaceLabels} from '../src/i18n/dictionary.js';
const require=createRequire(import.meta.url),parser=require('@babel/parser'),walk=require('@babel/traverse').default;
const apply=process.argv.includes('--apply');
const calls=new Set([
 'alert','window.alert','confirm','window.confirm',
 'toast','toast.error','toast.success','toast.warning','toast.info','toast.message',
 'setError','setEnglishError','setMessage','setFeedback','setSuccess'
]);
const files=[];
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())scan(f);else if(/\.(jsx|tsx)$/.test(f))files.push(f);}}
scan('src/components');scan('src/pages');
function owner(p){
 for(let par=p.parentPath;par;par=par.parentPath){
  if(par.isFunctionDeclaration()&&/^[A-Z]/.test(par.node.id?.name||'')&&par.node.body?.type==='BlockStatement')return par;
  if(par.isArrowFunctionExpression()||par.isFunctionExpression()){
   let holder=par.parentPath;
   while(holder&&(holder.isCallExpression()||holder.isMemberExpression()||holder.isTSAsExpression()))holder=holder.parentPath;
   if(holder?.isVariableDeclarator()&&/^[A-Z]/.test(holder.node.id?.name||'')&&par.node.body.type==='BlockStatement')return par;
  }
 }
 return null;
}
let modified=0,localized=0,skipped=0;
for(const file of files){
 const src=fs.readFileSync(file,'utf8');
 let ast;try{ast=parser.parse(src,{sourceType:'module',plugins:['jsx','typescript']});}catch(e){throw Error(file+': '+e.message);}
 const edits=[],owners=new Map();
 walk(ast,{CallExpression(p){
  const call=p.node,key=src.slice(call.callee.start,call.callee.end);
  if(!calls.has(key))return;
  const arg=call.arguments[0];
  if(arg?.type!=='StringLiteral'||!/[א-ת]/.test(arg.value)||!Object.hasOwn(interfaceLabels,arg.value))return;
  const fn=owner(p);
  if(!fn){skipped++;return}
  owners.set(fn.node.start,fn);
  edits.push({start:arg.start,end:arg.end,replacement:'uiTranslate('+JSON.stringify(arg.value)+')'});
 }});
 if(!edits.length)continue;
 const hasImport=ast.program.body.some(n=>n.type==='ImportDeclaration'&&n.source.value==='@/i18n/LanguageProvider');
 if(!hasImport){
  const last=ast.program.body.filter(n=>n.type==='ImportDeclaration').at(-1);
  if(!last)throw Error('No import to insert before '+file);
  edits.push({start:last.end,end:last.end,replacement:"\nimport {useLanguage} from '@/i18n/LanguageProvider';"});
 }
 for(const fn of owners.values()){
  const body=fn.node.body;
  if(!src.slice(body.start,body.end).includes('const {t: uiTranslate}=useLanguage();'))
   edits.push({start:body.start+1,end:body.start+1,replacement:"\n  const {t: uiTranslate}=useLanguage();"});
 }
 let code=src;
 for(const e of edits.sort((a,b)=>b.start-a.start||b.end-a.end))code=code.slice(0,e.start)+e.replacement+code.slice(e.end);
 try{parser.parse(code,{sourceType:'module',plugins:['jsx','typescript']})}catch(e){throw Error(file+': '+e.message);}
 if(apply)fs.writeFileSync(file,code);
 modified++;localized+=edits.filter(x=>x.replacement.startsWith('uiTranslate(')).length;
}
console.log(JSON.stringify({apply,modifiedFiles:modified,localizedCalls:localized,skipped}));
