// Shared, read-only translation selection. Stored Hebrew is never overwritten.
// Only *approved* records whose source matches byte-for-byte are used.
// No calls to an external AI provider occur here.
export const LANGUAGE_EN='en';
export function localeForQuote(value:unknown):'he'|'en'{
  return value==='en'?'en':'he';
}
export function isHebrew(value:unknown):boolean{
  return /[\u0590-\u05ff]/.test(String(value??''));
}
export function translationIndex(rows:any[]=[]){
  const index=new Map<string,any>();
  for(const row of rows){
    if(row?.locale==='en'&&row.status==='approved'&&row.source_entity&&row.source_id){
      const key=row.source_entity+':'+row.source_id;
      if(!index.has(key))index.set(key,row);
    }
  }
  return index;
}
export async function loadQuoteTranslations(client:any,locale:unknown){
  if(localeForQuote(locale)!=='en')return new Map<string,any>();
  const rows:any[]=[];
  const seen=new Set<string>();
  // Avoid silently losing the oldest approved translations after record 500.
  // Offset pagination only runs when a complete page is returned; repeated
  // pages (from an older SDK without offset support) terminate safely.
  for(let offset=0;offset<15000;offset+=500){
    const page=await client.asServiceRole.entities.ContentTranslation.filter({
      locale:'en',status:'approved'
    },'-updated_date',500,offset);
    if(!Array.isArray(page))throw new Error('Approved English translations could not be loaded safely.');
    let added=0;
    for(let i=0;i<page.length;i++){
      const item=page[i];
      const key=String(item?.id||item?.source_entity+':'+item?.source_id);
      if(!seen.has(key)){seen.add(key);rows.push(item);added++;}
    }
    if(page.length<500)return translationIndex(rows);
    if(added===0)throw new Error('Translation pagination did not advance. The English quote was not issued.');
  }
  throw new Error('Approved translations exceed the verified pagination limit.');
}
export function translationPreservesProtectedContent(source:string,value:string):boolean{
  if(/<\s*(script|iframe|object|embed|style)\b|\bon\w+\s*=|javascript\s*:/i.test(value))return false;
  const visible=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ');
  const extract=(s:string,re:RegExp)=>(s.match(re)||[]).sort().join('|');
  const sourceVisible=visible(source),targetVisible=visible(value);
  // Keep real amounts, decimals, percentages and numeric ranges unchanged.
  // Do not treat the hyphen in a natural compound such as '55-Seat' as
  // part of the number when source contained plain '55'.
  const numeric=/\d+(?:[.,/]\d+)*(?:%|-\d+(?:[.,/]\d+)*)?/g;
  if(extract(sourceVisible,numeric)!==extract(targetVisible,numeric))return false;
  if(extract(source,/https?:\/\/[^\s\"'<>]+/g)!==extract(value,/https?:\/\/[^\s\"'<>]+/g))return false;
  if(extract(source,/\{\{?[^{}]+\}\}?/g)!==extract(value,/\{\{?[^{}]+\}\}?/g))return false;
  // Organizer titles contain [field_ID] tokens. They are runtime lookup keys,
  // NOT words to translate. Changing them silently removes event details.
  if(extract(source,/\[[^\[\]<>]{1,150}\]/g)!==extract(value,/\[[^\[\]<>]{1,150}\]/g))return false;
  const attributes=(html:string)=>{
    const attrs:string[]=[];
    const re=/\b(?:href|src)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')/gi;
    for(const match of html.matchAll(re))attrs.push(match[0].replace(/\s+/g,'').toLowerCase());
    return attrs.sort().join('|');
  };
  if(attributes(source)!==attributes(value))return false;
  return true;
}
export function approvedField(index:Map<string,any>,entity:string,id:string,field:string,source:unknown){
  if(typeof source!=='string')return null;
  const x=index.get(entity+':'+id)?.fields?.[field];
  return x?.source===source && typeof x?.value==='string' && x.value.trim() &&
    translationPreservesProtectedContent(source,x.value)?x.value:null;
}
export function indexedText(index:Map<string,any>,field:string,source:unknown){
  if(typeof source!=='string'||!source.trim())return null;
  // EventService snapshots frequently copy service descriptions into the
  // package_description column (and vice versa). Field-only matching missed
  // 1,192 *existing* copied descriptions. Match exact source text across
  // equivalent business fields, not a similar phrase or arbitrary note.
  const semanticGroup:{[key:string]:string[]}={
    service_name:['service_name','package_name'],
    package_name:['service_name','package_name'],
    service_description:['service_description','package_description'],
    package_description:['service_description','package_description']
  };
  const candidateFields=semanticGroup[field]||[field];
  // HTML produced by older rich-text editors may have different Quill classes,
  // whitespace and wrappers while showing the exact same customer-facing text.
  // Normalize presentation only, never the actual words, amounts or placeholders.
  const canonical=(s:string)=>s.replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'\"').replace(/&#39;|&apos;/gi,"'")
    .replace(/[\u200e\u200f]/g,'').replace(/\s+/g,' ').trim().normalize('NFC');
  const sourceText=canonical(source);
  const matches=new Set<string>();
  for(const [key,row] of index){
    if(!/^(Service|Package|QuoteTemplate|QuotePhrase):/.test(key))continue;
    for(const k of candidateFields){
      const pair=row?.fields?.[k];
      if(typeof pair?.source==='string'&&canonical(pair.source)===sourceText&&
        typeof pair.value==='string'&&pair.value.trim()&&
        translationPreservesProtectedContent(source,pair.value))matches.add(pair.value);
    }
    // Reusable administrator-reviewed phrases can be used in any quote field
    // if the Hebrew source is identical; never copy a translation to changed text.
    if(key.startsWith('QuotePhrase:')&&[
      'service_name','package_name','service_description','package_description',
      'client_notes','price_display_text'
    ].includes(field)){
      const phrase=row?.fields?.text;
      if(typeof phrase?.source==='string'&&canonical(phrase.source)===sourceText&&
        typeof phrase.value==='string'&&phrase.value.trim()&&
        translationPreservesProtectedContent(source,phrase.value))matches.add(phrase.value);
    }
  }
  return matches.size===1?[...matches][0]:null;
}
const labels=new Map<string,string>([
  ['תאריך הפקה','Issue Date'],['כמות','Quantity'],
  ['כמות משתתפים','Number of Guests'],['כמות מוזמנים','Number of Guests'],
  ['שמות ההורים',"Parents' Names"],['פרטי ההורים',"Parents' Details"],
  ['אנשי קשר','Contacts'],['פרטי אנשי קשר','Contact Details'],
  ['עיר מגורים','City of Residence'],
  ['אירוע ב','Event at '],['סיכום כספי','Financial Summary'],
  ['תנאי תשלום','Payment Terms'],['תנאי התקשרות','Terms & Conditions'],
  ['תשלום ישיר','Paid Directly'],['מחיר מוערך','Estimated Price'],
  ['חבילות ושירותים הכלולים בהצעה','Packages & Services Included in This Quote'],
  ['שירותים הכלולים בהצעה','Services Included in This Quote'],
  ['הצעה מודולרית','Modular Quotation'],
  ['חבילת ההפקה כוללת','Your Production Package Includes'],
  ['חבילות ושירותים','Packages & Services'],
  ['שירותים נוספים','Additional Services'],['הערות','Notes'],
  ['לוח זמנים','Schedule'],['סה"כ לחבילה','Package Total'],
  ['סה״כ לחבילה','Package Total'],['סה"כ לפני מע"מ','Subtotal Before VAT'],
  ['סה"כ כולל מע"מ','Total Including VAT'],
  ['סה״כ לפני מע״מ','Subtotal Before VAT'],
  ['סה״כ כולל מע״מ','Total Including VAT'],
  ['מע"מ','VAT'],['מע״מ','VAT'],
  ['כולל מע"מ','VAT included'],['לא כולל מע"מ','excluding VAT'],
  ['כולל מע״מ','VAT included'],['לא כולל מע״מ','excluding VAT'],
  ['איש קשר במקום','On-site contact'],
  ['איש קשר','Contact person'],['שעה','Time'],['מיקום','Location'],
  ['נסיעה','Journey'],['נקודה','Stop'],['שירות','Service'],
  ['אירוע ב','Event at'],['פרטי אירוע','Event Details'],
  ['מחיר חבילה (לפני מע"מ)','Package Price Before VAT'],
  ['מחיר חבילה (לפני מע״מ)','Package Price Before VAT'],
  ['סה"כ לפני מע"מ','Subtotal Before VAT'],['סה״כ לפני מע״מ','Subtotal Before VAT'],
  ['סה"כ כולל מע"מ','Total Including VAT'],['סה״כ כולל מע״מ','Total Including VAT'],
  ['סה"כ לתשלום','Total Due'],['סה״כ לתשלום','Total Due'],
  ['יתרה לתשלום','Balance Due'],['שולם','Paid'],['הנחה','Discount'],
  ['תשלומים','Payments'],['מחיר למשתתף','Price per Guest'],
  ['שירותים נוספים בתשלום נפרד','Additional Services Billed Separately'],
  ['שירותים וחבילות הכלולים בהצעה','Services & Packages Included in This Quote'],
  ['שירותים וחבילות שכלולים בהצעה','Services & Packages Included in This Quote'],
  ['חבילות ושירותים בהצעה','Packages & Services in This Quote'],
  ['חבילות ושירותים שכלולים בהצעה','Packages & Services Included in This Quote'],
  ['שירותים שאינם כלולים בחבילה','Services Not Included in the Package'],
  ['שירותים נוספים בתשלום נוסף','Additional Services for an Extra Charge'],
  ['שירותים אופציונליים בתוספת תשלום','Optional Services for an Extra Charge'],
  ['שירותים אופציונלים בתוספת תשלום','Optional Services for an Extra Charge'],
  ['שירותים אופציונליים בתשלום נפרד','Optional Services Billed Separately'],
  ['שירותים אופציונלים בתשלום נפרד','Optional Services Billed Separately'],
  ['שירותים אופציונליים בתשלום נוסף','Optional Services for an Extra Charge'],
  ['שירותים אופציונלים בתשלום נוסף','Optional Services for an Extra Charge'],
  ['שירותים אופציונליים','Optional Services'],
  ['שירותים חיצוניים בתוספת תשלום','External Services for an Extra Charge'],
  ['תוספות אופציונליות בתוספת תשלום','Optional Add-ons for an Extra Charge'],
  ['שירותים בתשלום נפרד','Separately Billed Services'],
  ['שירותים אופציונליים מומלצים בתוספת תשלום','Recommended Optional Services for an Extra Charge'],
  ['שירותים מומלצים  נוספים בתשלום נפרד','Additional Recommended Services Billed Separately'],
  ['שירותים מומלצים בתוספת תשלום','Recommended Services for an Extra Charge'],
  ['שירותים אופציונליים לבחירה (לא כלולים בהסכם)','Optional Services (Not Included in the Agreement)'],
  ['הזמנות ושירותים אופציונליים - מחוץ לחבילה','Optional Orders and Services Outside the Package'],
  ['שירותים מחוץ לחבילה','Services Outside the Package'],
  ['שירותים נוספים שאינם כלולים בחבילה','Additional Services Not Included in the Package'],
  ['שירותים נוספים מחוץ לחבילה','Additional Services Outside the Package'],
  ['שירותים שאינם כלולים בחבילה וניתנים לביטול','Services Not Included in the Package and Subject to Cancellation'],
  ['תשלומים לספקים חיצוניים','Payments to External Suppliers'],
  ['החבילה כוללת','Package Inclusions'],
  ['בר מצווה','Bar Mitzvah'],['בת מצווה','Bat Mitzvah'],
  ['חתונה','Wedding'],['אירוע','Event']
]);
export function fixedEnglishLabel(value:unknown):string{
  const source=String(value??'');
  const clean=source.trim();
  if(labels.has(clean))return labels.get(clean)!;
  // Existing event headings frequently add a colon to the same fixed label.
  const colon=clean.match(/^(.+?)\s*([:：])$/);
  if(colon&&labels.has(colon[1]))return labels.get(colon[1])+colon[2];
  return source;
}
export function localizeVisibleHtmlLabels(html:string):string{
  // Text nodes only, never tags/attributes/URLs. Rich customer content should
  // already have passed exact-source approval; this is only for fixed labels.
  return html.replace(/>([^<>]*)</g,(_,text:string)=>{
    const leading=text.match(/^\s*/)?.[0]||'';
    const trailing=text.match(/\s*$/)?.[0]||'';
    const value=text.trim();
    if(labels.has(value))return '>'+leading+labels.get(value)+trailing+'<';
    if(/^\((כולל|לא כולל) מע[״\"]מ\)$/.test(value))
      return '>'+leading+(value.startsWith('(כולל')?'(VAT included)':'(excluding VAT)')+trailing+'<';
    const vat=value.match(/^מע[״\"]מ\s*\((\d+(?:\.\d+)?)%\)(:?)$/);
    if(vat)return '>'+leading+'VAT ('+vat[1]+'%)'+vat[2]+trailing+'<';
    const match=value.match(/^(.+?)([:：])(\s*.*)$/);
    if(match&&labels.has(match[1]))
      return '>'+leading+labels.get(match[1])+match[2]+match[3]+trailing+'<';
    // Standalone "אירוע ב..." without markup is a fixed label + variable.
    // A carefully bounded set of fixed labels with dynamic numeric suffixes.
    const ride=value.match(/^נסיעה\s+(\d+)$/);
    if(ride)return '>'+leading+'Journey '+ride[1]+trailing+'<';
    const stop=value.match(/^נקודה\s+(\d+)(:?)$/);
    if(stop)return '>'+leading+'Stop '+stop[1]+stop[2]+trailing+'<';
    // Dates, quantity, and transport labels can share a text node with
    // numeric values. Only match known label prefixes, never generic Hebrew.
    const issueDate=value.match(/^תאריך הפקה:\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})$/);
    if(issueDate)return '>'+leading+'Issue Date: '+issueDate[1]+trailing+'<';
    const quantity=value.match(/^כמות:\s*(\d+(?:\.\d+)?)(.*)$/);
    if(quantity)return '>'+leading+'Quantity: '+quantity[1]+quantity[2]+trailing+'<';
    const discount=value.match(/^הנחה(\s*\([^()<>]*\))?:$/);
    if(discount)return '>'+leading+'Discount'+(discount[1]||'')+':'+trailing+'<';
    return '>'+text+'<';
  });
}
export function applyDocumentDirection(html:string,locale:unknown):string{
  if(localeForQuote(locale)!=='en')return html;
  const ltrCss='<style data-quote-locale="en">html,body{direction:ltr;text-align:left} .page-content{direction:ltr} .section,.event-details-box,.package-content,.intro-content,.payment-terms,.event-notes{text-align:left;direction:ltr} .package-content{padding-left:15px!important;padding-right:0!important} .summary-table{direction:ltr} .summary-table td.label{text-align:left} .summary-table td.value{text-align:right} .package-footer,.package-service-item{direction:ltr} .package-service-bullet{margin-right:10px;margin-left:0} .schedule-table td{text-align:left}</style>';
  return localizeVisibleHtmlLabels(html.replace(/<html([^>]*)>/i,(_x,attrs)=>
    '<html'+attrs.replace(/\s+dir="[^"]*"/,'').replace(/\s+lang="[^"]*"/,'')+' lang="en" dir="ltr">')
    .replace('</head>',ltrCss+'</head>'));
}
// Final outgoing-document guard. An approved source can still leak Hebrew if
// a renderer later inserts an unlocalized fallback, label or contact. Inspect
// visible text nodes only: CSS, script, template and comments are not printed.
// This is independent of the translation catalog and never rewrites the PDF.
export function visibleHebrewQuoteSnippets(html:string):string[]{
  const withoutNonVisible=String(html||'')
    .replace(/<!--[\s\S]*?-->/g,'')
    .replace(/<(style|script|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const found=new Set<string>();
  for(const match of withoutNonVisible.matchAll(/>([^<>]*)</g)){
    const text=match[1].replace(/&(?:nbsp|rlm|lrm);/gi,' ')
      .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_m,hex,dec)=>{
        const code=parseInt(hex||dec,hex?16:10);
        return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';
      }).replace(/\s+/g,' ').trim();
    if(isHebrew(text))found.add(text.slice(0,180));
    if(found.size>=12)break;
  }
  return [...found];
}
export function ensureNoVisibleHebrewInEnglishQuote(html:string):void{
  const samples=visibleHebrewQuoteSnippets(html);
  if(!samples.length)return;
  const error:any=new Error('The English quote contains visible text that was not translated. Review the highlighted original text before generating or sharing the quote.');
  error.code='ENGLISH_TRANSLATION_INCOMPLETE';
  error.fields=['document.visible_text'];
  error.samples=samples;
  throw error;
}
export function translateOrMissing(index:Map<string,any>,entity:string,id:string,field:string,
 source:unknown,missing:Set<string>,label?:string){
  if(typeof source!=='string'||!source.trim()||!isHebrew(source))return source;
  const result=approvedField(index,entity,id,field,source)??indexedText(index,field,source);
  if(result)return result;
  // Fixed UI strings are not user-authored translations.
  const fixed=fixedEnglishLabel(source);
  if(fixed!==source)return fixed;
  missing.add(label||field);
  return source;
}
export function translateOrganizerQuoteFields(organizer:any,index:Map<string,any>,missing:Set<string>){
  if(!organizer)return organizer;
  const id=organizer.id;
  const translate=(key:string,source:any,label:string)=>{
    if(!source||!isHebrew(source))return source;
    const value=approvedField(index,'QuoteOrganizerType',id,key,source);
    if(value)return value;
    const fixed=fixedEnglishLabel(source);
    if(fixed!==source)return fixed;
    missing.add(label);return source;
  };
  let quote_blocks=organizer.quote_blocks;
  if(quote_blocks){
    try{
      const blocks=JSON.parse(quote_blocks);
      if(Array.isArray(blocks))quote_blocks=JSON.stringify(blocks.map((block:any,i:number)=>({
        ...block,subtitle_title:translate('block_'+i+'_subtitle_title',block.subtitle_title,
          'organizer.block_'+i)
      })));
    }catch{missing.add('organizer.quote_blocks');}
  }
  return {...organizer,
    quote_main_title_template:translate('quote_main_title_template',
      organizer.quote_main_title_template,'organizer.quote_main_title_template'),
    quote_blocks,
    english_contacts_label:translate('contacts_label',
      (()=>{try{return JSON.parse(organizer.contacts_config||'{}')?.label||''}catch{return''}})(),
      'organizer.contacts_label')
  };
}
export function ensureCompleteEnglish(missing:Iterable<string>){ 
  const list=[...new Set(missing)];
  if(!list.length)return;
  const error=new Error('The English quote has '+list.length+
    ' untranslated or outdated content fields. Review the English fields before generating or sharing the quote.');
  (error as any).code='ENGLISH_TRANSLATION_INCOMPLETE';
  (error as any).fields=list.slice(0,40);
  throw error;
}

const places=new Map([
 ['ירושלים','Jerusalem'],['הכותל המערבי','Western Wall'],
 ['רחבת הכותל המערבי','Western Wall Plaza'],['רחבת הכותל','Western Wall Plaza'],
 ['בית הכנסת רבן יוחנן בן זכאי','Rabban Yochanan Ben Zakkai Synagogue'],
 ['בית הכנסת ריבז','RYBZ Synagogue'],['העיר העתיקה','Old City of Jerusalem'],
 ['ממילא','Mamilla'],['יפו העתיקה','Old Jaffa'],
 ['זכרון יעקב','Zichron Yaakov'],['הר ציון','Mount Zion'],
 ['קבר דוד המלך',"King David's Tomb"],['הרובע היהודי','Jewish Quarter'],
 ['מונטיפיורי','Montefiore'],['דוד המלך','King David'],
 ['הר ציון ירושלים','Mount Zion, Jerusalem'],
 ['משכנות שאננים ירושלים',"Mishkenot Sha'ananim, Jerusalem"],
 ['משכנות שאננים ירושלעם',"Mishkenot Sha'ananim, Jerusalem"],
 ['משכנות שאננים',"Mishkenot Sha'ananim"],
 ['שער האשפות ירושלים','Dung Gate, Jerusalem'],['שער האשפות','Dung Gate'],
 ['בית הכנסת אהל ישראל בפתח תקווה','Ohel Yisrael Synagogue, Petah Tikva'],
 ['כפר יונה','Kfar Yona'],['משכנות','Mishkenot'],
 ['גן הוורדים / מליאו','Rose Garden / Malio'],
 ['בית המוכתר זכרון יעקב','Beit HaMukhtar, Zichron Yaakov'],
 ['בית הכנסת החורבה ירושלים','Hurva Synagogue, Jerusalem'],
 ['גן הפעמון ירושלים','Liberty Bell Park, Jerusalem'],
 ['ממילא ירושלים','Mamilla, Jerusalem'],['מונטיפורי','Montefiore'],
 ['מתחם קבר דוד המלך',"King David's Tomb Complex"],
 ['בית הכנסת המרכזי קריית חיים','Central Synagogue, Kiryat Haim'],
 ['קריאת אתא','Kiryat Ata'],['קריית אתא','Kiryat Ata'],
 ['קפריסין','Cyprus'],['נתניה','Netanya'],['רשלצ','Rishon LeZion'],
 ['אשקלון','Ashkelon'],['ראש העין','Rosh HaAyin'],['חיפה','Haifa'],
 ['ראשון לציון','Rishon LeZion'],['תל אביב','Tel Aviv'],['אשדוד','Ashdod'],
 ['קרית הונו','Kiryat Ono'],['קרית אונו','Kiryat Ono'],
 ['קדימה-צורן','Kadima-Zoran'],['קדימה צורן','Kadima-Zoran'],
 ['הרצליה','Herzliya'],['חדרה','Hadera'],['יהוד','Yehud'],
 ['נהריה','Nahariya'],['מרכז','Central Israel'],['הוד השרון','Hod HaSharon'],
 ['עתלית','Atlit'],['קיסריה','Caesarea'],['פתח תקווה','Petah Tikva'],
 ['רמת גן','Ramat Gan'],['חריש','Harish'],['באר שבע',"Be'er Sheva"],
 ['גבעת שמואל','Givat Shmuel'],['טולוז-צרפת','Toulouse, France'],
 ['באר יעקב',"Be'er Yaakov"],['חולון','Holon'],['קרית גת','Kiryat Gat'],
 ['קרית עקרון','Kiryat Ekron'],['שוהם','Shoham'],['אור עקיבא','Or Akiva'],
 ['דימונה','Dimona'],['רמת השרון','Ramat HaSharon'],
 ['קריות','Krayot'],['חצור הגלילית','Hatzor HaGlilit'],
 ['מודעין',"Modi'in"],['מודיעין',"Modi'in"],['קרית חיים','Kiryat Haim']
]);
// Only full-place matches; never attempt to "translate" arbitrary personal names.
export function approvedPlace(value:unknown){
 return places.get(String(value??'').trim())||null;
}
export function localizeEventQuoteData(input:{
 event:any;services:any[];eventServices:any[];templates:any[];index:Map<string,any>;
 options?:any
}){
 const {event,services,eventServices,templates,index,options={}}=input;
 const missing=new Set<string>();
 const field=(entity:string,id:string,key:string,source:any,label:string,catalogId?:string)=>{
   if(typeof source!=='string'||!source.trim()||!isHebrew(source))return source;
   const value=approvedField(index,entity,id,key,source)||
     (catalogId&&approvedField(index,'Service',catalogId,key,source))||
     indexedText(index,key,source)||
     approvedPlace(source);
   if(value)return value;
   const fixed=fixedEnglishLabel(source);
   if(fixed!==source)return fixed;
   missing.add(label);
   return source;
 };
 const e={...event};
 // Keep event.concept in its original Hebrew: it is the identifier used to
 // select a QuoteTemplate. Translating it here would lose the intro template.
 for(const key of ['event_name','family_name','child_name','location','city',
  'services_section_title','standalone_services_title','external_services_title']){
  if(options.includeEventHeader===false&&['event_name','family_name','child_name','location','city'].includes(key))continue;
  // getEventDisplayName uses the family name in preference to event_name;
  // requiring both spellings prevented many otherwise complete documents.
  if(key==='event_name'&&event.family_name&&options.requireEventName!==true)continue;
  if(options.includeServices===false&&key.endsWith('_services_title'))continue;
  if(key==='standalone_services_title'&&!eventServices.some(es=>
    !es.is_external&&!es.is_package_main_item&&!es.parent_package_event_service_id&&!es.package_id))continue;
  if(key==='external_services_title'&&(options.includeExternalServices===false||
    !eventServices.some(es=>es.is_external)))continue;
  e[key]=field('Event',event.id,key,event[key],'event.'+key);
 }
 e.__english_concept=approvedField(index,'Event',event.id,'concept',event.concept)||
   indexedText(index,'identifier',event.concept)||approvedPlace(event.concept)||null;
 if(event.notes&&options.includeEventNotes!==false)
   e.notes=field('Event',event.id,'notes',event.notes,'event.notes');
 if(event.discount_reason&&options.includeFinancialSummary!==false)
   e.discount_reason=field('Event',event.id,'discount_reason',event.discount_reason,'event.discount_reason');
 // Custom event values can be rendered through organizer title templates.
 // Translate values only; the original field IDs must remain byte-for-byte.
 if(options.includeEventHeader!==false && typeof event.custom_organizer_fields==='string'&&event.custom_organizer_fields.trim()){
   try{
     const original=JSON.parse(event.custom_organizer_fields);
     if(original&&typeof original==='object'&&!Array.isArray(original)){
       const translated:any={...original};
       for(const [key,value] of Object.entries(original)){
         if(typeof value==='string'&&isHebrew(value))
           translated[key]=field('Event',event.id,'custom_'+key,value,'event.custom_'+key);
       }
       e.custom_organizer_fields=JSON.stringify(translated);
     }
   }catch{missing.add('event.custom_organizer_fields');}
 }
 if(Array.isArray(event.schedule)&&options.includeSchedule!==false){
   e.schedule=event.schedule.map((item:any,i:number)=>({...item,
     activity:field('Event',event.id,'schedule_'+i+'_activity',item.activity,'event.schedule_'+i+'_activity'),
     notes:field('Event',event.id,'schedule_'+i+'_notes',item.notes,'event.schedule_'+i+'_notes')
   }));
 }
 if(options.includeContacts!==false){
   if(Array.isArray(event.parents)){
     e.parents=event.parents.map((p:any,i:number)=>{
       const id=String(p.id||i);
       return {...p,name:field('Event',event.id,'contact_'+id+'_name',p.name,
         'event.contact_'+id+'_name')};
     });
   }
   if(event.contacts_schema_version!==2&&event.organizer_contacts){
     try{
       const contacts=typeof event.organizer_contacts==='string'?
         JSON.parse(event.organizer_contacts):event.organizer_contacts;
       if(Array.isArray(contacts)){
         const translated=contacts.map((p:any,i:number)=>({...p,
           name:field('Event',event.id,'organizer_contact_'+String(p.id||i)+'_name',p.name,
             'event.organizer_contact_'+String(p.id||i)+'_name')
         }));
         e.organizer_contacts=JSON.stringify(translated);
       }
     }catch{missing.add('event.organizer_contacts');}
   }
 }
 // Old events may still render extra organizer_contacts alongside parents.
 // Those contact names must also be translated before an English quote is issued.
 if(options.includeContacts!==false&&event.contacts_schema_version!==2){
   const contactKey=event.organizer_contacts?'organizer_contacts':
     event.organizercontacts?'organizercontacts':null;
   if(contactKey){
     try{
       const contacts=typeof event[contactKey]==='string'?
         JSON.parse(event[contactKey]):event[contactKey];
       if(Array.isArray(contacts)){
         const localized=contacts.map((contact:any,i:number)=>({
           ...contact,name:field('Event',event.id,
             'organizer_contact_'+String(contact.id||i)+'_name',contact.name,
             'event.organizer_contact_'+String(contact.id||i)+'_name')
         }));
         e[contactKey]=typeof event[contactKey]==='string'?
           JSON.stringify(localized):localized;
       }
     }catch{missing.add('event.'+contactKey);}
   }
 }
 // Catalog text is a fallback, not a second client-visible copy. Event
 // snapshots may deliberately contain fully English, customized names and
 // descriptions while the current catalog still contains Hebrew. Requiring
 // unrelated catalog translations would wrongly block those quotes.
 const requiredCatalog=new Map<string,Set<string>>();
 if(options.includeServices!==false)for(const es of eventServices){
   if(es.is_external&&options.includeExternalServices===false)continue;
   if(!es.service_id)continue;
   const needed=requiredCatalog.get(es.service_id)||new Set<string>();
   const visibleName=es.is_package_main_item?
     (es.package_name||es.service_name):es.service_name;
   if(!visibleName)needed.add('service_name');
   const visibleDescription=es.is_package_main_item?
     (es.package_description||es.service_description):es.service_description;
   // A missing field inherits catalog data via object spread, and external
   // services also display details.service_description as a fallback. An
   // explicitly empty description in a standalone service is not printed.
   const canFallbackDescription=es.is_external||es.service_description===undefined;
   if(options.includeDescriptions!==false&&!visibleDescription&&canFallbackDescription)
     needed.add('service_description');
   requiredCatalog.set(es.service_id,needed);
 }
 const translatedServices=options.includeServices===false?services:services.map(s=>{
   const needed=requiredCatalog.get(s.id);
   return !needed||!needed.size?s:({
     ...s,
     service_name:needed.has('service_name')?
       field('Service',s.id,'service_name',s.service_name,'catalog.'+s.id+'.service_name'):s.service_name,
     service_description:needed.has('service_description')?
       field('Service',s.id,'service_description',s.service_description,'catalog.'+s.id+'.service_description'):s.service_description
   });
 });
 const translatedEventServices=eventServices.map(es=>{
   if(options.includeServices===false||es.is_external&&options.includeExternalServices===false)return es;
   const serviceId=es.service_id;
   const result={...es};
   // Translate only data actually displayed by the quote renderer. Old
   // EventService rows keep package_description snapshots even on ordinary
   // services and child items, which the renderer does not show.
   const legacyPackage=!!es.package_id&&!es.parent_package_event_service_id;
   const visibleTextFields=es.is_package_main_item?[
     es.package_name?'package_name':'service_name',
     es.package_description?'package_description':'service_description',
     'client_notes','price_display_text'
   ]:[
     'service_name','service_description',
     ...(legacyPackage?['package_name','package_description']:[]),
     'client_notes','price_display_text'
   ];
   for(const key of visibleTextFields){
     if((key==='service_description'||key==='package_description')&&options.includeDescriptions===false)continue;
     if(key==='client_notes'&&options.includeClientNotes===false)continue;
     if(key==='price_display_text'&&es.price_display_mode!=='custom_text')continue;
     if(es[key]!==null&&es[key]!==undefined)
       result[key]=field('EventService',es.id,key,es[key],'service.'+es.id+'.'+key,serviceId);
   }
   // Public transport details are embedded in the quote, including names
   // and pickup points. Keep their sequence, times and phone numbers intact.
   const category=es.category||services.find(s=>s.id===serviceId)?.category;
   const showTransport=options.includeTransportDetails!==false&&category==='נסיעות';
   if(showTransport&&typeof es.pickup_point==='string' && es.pickup_point.trim()){
     try{
       const units=JSON.parse(es.pickup_point);
       if(Array.isArray(units))result.pickup_point=JSON.stringify(units.map((unit:any,u:number)=>({
         ...unit,pickupPoints:(unit.pickupPoints||[]).map((point:any,p:number)=>({
           ...point,
           location:field('EventService',es.id,'pickup_'+u+'_'+p+'_location',point.location,
             'service.pickup_'+u+'_'+p+'_location'),
           contact:point.contact?{...point.contact,
             name:field('EventService',es.id,'pickup_'+u+'_'+p+'_contact',point.contact.name,
               'service.pickup_'+u+'_'+p+'_contact')}:point.contact
         }))
       })));
     }catch{
       result.pickup_point=field('EventService',es.id,'pickup_point',es.pickup_point,'service.pickup_point');
     }
   }
   if(showTransport&&es.on_site_contact_details && typeof es.on_site_contact_details==='object'){
     result.on_site_contact_details={...es.on_site_contact_details,
       name:field('EventService',es.id,'on_site_contact_name',es.on_site_contact_details.name,
         'service.on_site_contact_name')};
   }
   // EventService.notes and admin_notes are internal; the quote renderer only
   // prints client_notes. Requiring translations of internal supplier notes
   // previously blocked English client documents for no reason.
   return result;
 });
 const requiredIds=Array.isArray(options.requiredTemplateIds)?new Set(options.requiredTemplateIds):null;
 const translatedTemplates=templates.map(t=>({
  ...t,
  content:requiredIds&&!requiredIds.has(t.id)?t.content:
    field('QuoteTemplate',t.id,'content',t.content,'template.'+t.id+'.content')
 }));
 return {event:e,services:translatedServices,eventServices:translatedEventServices,
   templates:translatedTemplates,missing};
}
