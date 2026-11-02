import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);

// Real Radix + react-remove-scroll + React portal event handlers. Unlike
// static CSS tests this dispatches cancelable DOM wheel and touch events;
// the regression originally prevented BOTH and left the scrollbar visible.
// jsdom does not lay out pixels or emulate native finger inertia, so a
// real phone check is still needed for final acceptance.
test('nested event editor dialog permits wheel and touch scroll without unlocking background',async()=>{
 const {JSDOM}=require('jsdom');
 const esbuild=require('esbuild');
 const app=process.cwd();
 const file=path.join(app,'node_modules','.cache','pulse-tests','dialog-scroll-runtime.cjs');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 esbuild.buildSync({
  entryPoints:[path.join(app,'src','components','ui','dialog.jsx')],
  outfile:file,
  bundle:true,
  format:'cjs',
  platform:'node',
  target:'node20',
  external:['react','react-dom','react/jsx-runtime','react-dom/client'],
  alias:{'@':path.join(app,'src')},
  logLevel:'silent'
 });

 const dom=new JSDOM('<html><body><div id="app-root"></div></body></html>',{
  url:'https://test.pulse.local',pretendToBeVisual:true
 });
 const globals=[
  'window','document','navigator','HTMLElement','Element','Node',
  'ShadowRoot','MutationObserver','getComputedStyle','requestAnimationFrame',
  'cancelAnimationFrame','Event','CustomEvent','MouseEvent','KeyboardEvent',
  'DOMRect','EventTarget','NodeFilter','HTMLInputElement','HTMLButtonElement',
  'HTMLSelectElement','HTMLTextAreaElement','SVGElement'
 ];
 for(const key of globals)Object.defineProperty(globalThis,key,{
  value:dom.window[key],configurable:true,writable:true
 });
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 if(!globalThis.PointerEvent)globalThis.PointerEvent=dom.window.MouseEvent;
 if(!HTMLElement.prototype.scrollIntoView)
  HTMLElement.prototype.scrollIntoView=function(){};
 if(!HTMLElement.prototype.hasPointerCapture)
  HTMLElement.prototype.hasPointerCapture=function(){return false;};
 if(!HTMLElement.prototype.setPointerCapture)
  HTMLElement.prototype.setPointerCapture=function(){};
 if(!HTMLElement.prototype.releasePointerCapture)
  HTMLElement.prototype.releasePointerCapture=function(){};

 const React=require('react');
 const {createRoot}=require('react-dom/client');
 const D=require(file),h=React.createElement;
 const root=createRoot(document.getElementById('app-root'));
 let wheelCalls=0,touchCalls=0;
 const render=(innerOpen=true)=>h(D.Dialog,{open:true,onOpenChange:()=>{}},
  h(D.DialogContent,{'data-test':'event-form',style:{height:260,overflowY:'auto'},
    'aria-describedby':undefined},
   h(D.DialogTitle,null,'Event editor'),
   h(D.Dialog,{open:innerOpen,onOpenChange:()=>{}},
    h(D.DialogContent,{'data-test':'package-services','aria-describedby':undefined,
      onWheel:()=>{wheelCalls++;},onTouchMove:()=>{touchCalls++;}},
     h(D.DialogTitle,null,'Add service to package'),
     h('div',{'data-test':'scroll-list',
       style:{height:120,overflowY:'auto',overscrollBehaviorY:'contain'}},
      Array.from({length:85},(_,i)=>h('div',{key:i},'Service '+i)))))));

 const dispatchWheel=target=>{
  const event=new dom.window.WheelEvent('wheel',{
   bubbles:true,cancelable:true,deltaY:120
  });
  return {allowed:target.dispatchEvent(event),prevented:event.defaultPrevented};
 };
 const dispatchTouch=target=>{
  const start=new dom.window.Event('touchstart',{bubbles:true,cancelable:true});
  Object.defineProperty(start,'changedTouches',{
   value:[{clientX:30,clientY:85}]
  });
  Object.defineProperty(start,'touches',{
   value:[{clientX:30,clientY:85}]
  });
  target.dispatchEvent(start);
  const move=new dom.window.Event('touchmove',{bubbles:true,cancelable:true});
  Object.defineProperty(move,'changedTouches',{
   value:[{clientX:30,clientY:40}]
  });
  Object.defineProperty(move,'touches',{
   value:[{clientX:30,clientY:40}]
  });
  return {allowed:target.dispatchEvent(move),prevented:move.defaultPrevented};
 };

 try{
  await React.act(async()=>{
   root.render(render(true));
   await new Promise(resolve=>setTimeout(resolve,40));
  });
  assert.equal(document.querySelectorAll('[role=dialog]').length,2);
  const list=document.querySelector('[data-test=scroll-list]');
  assert.ok(list,'inner service list exists');

  let reachedDocument=0;
  document.addEventListener('wheel',()=>{reachedDocument++;});
  // A nested portalled dialog MUST intercept the bubbling event before the
  // *outer* react-remove-scroll document listener cancels the native scroll.
  assert.deepEqual(dispatchWheel(list),{allowed:true,prevented:false});
  assert.deepEqual(dispatchTouch(list),{allowed:true,prevented:false});
  assert.equal(reachedDocument,0);
  assert.equal(wheelCalls,1,'consumer wheel callbacks still run');
  assert.equal(touchCalls,1,'consumer touch callbacks still run');

  // The fix must NOT disable the lock around the rest of the site.
  assert.deepEqual(dispatchWheel(document.getElementById('app-root')),
   {allowed:false,prevented:true});
  // With inner open, the parent editor is intentionally locked.
  const outer=document.querySelector('[data-test=event-form]');
  assert.deepEqual(dispatchWheel(outer),{allowed:false,prevented:true});

  // Closing the inner dialog restores access to the outer editor's scroll.
  await React.act(async()=>{
   root.render(render(false));
   await new Promise(resolve=>setTimeout(resolve,40));
  });
  assert.equal(document.querySelectorAll('[role=dialog]').length,1);
  assert.deepEqual(dispatchWheel(document.getElementById('app-root')),
   {allowed:false,prevented:true});
  // Closing the entire editor releases the background scroll lock, too.
  await React.act(async()=>{
   root.render(null);
   await new Promise(resolve=>setTimeout(resolve,40));
  });
  assert.deepEqual(dispatchWheel(document.getElementById('app-root')),
   {allowed:true,prevented:false});
 }finally{
  await React.act(async()=>{root.unmount();});
  // Radix schedules focus/scroll cleanup as microtasks; preserve jsdom's
  // Event globals until its isolated node:test worker process exits.
  await new Promise(resolve=>setTimeout(resolve,80));
 }
});
