import path from 'node:path';
import esbuild from 'esbuild';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
w.requestAnimationFrame=w.requestAnimationFrame||((f)=>setTimeout(f,16));
w.cancelAnimationFrame=w.cancelAnimationFrame||clearTimeout;
w.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
w.IntersectionObserver=class{observe(){} unobserve(){} disconnect(){}};
w.PointerEvent=w.MouseEvent;
w.Element.prototype.scrollIntoView=()=>{};
w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
const files={'@/api/base44Client':'tests/.tmp-runtime-api.js','@/lib/eventStatus':'tests/.tmp-runtime-status.js'};
const out=await esbuild.build({entryPoints:['tests/.tmp-runtime-entry.jsx'],bundle:true,platform:'browser',format:'iife',write:false,logLevel:'warning',loader:{'.css':'empty','.svg':'dataurl','.png':'dataurl','.jpg':'dataurl'},plugins:[{name:'qa-mock',setup(b){
 b.onResolve({filter:/^@\//},async args=>{
  const name=args.path;
  const candidate=name.startsWith('@/entities/')?'tests/.tmp-runtime-entities.js':(files[name]||path.join('src',name.slice(2)));
  return await b.resolve(path.resolve(candidate),{resolveDir:process.cwd(),kind:args.kind});
 });
}}]});
const errors=[];w.addEventListener('error',e=>errors.push(e.error?.stack?.slice(0,600)||e.message||'unknown'));
w.eval(out.outputFiles[0].text);
await new Promise(r=>setTimeout(r,2500));
console.log('BODY_LENGTH',w.document.body.textContent.length);
console.log('HAS_FORM_TITLE',w.document.body.textContent.includes('יצירת אירוע חדש'));
console.log('HAS_LANGUAGE',w.document.body.textContent.includes('שפת הודעות ללקוח'));
console.log('DIALOGS',w.document.querySelectorAll('[role=dialog]').length);
console.log('ERRORS',JSON.stringify(errors.slice(0,4)));
dom.window.close();
