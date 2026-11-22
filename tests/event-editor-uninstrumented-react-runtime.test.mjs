import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import esbuild from 'esbuild';
import {JSDOM} from 'jsdom';

// Browserbase's browser-test helper injects bb-customSelect wrappers and
// relocates Radix's native SELECT. This test deliberately uses an unmodified
// DOM, catching real React mount regressions without that outside mutation.
const entry=[
  "import React from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {MemoryRouter} from 'react-router-dom';",
  "import {QueryClient,QueryClientProvider} from '@tanstack/react-query';",
  "import EventForm from './src/components/events/EventForm.jsx';",
  "import {LanguageProvider} from './src/i18n/LanguageProvider.jsx';",
  "const client=new QueryClient({defaultOptions:{queries:{retry:false}}});",
  "createRoot(document.getElementById('root')).render(",
  " <MemoryRouter><QueryClientProvider client={client}><LanguageProvider>",
  " <EventForm isOpen={true} event={null} onClose={()=>{}} onSave={()=>{}} />",
  " </LanguageProvider></QueryClientProvider></MemoryRouter>);"
].join('\n');

const apiMock=[
  "const noWrite=async()=>{throw Error('Unexpected API write during render')};",
  "const empty={list:async()=>[],filter:async()=>[],create:noWrite,update:noWrite,delete:noWrite};",
  "const organizer={id:'test-type',type_name:'Family',is_default:true,is_active:true,event_fields:null,contacts_config:'{}'};",
  "const entities=new Proxy({QuoteOrganizerType:{list:async()=>[organizer]}},{get:(target,name)=>target[name]||empty});",
  "export const base44={entities,auth:{me:async()=>({id:'test-user',role:'admin'}),updateMe:noWrite},agents:{getWhatsAppConnectURL:()=>''}};"
].join('\n');
const entitiesMock=[
  "const noWrite=async()=>{throw Error('Unexpected API write during render')};",
  "const empty={list:async()=>[],filter:async()=>[],create:noWrite,update:noWrite,delete:noWrite};",
  "export const Service=empty, Supplier=empty, Package=empty, Payment=empty, AppSettings=empty;",
  "export const EventService=empty, Event=empty, QuoteTemplate=empty;"
].join('\n');
const statusMock="export async function refreshEventStatus(){throw Error('Status update during render')}";
const stubs={api:apiMock,entities:entitiesMock,status:statusMock};

test('real event editor mounts with one Radix dialog and an independent customer message selector',async()=>{
  const compiled=await esbuild.build({
    stdin:{contents:entry,sourcefile:path.resolve('event-editor-qa.jsx'),
      resolveDir:process.cwd(),loader:'jsx'},
    bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',
    loader:{'.css':'empty','.svg':'dataurl','.png':'dataurl','.jpg':'dataurl'},
    plugins:[{name:'local-qa-entities',setup(build){
      build.onResolve({filter:/^@\//},async args=>{
        if(args.path==='@/api/base44Client')return {path:'api',namespace:'qa'};
        if(args.path.startsWith('@/entities/'))return {path:'entities',namespace:'qa'};
        if(args.path==='@/lib/eventStatus')return {path:'status',namespace:'qa'};
        return build.resolve(path.resolve('src',args.path.slice(2)),
          {resolveDir:process.cwd(),kind:args.kind});
      });
      build.onLoad({filter:/./,namespace:'qa'},args=>
        ({contents:stubs[args.path],loader:'js'}));
    }}]
  });
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    {url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.PointerEvent=w.MouseEvent;
  w.Element.prototype.scrollIntoView=()=>{};
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},
    addEventListener(){},removeEventListener(){}});
  w.fetch=()=>{throw Error('Unexpected outbound fetch during render')};
  const errors=[];
  w.addEventListener('error',e=>errors.push(String(e.error?.message||e.message)));
  try{
    w.eval(compiled.outputFiles[0].text);
    await new Promise(resolve=>setTimeout(resolve,900));
    assert.deepEqual(errors,[],'React render should have no runtime exceptions');
    assert.equal(w.document.querySelectorAll('[role="dialog"]').length,1);
    assert.match(w.document.body.textContent,/שפת הודעות ללקוח/);
    assert.match(w.document.body.textContent,/יצירת אירוע חדש/);
    assert.equal(w.document.querySelectorAll('.bb-customSelect').length,0,
      'No automation-injected select DOM should exist in a normal runtime');
  }finally{
    dom.window.close();
  }
});
