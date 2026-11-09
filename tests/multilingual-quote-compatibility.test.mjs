import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(path){
 const result=await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',write:false,plugins:[{
   name:'runtime',setup(b){
    b.onResolve({filter:/^npm:sanitize-html/},()=>({path:'sanitize',namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export default v=>String(v);'}));
   }
 }]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const l=await load('base44/shared/quoteLocalization.ts');
const {composeModularQuoteHtml}=await load('base44/shared/modularQuote.ts');
const {generateQuoteHtml}=await load('base44/shared/quoteHtml.ts');
const approved=(entity,id,fields)=>({source_entity:entity,source_id:id,locale:'en',status:'approved',
 fields:Object.fromEntries(Object.entries(fields).map(([key,[source,value]])=>[key,{source,value}]))});
const catalog=[
 approved('Service','service-1',{
  service_name:['להקת שירת הנבל ארבעה נגנים','Shirat HaNevel Four-Piece Band'],
  service_description:['<p>תיאור מיוחד</p>','<p>Special description</p>']
 }),
 approved('QuoteTemplate','intro-1',{content:['<p>ברוכים הבאים</p>','<p>Welcome</p>']})
];
const client=(rows=catalog)=>({asServiceRole:{entities:{
 AppSettings:{list:async()=>[{setting_key:'vat_rate',setting_value:'18'}]},
 ContentTranslation:{filter:async()=>rows},
 Event:{get:async()=>({})},EventService:{filter:async()=>[]},
 Service:{list:async()=>[]},Payment:{filter:async()=>[]},
 QuoteTemplate:{list:async()=>[]},QuoteOrganizerType:{list:async()=>[]}
}}});

test('approved source-exact translations and no mutation',()=>{
 const map=l.translationIndex(catalog);
 const sample=catalog[0];
 const original=JSON.stringify(sample);
 assert.equal(l.approvedField(map,'Service','service-1','service_name','להקת שירת הנבל ארבעה נגנים'),
   'Shirat HaNevel Four-Piece Band');
 assert.equal(l.approvedField(map,'Service','service-1','service_name','שלושה נגנים'),null);
 assert.equal(l.indexedText(map,'service_name','להקת שירת הנבל ארבעה נגנים'),
   'Shirat HaNevel Four-Piece Band');
 assert.equal(JSON.stringify(sample),original);
});
test('protected numbers, links, placeholders and script cannot change',()=>{
 assert.equal(l.translationPreservesProtectedContent('4 נגנים במשך 45 דקות','4 musicians for 45 minutes'),true);
 assert.equal(l.translationPreservesProtectedContent('4 נגנים','5 musicians'),false);
 assert.equal(l.translationPreservesProtectedContent('https://example.com/abc קישור','https://evil.com/abc link'),false);
 assert.equal(l.translationPreservesProtectedContent('אירוע {{family}}','Event {{event}}'),false);
 assert.equal(l.translationPreservesProtectedContent('הצעה','<script>alert(1)</script>'),false);
});
test('regular Hebrew continues unchanged and English uses approved catalog/intro without changing figures',async()=>{
 const base={id:'event-1',event_name:'Family Event',family_name:'Family',child_name:'David',
   event_date:'2027-01-15',event_type:'bar_mitzvah',location:'Jerusalem',
   status:'quote',all_inclusive:false,concept:'ירושלים'};
 const eventServices=[{id:'es-1',service_id:'service-1',
   service_name:'להקת שירת הנבל ארבעה נגנים',
   service_description:'<p>תיאור מיוחד</p>',
   custom_price:1000,quantity:2,show_price_in_quote:true}];
 const entities=client().asServiceRole.entities;
 entities.Event={get:async()=>base};
 entities.EventService={filter:async()=>eventServices};
 entities.QuoteTemplate={list:async()=>[{id:'intro-1',identifier:'ירושלים',template_type:'concept_intro',content:'<p>ברוכים הבאים</p>'}]};
 entities.Service={list:async()=>[catalog[0]?{id:'service-1',service_name:'להקת שירת הנבל ארבעה נגנים',service_description:'<p>תיאור מיוחד</p>',base_price:1000}:{}]};
 entities.ContentTranslation={filter:async()=>catalog};
 const user={asServiceRole:{entities}};
 const he=await generateQuoteHtml(base.id,user);
 const en=await generateQuoteHtml(base.id,user,{language:'en'});
 assert.ok(he.html.includes('להקת שירת הנבל ארבעה נגנים'));
 assert.ok(en.html.includes('Shirat HaNevel Four-Piece Band'));
 assert.ok(en.html.includes('<html lang="en" dir="ltr">'));
 assert.ok(en.html.includes('<p>Welcome</p>'));
 assert.ok(en.html.includes('₪2,000.00'));
 assert.ok(he.html.includes('₪2,000.00'));
 assert.equal(eventServices[0].service_name,'להקת שירת הנבל ארבעה נגנים');
});
test('English proposal rejects a missing personal English spelling without touching Hebrew path',async()=>{
 const entities=client().asServiceRole.entities;
 const event={id:'event-1',event_name:'משפחת לוי',child_name:'דוד',family_name:'לוי',
  event_date:'2027-01-15',event_type:'bar_mitzvah'};
 entities.Event={get:async()=>event};
 await assert.rejects(generateQuoteHtml('event-1',{asServiceRole:{entities}},{language:'en'}),
  err=>err.code==='ENGLISH_TRANSLATION_INCOMPLETE' && err.fields.includes('event.family_name') && err.fields.includes('event.child_name'));
 const he=await generateQuoteHtml('event-1',{asServiceRole:{entities}});
 assert.ok(he.html.includes('לוי'));
 assert.equal(event.family_name,'לוי');
});
test('modular proposal translates items, descriptions, headings and stays priced identically',async()=>{
 const content={document_language:'he',event_type:'בר מצווה',show_intro:true,
   show_payment_terms:false,show_agreement:false,show_summary:true,
   services_title:'חבילות ושירותים',
   items:[{id:'item-1',kind:'service',name:'להקת שירת הנבל ארבעה נגנים',
    description:'<p>תיאור מיוחד</p>',price:2200,quantity:1,includes_vat:false,
    show_price:true,show_description:true,visible:true}]};
 const he=await composeModularQuoteHtml({content},client());
 const en=await composeModularQuoteHtml({content:{...content,document_language:'en'}},client());
 assert.ok(he.html.includes('להקת שירת הנבל ארבעה נגנים'));
 assert.ok(en.html.includes('Shirat HaNevel Four-Piece Band'));
 assert.ok(en.html.includes('Packages &amp; Services')||en.html.includes('Packages & Services'));
 assert.ok(en.html.includes('lang="en" dir="ltr"'));
 assert.ok(en.html.includes('₪2,200.00')&&he.html.includes('₪2,200.00'));
});
test('modular custom Hebrew text is blocked unless reviewed against exact source',async()=>{
 const content={document_language:'en',event_type:'בר מצווה',intro:'<p>פרטים מיוחדים</p>',
   show_summary:false,items:[]};
 await assert.rejects(composeModularQuoteHtml({content},client()),
  e=>e.code==='ENGLISH_TRANSLATION_INCOMPLETE');
 const complete={...content,english:{intro:{source:content.intro,value:'<p>Special details</p>'}}};
 const result=await composeModularQuoteHtml({content:complete},client());
 assert.ok(result.html.includes('Special details'));
 const stale={...complete,intro:'<p>פרטים אחרים</p>'};
 await assert.rejects(composeModularQuoteHtml({content:stale},client()),
  e=>e.code==='ENGLISH_TRANSLATION_INCOMPLETE');
});

test('organization quote keeps its Hebrew internal field IDs but localizes title and section captions',()=>{
 const source='<p>אירוע (([סוג_האירוע_123]))</p>';
 const english='<p>Event (([סוג_האירוע_123]))</p>';
 const blocks=[{block_type:'services',subtitle_title:'החבילה כוללת',enabled:true}];
 const row=approved('QuoteOrganizerType','org-1',{
   quote_main_title_template:[source,english],
   block_0_subtitle_title:['החבילה כוללת','Your Package Includes'],
   contacts_label:['אנשי קשר לאירוע','Event Contacts']
 });
 const index=l.translationIndex([row]);
 const organizer={id:'org-1',type_name:'מוסד / ארגון',
  quote_main_title_template:source,quote_blocks:JSON.stringify(blocks),
  contacts_config:JSON.stringify({label:'אנשי קשר לאירוע'})};
 const missing=new Set();
 const translated=l.translateOrganizerQuoteFields(organizer,index,missing);
 assert.equal(missing.size,0);
 assert.equal(translated.quote_main_title_template,english);
 assert.equal(JSON.parse(translated.quote_blocks)[0].subtitle_title,'Your Package Includes');
 assert.equal(translated.english_contacts_label,'Event Contacts');
 assert.equal(organizer.quote_main_title_template,source,'internal source unchanged');
 assert.equal(organizer.quote_blocks,JSON.stringify(blocks));
 const stale=l.translateOrganizerQuoteFields({...organizer,quote_main_title_template:source+' new'},index,new Set());
 assert.notEqual(stale.quote_main_title_template,english,'edited sources must not reuse stale translation');
});
test('custom organizer event values are translated by exact ID while numeric data is untouched',()=>{
 const originalFields={company_name:'שירת הנבל',guest_count:350};
 const event={id:'event-2',family_name:'Company',event_name:'Annual Gala',
  custom_organizer_fields:JSON.stringify(originalFields)};
 const index=l.translationIndex([approved('Event','event-2',{
  custom_company_name:['שירת הנבל','Shirat HaNevel']
 })]);
 const converted=l.localizeEventQuoteData({event,services:[],eventServices:[],
  templates:[],index});
 assert.equal(converted.missing.size,0);
 assert.equal(JSON.parse(converted.event.custom_organizer_fields).company_name,'Shirat HaNevel');
 assert.equal(JSON.parse(converted.event.custom_organizer_fields).guest_count,350);
 assert.equal(event.custom_organizer_fields,JSON.stringify(originalFields));
});
test('manually approved English cannot change a financial number in modular quote',async()=>{
 const content={document_language:'en',event_type:'בר מצווה',items:[],
  intro:'<p>מקדמה בסך 2,000 ש״ח</p>',english:{
   intro:{source:'<p>מקדמה בסך 2,000 ש״ח</p>',value:'<p>Deposit NIS 3,000</p>'}
  }};
 await assert.rejects(composeModularQuoteHtml({content},client()),
  e=>e.code==='ENGLISH_TRANSLATION_INCOMPLETE');
});

test('legacy service descriptions reused in package_description and Quill HTML variants',()=>{
 const source='<p>תיאור שירות ללקוח 4 נגנים במשך 45 דקות</p>';
 const translated='<p>Client service description with 4 musicians for 45 minutes</p>';
 const map=l.translationIndex([
  approved('Service','service-legacy',{service_description:[source,translated]})
 ]);
 assert.equal(l.indexedText(map,'package_description',source),translated);
 assert.equal(l.indexedText(map,'package_description',
  '<p class="ql-align-right ql-direction-rtl">תיאור שירות ללקוח 4 נגנים במשך 45 דקות</p>'),translated);
 assert.equal(l.indexedText(map,'package_description',
  '<p>תיאור שירות ללקוח 5 נגנים במשך 45 דקות</p>'),null);
});
test('reusable reviewed QuotePhrase is source-specific and preserves business amounts',()=>{
 const map=l.translationIndex([approved('QuotePhrase','phrase1',{
  text:['מחיר ינתן בנפרד 750 ש"ח','Separate quote: 750 NIS']
 })]);
 assert.equal(l.indexedText(map,'price_display_text','מחיר ינתן בנפרד 750 ש"ח'),'Separate quote: 750 NIS');
 assert.equal(l.indexedText(map,'price_display_text','מחיר ינתן בנפרד 850 ש"ח'),null);
});
test('English translation omits internal notes and hidden custom prices',()=>{
 const index=new Map();
 const base={id:'ev',event_name:'Family',family_name:'Family',child_name:'David'};
 const service={id:'es',service_id:'s',service_name:'Band',notes:'הערות פנימיות לספק',
   admin_notes:'מידע פנימי',price_display_text:'מחיר מותאם',price_display_mode:'default'};
 const r=l.localizeEventQuoteData({event:base,services:[{id:'s',service_name:'Band'}],
  eventServices:[service],templates:[],index});
 assert.equal(r.missing.size,0);
 assert.equal(r.eventServices[0].notes,'הערות פנימיות לספק');
 assert.equal(r.eventServices[0].price_display_text,'מחיר מותאם');
});

test('family organizer contact heading is a fixed label not a mandatory translation record',()=>{
 const family={id:'family-1',type_name:'משפחה',contacts_config:JSON.stringify({
  label:'פרטי ההורים',item_label:'איש קשר'
 })};
 const missing=new Set();
 const localized=l.translateOrganizerQuoteFields(family,new Map(),missing);
 assert.equal(localized.english_contacts_label,"Parents' Details");
 assert.equal(missing.size,0);
});
test('English quote raises only client-visible fields and includes exact source identifier',()=>{
 const event={id:'event-1',family_name:'Family',event_name:'Family',
  child_name:'David',event_date:'2027-01-15',location:'Jerusalem'};
 const eventServices=[
  {id:'es-hidden',service_id:'s',service_name:'Concert',
   service_description:'תיאור מוסתר',notes:'תזכורת פנימית',
   client_notes:'הערה גלויה',price_display_mode:'default',price_display_text:'מחיר נסתר'}
 ];
 const hidden=l.localizeEventQuoteData({event,services:[{id:'s',service_name:'Concert'}],
  eventServices,templates:[],index:new Map(),
  options:{includeDescriptions:false,includeClientNotes:false}});
 assert.equal(hidden.missing.size,0);
 const visible=l.localizeEventQuoteData({event,services:[{id:'s',service_name:'Concert'}],
  eventServices,templates:[],index:new Map(),
  options:{includeDescriptions:false,includeClientNotes:true}});
 assert.equal(visible.missing.has('service.es-hidden.client_notes'),true);
 assert.equal(visible.missing.has('service.es-hidden.price_display_text'),false);
});

test('only visible package description is required; hidden snapshots never block a quote',()=>{
 const event={id:'ev',family_name:'Family',child_name:'David',event_name:'Family',
   event_date:'2027-01-01'};
 const services=[{id:'s',service_name:'Band',service_description:'English Description'}];
 const eventServices=[
  {id:'standalone',service_id:'s',service_name:'Band',
   service_description:'English Description',
   package_description:'תיאור חבילה ישן ונסתר'},
  {id:'child',service_id:'s',service_name:'Band',
   parent_package_event_service_id:'main',
   service_description:'English Description',
   package_description:'עוד תיאור חבילה נסתר'},
  {id:'main',service_id:'s',is_package_main_item:true,
   package_name:'Production Package',service_name:'שם שירות נסתר',
   package_description:'תיאור החבילה שמוצג ללקוח'}
 ];
 const translated=l.localizeEventQuoteData({event,services,eventServices,
  templates:[],index:new Map()});
 assert.deepEqual([...translated.missing],['service.main.package_description']);
 assert.equal(translated.eventServices[0].package_description,'תיאור חבילה ישן ונסתר');
 assert.equal(translated.eventServices[1].package_description,'עוד תיאור חבילה נסתר');
});

test('real existing quote section headings with colons translate without custom records',()=>{
 assert.equal(l.fixedEnglishLabel('חבילות ושירותים הכלולים בהצעה:'),
  'Packages & Services Included in This Quote:');
 assert.equal(l.fixedEnglishLabel('שירותים אופציונליים בתוספת תשלום:'),
  'Optional Services for an Extra Charge:');
 assert.equal(l.fixedEnglishLabel('שירותים שאינם כלולים בחבילה:'),
  'Services Not Included in the Package:');
});
test('verified event locations/cities resolve without personal name transliteration',()=>{
 assert.equal(l.approvedPlace('הר ציון ירושלים'),'Mount Zion, Jerusalem');
 assert.equal(l.approvedPlace('משכנות שאננים ירושלים'),"Mishkenot Sha'ananim, Jerusalem");
 assert.equal(l.approvedPlace('פתח תקווה'),'Petah Tikva');
 assert.equal(l.approvedPlace('גן הוורדים / מליאו'),'Rose Garden / Malio');
 assert.equal(l.approvedPlace('שם פרטי של לקוח לא מוכר'),null);
});

test('final output guard refuses visible Hebrew from an unlocalized renderer',()=>{
 const markup='<html lang="en"><head><style>/* טקסט CSS בלבד */</style></head>'+
  '<body><div>Proposal</div><p>שם שירות בעברית</p><p>&#x5d4;&#x5e2;&#x5e8;&#x5d4;</p></body></html>';
 assert.deepEqual(l.visibleHebrewQuoteSnippets(markup),['שם שירות בעברית','הערה']);
 assert.throws(()=>l.ensureNoVisibleHebrewInEnglishQuote(markup),e=>
  e.code==='ENGLISH_TRANSLATION_INCOMPLETE'&&
  e.fields.includes('document.visible_text')&&e.samples.length===2);
});
test('final English guard does not misread invisible CSS, scripts or comments',()=>{
 const html='<html><head><style>body:before{content:"כותרת לא מוצגת"}</style>'+
  '<script>const x="הערה לא מוצגת";</script></head>'+
  '<body><!-- הערת מפתח --><p>Event at Jerusalem</p><div>₪1,500</div></body></html>';
 assert.doesNotThrow(()=>l.ensureNoVisibleHebrewInEnglishQuote(html));
 assert.deepEqual(l.visibleHebrewQuoteSnippets(html),[]);
});
