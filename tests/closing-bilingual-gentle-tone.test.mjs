import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {customerMessageDefaults,customerMessageTemplate,
 legacyMilestoneTemplates,formatCustomerMessage,customerBusinessName}
 from '../base44/shared/customerMessageTone.ts';
import {closingCopy,renderClosingMessage,localizedAgreement}
 from '../base44/shared/closingLanguage.ts';
import {agreementQuote} from '../base44/shared/agreementQuote.ts';
import {localizeClosingError} from '../src/components/billing/closingErrors.js';
import {closingDefaults} from '../base44/shared/agreementRules.ts';

const money={customer_name:'משפחת כהן',event_name:'בר מצווה',
 amount:2450,currency:'ILS',due_date:'2027-01-14',
 business_phone:'+972500000000'};
const link={name:'Cohen Family',amount:'₪2,450',description:'Bar Mitzvah',
 expiry_date:'20/01/2027',link:'https://example.test/pay/secure',
 business_name:'Shirat HaNevel',document_url:'https://example.test/document'};
const he=/[\u0590-\u05ff]/;
const threatening=/דרישת תשלום|ממתינה לתשלום|לחייב ידנית|עמלת סליקה|manual charge|saved card.*charge|overdue|payment demand|collection notice/i;

test('all seven client-facing defaults are friendly, bilingual, and preserve operational fields',()=>{
 const required={
  milestone:['customer_name','event_name','amount','currency','due_date','business_phone'],
  payment_link:['name','description','amount','link','business_name'],
  reminder:['name','amount','expiry_date','link','business_name'],
  receipt:['name','amount','document_url'],
  invitation:['customer_name','link'],
  otp:['code'],
  signed:['customer_name','event_name']
 };
 for(const [kind,vars] of Object.entries(required)){
  for(const lang of ['he','en']){
   const template=customerMessageTemplate(kind,lang,'');
   assert.equal(template,customerMessageDefaults[kind][lang]);
   assert.ok(template.length>70,kind+':'+lang+' empty');
   assert.ok(!threatening.test(template),kind+':'+lang+' harsh');
   assert.equal(he.test(template),lang==='he',kind+': wrong language');
   for(const name of vars)assert.ok(template.includes('{{'+name+'}}'),
    kind+':'+lang+': placeholder '+name);
  }
 }
 const rendered=formatCustomerMessage(customerMessageTemplate('milestone','en'),{
  ...money,customer_name:'Cohen Family',event_name:'Bar Mitzvah'
 });
 for(const chunk of ['2,450','2027-01-14','Bar Mitzvah'])assert.ok(
  formatCustomerMessage(customerMessageTemplate('milestone','en'),
   {...money,amount:'2,450',customer_name:'Cohen Family',event_name:'Bar Mitzvah'}).includes(chunk));
 assert.ok(rendered.includes('2450'));
});

test('exact historical harsh milestone defaults are replaced at SEND RENDER only, custom wording is kept',()=>{
 const original=[...legacyMilestoneTemplates];
 for(const prior of original){
  for(const lang of ['he','en']){
   const output=customerMessageTemplate('milestone',lang,prior);
   assert.equal(output,customerMessageDefaults.milestone[lang]);
   assert.ok(output!==prior);
  }
 }
 const customized='היי {{customer_name}}, תזכורת אישית בנוגע ל{{amount}} {{currency}}.';
 assert.equal(customerMessageTemplate('milestone','he',customized),customized);
 assert.equal(customerMessageTemplate('milestone','en',customized),customerMessageDefaults.milestone.en);
 const customEnglish='Hi {{customer_name}}, as discussed, {{amount}} {{currency}} on {{due_date}}.';
 assert.equal(customerMessageTemplate('milestone','en',customEnglish),customEnglish);
 assert.deepEqual(original,[...legacyMilestoneTemplates]);
 assert.match(closingCopy.he.token,/חיוב ידני/);
 assert.match(closingCopy.en.token,/manual charges/);
 assert.match(closingDefaults.closing_regular_text,/לחייב ידנית/);
 assert.equal(closingDefaults.closing_message_template,customerMessageDefaults.milestone.he);
});

test('agreement invitation, one-time verification and signed-copy notice use matching customer language',()=>{
 for(const kind of ['invitation','otp','signed']){
  for(const lang of ['he','en']){
   const fields={customer_name:'Cohen Family',event_name:'Bar Mitzvah',
    link:link.link,code:'132456'};
   const message=renderClosingMessage({},kind,lang,fields);
   assert.equal(message,formatCustomerMessage(customerMessageDefaults[kind][lang],fields));
   assert.equal(he.test(message),lang==='he');
   if(kind==='otp')assert.ok(message.includes('132456'));
   if(kind==='invitation')assert.ok(message.includes(link.link));
   const override=lang==='en'?'Dear {{customer_name}}, welcome to our event':'{{customer_name}}, מחכים לכם';
   assert.equal(renderClosingMessage({['closing_'+kind+'_template'+(lang==='en'?'_en':'')]:override},
    kind,lang,fields),formatCustomerMessage(override,fields));
  }
 }
});

test('client billing link, expiry reminder and receipt retain URL/amount/date with gentle language',()=>{
 for(const kind of ['payment_link','reminder','receipt']){
  for(const lang of ['he','en']){
   const rendered=formatCustomerMessage(customerMessageTemplate(kind,lang),link);
   assert.ok(rendered.includes('₪2,450'),kind+': amount missing');
   assert.ok(!/\{\{/.test(rendered),kind+': unresolved template placeholder');
   assert.equal(he.test(rendered),lang==='he',kind+': wrong language');
   assert.ok(rendered.includes(kind==='receipt'?link.document_url:link.link));
   if(kind==='reminder')assert.ok(rendered.includes('20/01/2027'));
  }
 }
 assert.equal(customerBusinessName({business_name:'שירת הנבל'},'en'),'Shirat HaNevel');
 assert.equal(customerBusinessName({business_name:'שירת הנבל',business_name_en:'Shirat HaNevel Events'},'en'),'Shirat HaNevel Events');
});

test('English agreement uses approved exact-source names in package children, not Hebrew source or internal prices',()=>{
 const event={quote_history:[
  {file_uri:'private:he',file_name:'עברית.pdf',created_at:'2026-10-01',document_language:'he'},
  {file_uri:'private:old',file_name:'old.pdf',created_at:'2026-11-01'},
  {file_uri:'private:english',file_name:'Quote.pdf',created_at:'2026-10-02',document_language:'en'}]};
 const services=[
  {id:'pkg1',is_package_main_item:true,package_name:'חבילת צילום',
   quantity:1,custom_price:2000,includes_vat:true,internal_notes:'PRIVATE_COST'},
  {id:'kid1',parent_package_event_service_id:'pkg1',service_name:'צילום משפחה',
   quantity:2,supplier_cost:15300},
  {id:'item2',service_name:'להקת נגנים',quantity:1,custom_price:500}
 ];
 const index=new Map([
  ['EventService:pkg1',{fields:{package_name:{source:'חבילת צילום',value:'Photography Package'}}}],
  ['EventService:kid1',{fields:{service_name:{source:'צילום משפחה',value:'Family Photography'}}}],
  ['EventService:item2',{fields:{service_name:{source:'להקת נגנים',value:'Musical Ensemble'}}}]
 ]);
 const finances={services,currency:'ILS',finalTotal:2500,totalPaid:250,
  balance:2250,discountAmount:0};
 const missing=new Set();
 const original=JSON.stringify(services);
 const en=agreementQuote(event,finances,'en',index,missing);
 const hebrewQuote=agreementQuote(event,finances,'he');
 assert.equal(missing.size,0);
 assert.equal(en.summary.rows[0].name,'Photography Package');
 assert.equal(en.summary.rows[0].children[0].name,'Family Photography');
 assert.equal(en.summary.rows[1].name,'Musical Ensemble');
 assert.equal(en.summary.total,hebrewQuote.summary.total);
 assert.equal(en.summary.balance,hebrewQuote.summary.balance);
 assert.equal(en.quoteFile.file_uri,'private:english');
 assert.equal(hebrewQuote.quoteFile.file_uri,'private:old');
 assert.ok(!he.test(en.quote));
 assert.ok(!en.quote.includes('PRIVATE_COST')&&!en.quote.includes('15300'));
 assert.equal(JSON.stringify(services),original,'no source mutation');
 const unknown=agreementQuote({...event,quote_history:event.quote_history.filter(x=>x.document_language!=='en')},
  finances,'en',index,new Set());
 assert.equal(unknown.quoteFile,null,'do not silently attach a Hebrew PDF');
 const uncovered=new Set();
 const noData=agreementQuote(event,finances,'en',new Map(),uncovered);
 assert.ok(uncovered.has('event_service.pkg1.package_name'));
 assert.ok(he.test(noData.summary.rows[0].name),'missing reviewed translation is never invented');
});

test('localized signed snapshot merges whole approved English quote summary and bank instructions, not just pricing note',()=>{
 const snapshot={event_name:'בר מצווה',bank_details:'בנק כלשהו סניף 123',
  quote_text:'צילום',quote_file:{file_uri:'private:he'},
  quote_summary:{rows:[{name:'צילום',price:100,quantity:1}],total:100,pricing_note:'מקור'},
  terms:'תנאים',translations:{en:{event_name:'Bar Mitzvah',bank_details:'Bank branch 123',
   quote_text:'Photography',quote_file:{file_uri:'private:en'},
   terms:'Agreed terms',
   quote_summary:{rows:[{name:'Photography',price:100,quantity:1}],
    pricing_note:'Agreed price'}}}};
 const frozen=JSON.stringify(snapshot);
 const en=localizedAgreement(snapshot,'en');
 assert.equal(en.event_name,'Bar Mitzvah');
 assert.equal(en.bank_details,'Bank branch 123');
 assert.equal(en.quote_file.file_uri,'private:en');
 assert.equal(en.quote_summary.rows[0].name,'Photography');
 assert.equal(en.quote_summary.total,100);
 assert.equal(en.quote_summary.pricing_note,'Agreed price');
 assert.equal(localizedAgreement(snapshot,'he').quote_summary.rows[0].name,'צילום');
 assert.equal(JSON.stringify(snapshot),frozen);
});

test('public OTP language is chosen only after an authenticated link, never from arbitrary UI text',()=>{
 const backend=fs.readFileSync('base44/functions/eventAgreement/entry.ts','utf8');
 const frontend=fs.readFileSync('src/pages/EventClosing.jsx','utf8');
 assert.match(backend,/form_language:a\.signature\?\.language\|\|a\.snapshot\?\.form_language/);
 assert.match(backend,/available_languages:a\.snapshot\?\.translations\?\.en\?\.terms/);
 assert.match(backend,/body\.language==='en'&&a\.snapshot\?\.translations\?\.en/);
 assert.match(frontend,/call\('otp',\{language\}\)/);
 assert.match(frontend,/opened\.available_languages\?\.includes\('en'\)/);
 assert.match(frontend,/localizeClosingError\(agreementError\(e\),language\)/);
 assert.equal(localizeClosingError('קוד שגוי או שפג תוקפו','en'),
  'The code may be incorrect or expired. Please request a new one if needed.');
 assert.match(localizeClosingError('אין לשלוח שוב תשלום בפעם השנייה','en'),
  /contact the office/i);
});

test('PDF language is saved for future history and preview fail-closes unreviewed English business material',()=>{
 const normal=fs.readFileSync('base44/functions/generateQuotePdf/entry.ts','utf8');
 const manual=fs.readFileSync('base44/functions/generateManualQuotePdf/entry.ts','utf8');
 const backend=fs.readFileSync('base44/functions/eventAgreement/entry.ts','utf8');
 assert.match(normal,/document_language: body\.language === 'en' \? 'en' : 'he'/);
 assert.match(manual,/document_language: modularQuoteId/);
 assert.match(backend,/loadQuoteTranslations\(base44,'en'\)/);
 assert.match(backend,/english_missing:/);
 assert.match(backend,/company_bank_details_en\.account_numbers_mismatch/);
 assert.match(backend,/translation(s)?\.en\.quote_file/);
 assert.match(backend,/quote_summary:baseVariant\.quote_summary/);
 assert.match(backend,/bank_details:baseVariant\.bank_details/);
 assert.doesNotMatch(fs.readFileSync('src/pages/EventClosing.jsx','utf8'),
  /base44\.entities\.(?:Payment|Event|EventService|EventAgreement)\./);
});
