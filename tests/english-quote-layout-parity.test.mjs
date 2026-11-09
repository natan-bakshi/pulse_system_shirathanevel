import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';

async function bundle(path,{manual=false}={}) {
  const built=await build({entryPoints:[path],platform:'node',format:'esm',
    bundle:true,write:false,plugins:[{name:'test-adapters',setup(b){
      b.onResolve({filter:/^npm:@base44\/sdk/},()=>({path:'sdk',namespace:'stub'}));
      b.onResolve({filter:/^npm:sanitize-html/},()=>({path:'sanitizer',namespace:'stub'}));
      b.onLoad({filter:/.*/,namespace:'stub'},a=>({
        contents:a.path==='sdk'?'export const createClientFromRequest=()=>({});':
          'export default value=>String(value);'
      }));
      if(manual)b.onLoad({filter:/generateManualQuotePdf\/entry\.ts$/},async a=>({
        contents:(await readFile(a.path,'utf8'))+'\nexport {composeManualQuoteHtml};',
        loader:'ts'
      }));
    }}]});
  return import('data:text/javascript;base64,'+
    Buffer.from(built.outputFiles[0].text).toString('base64'));
}
const {mirrorQuoteHtmlPresentation,mirrorQuoteCssDeclarations}=
  await bundle('base44/shared/quoteLayoutMirror.ts');
const {applyDocumentDirection,translationPreservesProtectedContent,preserveSourceQuoteParagraphPresentation}=await bundle('base44/shared/quoteLocalization.ts');
const {quoteDocumentStyle}=await bundle('base44/shared/quoteDocumentStyle.ts');
const {generateQuoteHtml}=await bundle('base44/shared/quoteHtml.ts');
const {composeModularQuoteHtml}=await bundle('base44/shared/modularQuote.ts');
const {composeManualQuoteHtml}=await bundle('base44/functions/generateManualQuotePdf/entry.ts',{manual:true});
const dom=html=>new JSDOM(html).window.document;
const style=(document,selector)=>document.defaultView.getComputedStyle(document.querySelector(selector));
const row=(source,value,id='intro')=>({id:'translation-'+id,source_entity:'QuoteTemplate',
  source_id:id,locale:'en',status:'approved',fields:{content:{source,value}}});
const client=(event=null,templates=[],translations=[])=>({
  asServiceRole:{entities:{
    AppSettings:{list:async()=>[
      {setting_key:'vat_rate',setting_value:'18'},
      {setting_key:'quote_margin_left_mm',setting_value:'15'},
      {setting_key:'quote_margin_right_mm',setting_value:'25'}]},
    QuoteTemplate:{list:async()=>templates},
    ContentTranslation:{filter:async()=>translations},
    Event:{get:async()=>event},
    EventService:{filter:async()=>[]},
    Service:{list:async()=>[]},
    QuoteOrganizerType:{list:async()=>[]},
    Payment:{filter:async()=>[]}
  }}
});

test('Hebrew quotation presentation is byte-identical; English mirrors right/left only',()=>{
  const source='<!DOCTYPE html><html dir="rtl" lang="he"><head><style>'+
    '.intro-content{text-align:center;font-size:16px;color:#8B0000}'+
    '.date{text-align:left;font-weight:600}'+
    '.section-title{text-align:right;font-weight:700}'+
    '.box{padding-right:15px;margin-left:3px;border-right:2px solid #DAA520}'+
    '.summary-table .label{text-align:right}'+
    '.summary-table .value{text-align:left}</style></head><body>'+
    '<p class="date">תאריך</p>'+ 
    '<table class="summary-table"><tr><td class="label">תיאור</td><td class="value">120</td></tr></table>'+ 
    '<div class="intro-content"><strong>מרכז</strong></div>'+
    '<h2 class="section-title" style="text-align: right; font-weight: bold;">כותרת</h2>'+
    '<p style="text-align: center"><em>ממורכז</em></p>'+
    '<p style="text-align:justify"><u>דו צדדי</u></p>'+
    '<p style="text-align:left" align="left">שמאל</p>'+
    '<p data-text-align="right" style="direction:rtl">ימין</p>'+ 
    '<p class="ql-align-center"><strong>כותרת קוויל</strong></p>'+ 
    '<p class="ql-align-right ql-direction-rtl">קוויל ימני</p>'+ 
    '<p class="ql-align-left">קוויל שמאלי</p>'+ 
    '<a href="https://example.com/?q=left>right" style="margin-right:7px">Link</a>'+
    '<!-- text-align:right must remain an unchanged comment -->'+
    '</body></html>';
  assert.equal(applyDocumentDirection(source,'he'),source);
  const html=applyDocumentDirection(source,'en');
  const d=dom(html);
  assert.equal(d.documentElement.dir,'ltr');
  assert.equal(d.documentElement.lang,'en');
  assert.equal(style(d,'.intro-content').textAlign,'center');
  assert.equal(style(d,'.date').textAlign,'right');
  assert.equal(style(d,'.section-title').textAlign,'left');
  assert.equal(style(d,'.summary-table .label').textAlign,'left'); // selector fixture: template styles
  assert.equal(d.querySelector('.section-title').getAttribute('style').includes('font-weight: bold'),true);
  assert.equal(d.querySelector('strong').outerHTML,'<strong>מרכז</strong>');
  assert.equal(d.querySelector('em').outerHTML,'<em>ממורכז</em>');
  assert.equal(d.querySelector('u').outerHTML,'<u>דו צדדי</u>');
  assert.equal(d.querySelector('p[align]').getAttribute('align'),'right');
  assert.equal(d.querySelector('p[data-text-align]').getAttribute('data-text-align'),'right');
  assert.equal(d.querySelector('p[data-text-align]').getAttribute('style'),'direction:ltr');
  assert.equal(style(d,'.ql-align-center').textAlign,'center');
  assert.equal(style(d,'.ql-align-right').textAlign,'left');
  assert.equal(style(d,'.ql-align-right').direction,'ltr');
  assert.equal(style(d,'.ql-align-left').textAlign,'right');
  assert.equal(d.querySelector('a').getAttribute('href'),'https://example.com/?q=left>right');
  assert.match(html,/margin-left:7px/);
  assert.match(html,/padding-left:15px;margin-right:3px;border-left:2px solid #DAA520/);
  assert.match(html,/text-align: center/);
  assert.match(html,/text-align:justify/);
  assert.match(html,/text-align: left; font-weight: bold/);
  assert.match(html,/<!-- text-align:right must remain an unchanged comment -->/);
  assert.doesNotMatch(html,/\.intro-content\{text-align:left/);
});

test('CSS mirroring changes only physical position and leaves centered typography unchanged',()=>{
  const source='font-weight:700;color:#123456;text-align:center;line-height:1.6;'+
    'padding-left:10px;padding-right:20px;margin-right:5px;'+
    'border-top-left-radius:8px;border-right-color:gold;'+
    'text-align:justify;float:left;clear:right;direction:rtl';
  const result=mirrorQuoteCssDeclarations(source);
  assert.match(result,/font-weight:700;color:#123456;text-align:center;line-height:1\.6/);
  assert.match(result,/padding-right:10px;padding-left:20px;margin-left:5px/);
  assert.match(result,/border-top-right-radius:8px;border-left-color:gold/);
  assert.match(result,/text-align:justify;float:right;clear:left;direction:ltr/);
  assert.equal(mirrorQuoteCssDeclarations('text-align:center'),'text-align:center');
});

test('regular Hebrew and English PDFs use the same centered introduction and bold typography',async()=>{
  const event={id:'event-layout',event_name:'Family',family_name:'Family',
    child_name:'David',event_date:'2027-01-15',event_type:'bar_mitzvah',
    location:'Jerusalem',city:'Jerusalem',concept:'sample',status:'quote',
    all_inclusive:false};
  const source='<p style="text-align: center"><strong>פתיח מרכזי</strong></p>'+
    '<p style="text-align: right"><b>משפט מודגש מימין</b></p>'+
    '<p style="text-align: justify"><em>שורה מיושרת</em></p>';
  const translated='<p style="text-align: center"><strong>Centered Introduction</strong></p>'+
    '<p style="text-align: right"><b>Bold Paragraph on the Right</b></p>'+
    '<p style="text-align: justify"><em>Justified Paragraph</em></p>';
  const template={id:'intro',identifier:'sample',template_type:'concept_intro',content:source};
  const c=client(event,[template],[row(source,translated)]);
  const he=await generateQuoteHtml(event.id,c,{language:'he',includeSchedule:false});
  const en=await generateQuoteHtml(event.id,c,{language:'en',includeSchedule:false});
  const hd=dom(he.html),ed=dom(en.html);
  assert.equal(hd.querySelector('.intro-content').textContent.includes('פתיח'),true);
  assert.equal(ed.querySelector('.intro-content').textContent.includes('Centered'),true);
  assert.equal(style(hd,'.intro-content').textAlign,'center');
  assert.equal(style(ed,'.intro-content').textAlign,'center');
  assert.equal(style(ed,'.event-details-box').textAlign,'center');
  const intro=ed.querySelector('.intro-content');
  assert.equal(intro.querySelectorAll('p').length,3);
  assert.equal(intro.querySelectorAll('strong').length,1);
  assert.equal(intro.querySelectorAll('b').length,1);
  assert.equal(intro.querySelectorAll('em').length,1);
  assert.equal(intro.querySelectorAll('p')[0].style.textAlign,'center');
  assert.equal(intro.querySelectorAll('p')[1].style.textAlign,'left');
  assert.equal(intro.querySelectorAll('p')[2].style.textAlign,'justify');
  assert.equal(style(hd,'.summary-table .label').textAlign,'right');
  assert.equal(style(ed,'.summary-table .label').textAlign,'left');
  assert.equal(style(hd,'.summary-table .value').textAlign,'left');
  assert.equal(style(ed,'.summary-table .value').textAlign,'right');
  assert.ok(en.html.includes('padding-right:15mm'));
  assert.ok(en.html.includes('padding-left:25mm'));
  assert.ok(he.html.includes('padding-left:15mm'));
  assert.ok(he.html.includes('padding-right:25mm'));
  assert.equal(ed.querySelectorAll('.section').length,hd.querySelectorAll('.section').length);
  assert.equal(ed.querySelectorAll('.summary-table tr').length,hd.querySelectorAll('.summary-table tr').length);
});

test('manual headings preserve each original alignment and rich text emphasis in English',async()=>{
  const source='<p style="text-align: right"><strong>משפט מודגש</strong></p>'+
    '<p style="text-align:center"><u>משפט מודגש בקו</u></p>';
  const translated='<p style="text-align: right"><strong>Bold Sentence</strong></p>'+
    '<p style="text-align:center"><u>Underlined Sentence</u></p>';
  const heads=[['center','כותרת מרכזית','Centered Heading'],
               ['right','כותרת ימנית','Left-Aligned Heading'],
               ['left','כותרת שמאלית','Right-Aligned Heading'],
               ['justify','כותרת דו צדדית','Justified Heading']];
  const blocks=[
    ...heads.map(([align,he,en])=>({type:'heading',content:he,
      english:{content:{source:he,value:en}},options:{level:2,align}})),
    {type:'free_text',content:source,english:{content:{source,value:translated}}}
  ];
  const c=client();
  const he=await composeManualQuoteHtml({title:'Manual',document_language:'he',
    blocks:JSON.stringify(blocks)},c);
  const en=await composeManualQuoteHtml({title:'Manual',document_language:'en',
    blocks:JSON.stringify(blocks)},c);
  const hd=dom(he.html),ed=dom(en.html);
  const heHeads=[...hd.querySelectorAll('.section h2')];
  const enHeads=[...ed.querySelectorAll('.section h2')];
  assert.deepEqual(heHeads.map(h=>h.style.textAlign),['center','right','left','justify']);
  assert.deepEqual(enHeads.map(h=>h.style.textAlign),['center','left','right','justify']);
  assert.deepEqual(enHeads.map(h=>h.style.fontWeight),heHeads.map(h=>h.style.fontWeight));
  assert.equal(ed.querySelector('.manual-block-text strong')?.textContent,'Bold Sentence');
  assert.equal(ed.querySelector('.manual-block-text strong')?.parentElement.style.textAlign,'left');
  assert.equal(ed.querySelector('.manual-block-text u')?.textContent,'Underlined Sentence');
  assert.equal(ed.querySelector('.manual-block-text u')?.parentElement.style.textAlign,'center');
  assert.equal(ed.querySelectorAll('.section').length,hd.querySelectorAll('.section').length);
  assert.ok(ed.head.textContent.includes('.manual-block-text blockquote { border-left:'));
});

test('modular quote keeps centered introduction and layout hierarchy with mirrored service alignment',async()=>{
  const content={document_language:'he',event_type:'Bar Mitzvah',show_services:false,
    show_summary:false,show_payment_terms:false,show_agreement:false,
    show_intro:true,intro:'<p style="text-align:center"><strong>Welcome to the Event</strong></p>'+
      '<p style="text-align:right"><u>Special Note</u></p>',items:[]};
  const c=client();
  const he=await composeModularQuoteHtml({content},c);
  const en=await composeModularQuoteHtml({content:{...content,document_language:'en'}},c);
  const hd=dom(he.html),ed=dom(en.html);
  assert.equal(style(hd,'.intro-content').textAlign,'center');
  assert.equal(style(ed,'.intro-content').textAlign,'center');
  assert.equal(ed.querySelector('.intro-content strong').textContent,'Welcome to the Event');
  assert.equal(ed.querySelector('.intro-content p:nth-child(1)').style.textAlign,'center');
  assert.equal(ed.querySelector('.intro-content p:nth-child(2)').style.textAlign,'left');
  assert.equal(ed.querySelectorAll('.event-details-box').length,hd.querySelectorAll('.event-details-box').length);
  assert.equal(ed.querySelectorAll('.section').length,hd.querySelectorAll('.section').length);
  assert.equal(ed.querySelectorAll('strong').length,hd.querySelectorAll('strong').length);
});

test('direction flip preserves source formatting metadata, margins, page breaks and background',()=>{
  const css=quoteDocumentStyle({
    quote_margin_left_mm:'15',quote_margin_right_mm:'26',
    quote_background_image:'https://example.com/background.png'
  });
  const source='<html dir="rtl" lang="he"><head>'+css+'</head><body>'+
    '<h1 style="text-align:center;font-weight:700;color:#8B0000">Same Heading</h1>'+
    '<p style="text-align:right;page-break-inside:avoid"><b>Important</b></p>'+
    '</body></html>';
  const english=applyDocumentDirection(source,'en');
  assert.equal(applyDocumentDirection(source,'he'),source);
  assert.equal(english.includes('background.png'),true);
  assert.equal(english.includes('font-weight:700;color:#8B0000'),true);
  assert.equal(english.includes('page-break-inside:avoid'),true);
  assert.match(english,/padding-right:15mm;padding-left:26mm/);
  assert.match(english,/\.intro-content\{text-align:center/);
  assert.match(english,/\.date\{text-align:right/);
  assert.match(english,/\.package-content\{padding-left:15px/);
  assert.match(english,/\.summary-table \.label\{font-weight:600;text-align:left/);
  assert.match(english,/\.summary-table \.value\{text-align:right/);
  assert.equal(dom(english).querySelector('h1').style.textAlign,'center');
  assert.equal(dom(english).querySelector('p').style.textAlign,'left');
  assert.deepEqual([...dom(english).querySelectorAll('b')].map(x=>x.textContent),['Important']);
});
