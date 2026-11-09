import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';

async function load(path,manual=false){
  const built=await build({
    entryPoints:[path],bundle:true,platform:'node',format:'esm',write:false,
    plugins:[{name:'runtime',setup(b){
      b.onResolve({filter:/^npm:@base44\/sdk/},()=>({path:'sdk',namespace:'stub'}));
      b.onResolve({filter:/^npm:sanitize-html/},()=>({path:'sanitize',namespace:'stub'}));
      b.onLoad({filter:/.*/,namespace:'stub'},a=>({
        contents:a.path==='sdk'?'export const createClientFromRequest=()=>({});':
        'export default value=>String(value);'
      }));
      if(manual)b.onLoad({filter:/generateManualQuotePdf\/entry\.ts$/},async a=>({
        contents:(await readFile(a.path,'utf8'))+'\nexport {composeManualQuoteHtml};',
        loader:'ts'
      }));
    }}]
  });
  return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}

const {getEnglishQuoteEventTitle}=await load('base44/shared/eventName.ts');
const {generateQuoteHtml}=await load('base44/shared/quoteHtml.ts');
const {composeManualQuoteHtml}=await load('base44/functions/generateManualQuotePdf/entry.ts',true);

const event={
  id:'name-format-event',
  event_name:'David Celebration',family_name:'Cohen',child_name:'David',
  event_type:'bar_mitzvah',event_date:'2027-06-18',location:'Jerusalem',
  city:'Jerusalem',concept:'',parents:[],schedule:[],guest_count:50,
  all_inclusive:false
};
const client=one=>({asServiceRole:{entities:{
  Event:{get:async()=>one},
  EventService:{filter:async()=>[]},
  Service:{list:async()=>[]},
  Payment:{filter:async()=>[]},
  QuoteTemplate:{list:async()=>[]},
  QuoteOrganizerType:{list:async()=>[]},
  AppSettings:{list:async()=>[{setting_key:'vat_rate',setting_value:'18'}]},
  ContentTranslation:{filter:async()=>[]}
}}});

test('English event heading joins child and family naturally, without any inserted dash',()=>{
  assert.equal(getEnglishQuoteEventTitle(event),'Bar Mitzvah for David Cohen');
  assert.equal(getEnglishQuoteEventTitle({...event,child_name:' David '}),
    'Bar Mitzvah for David Cohen');
  assert.equal(getEnglishQuoteEventTitle({...event,child_name:''}),
    'Bar Mitzvah Cohen');
  assert.equal(getEnglishQuoteEventTitle({...event,event_type:'bat_mitzvah'}),
    'Bat Mitzvah for David Cohen');
  assert.equal(getEnglishQuoteEventTitle({...event,event_type:'wedding'}),
    'Wedding for David Cohen');
});

test('regular English quote heading and PDF filename have no child-family separator',async()=>{
  const c=client(event);
  const en=await generateQuoteHtml(event.id,c,{language:'en',includeSchedule:false});
  assert.ok(en.html.includes('Bar Mitzvah for David Cohen'));
  assert.ok(!en.html.includes('David — Cohen'));
  assert.ok(!en.html.includes('David - Cohen'));
  assert.ok(en.fileAndTitleName.startsWith('Bar Mitzvah for David Cohen '));
  assert.ok(!en.fileAndTitleName.includes(' — '));
  const he=await generateQuoteHtml(event.id,c,{language:'he',includeSchedule:false});
  assert.ok(he.html.includes('בר מצווה של David Cohen'));
  assert.ok(he.fileAndTitleName.startsWith('בר מצווה של David Cohen '));
});

test('manual English event-header and filename use the same unhyphenated full name',async()=>{
  const c=client(event);
  const q={title:'Manual',document_language:'en',linked_event_id:event.id,
    blocks:JSON.stringify([{type:'event_details',options:{showFamilyName:true,showChildName:true}}])};
  const en=await composeManualQuoteHtml(q,c);
  assert.ok(en.html.includes('Bar Mitzvah for David Cohen'));
  assert.ok(!en.html.includes('David — Cohen'));
  assert.ok(!en.fileBaseName.includes(' — '));
  assert.ok(en.fileBaseName.startsWith('Bar Mitzvah for David Cohen '));
  const he=await composeManualQuoteHtml({...q,document_language:'he'},c);
  assert.ok(he.html.includes('בר מצווה של David Cohen'));
  assert.ok(he.fileBaseName.startsWith('בר מצווה של David Cohen '));
});
