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
    if(row?.locale==='en'&&row.status==='approved'&&row.source_entity&&row.source_id)
      index.set(row.source_entity+':'+row.source_id,row);
  }
  return index;
}
export async function loadQuoteTranslations(client:any,locale:unknown){
  if(localeForQuote(locale)!=='en')return new Map<string,any>();
  const rows=await client.asServiceRole.entities.ContentTranslation.filter({
    locale:'en',status:'approved'
  },'-updated_date',500);
  return translationIndex(rows);
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
  // Fallback for old, copied quote-item snapshots which contain a catalog text
  // but not its original catalog item ID. Reject colliding translations.
  const matches=new Set<string>();
  for(const [key,row] of index){
    if(!/^(Service|Package|QuoteTemplate):/.test(key))continue;
    const pair=row?.fields?.[field];
    if(pair?.source===source&&typeof pair.value==='string'&&pair.value.trim()&&
      translationPreservesProtectedContent(source,pair.value))matches.add(pair.value);
  }
  return matches.size===1?[...matches][0]:null;
}
const labels=new Map<string,string>([
  ['תאריך הפקה','Issue Date'],['כמות','Quantity'],
  ['כמות משתתפים','Number of Guests'],['כמות מוזמנים','Number of Guests'],
  ['שמות ההורים',"Parents' Names"],['עיר מגורים','City of Residence'],
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
  ['החבילה כוללת','Package Inclusions'],
  ['בר מצווה','Bar Mitzvah'],['בת מצווה','Bat Mitzvah'],
  ['חתונה','Wedding'],['אירוע','Event']
]);
export function fixedEnglishLabel(value:unknown):string{
  const source=String(value??'');
  const clean=source.trim();
  return labels.get(clean)??source;
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
    const discount=value.match(/^הנחה(\s*\([^()<>]*\))?:$/);
    if(discount)return '>'+leading+'Discount'+(discount[1]||'')+':'+trailing+'<';
    return '>'+text+'<';
  });
}
export function applyDocumentDirection(html:string,locale:unknown):string{
  if(localeForQuote(locale)!=='en')return html;
  const ltrCss='<style data-quote-locale="en">html,body{direction:ltr;text-align:left} .page-content{direction:ltr} .section,.event-details-box,.package-content,.intro-content,.payment-terms,.event-notes{text-align:left;direction:ltr} .package-content{padding-left:15px!important;padding-right:0!important} .summary-table{direction:ltr} .summary-table td.label{text-align:left} .summary-table td.value{text-align:right}</style>';
  return localizeVisibleHtmlLabels(html.replace(/<html([^>]*)>/i,(_x,attrs)=>
    '<html'+attrs.replace(/\s+dir="[^"]*"/,'').replace(/\s+lang="[^"]*"/,'')+' lang="en" dir="ltr">')
    .replace('</head>',ltrCss+'</head>'));
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
 ['ממילא','Mamilla'],['יפו העתיקה','Old Jaffa'],
 ['זכרון יעקב','Zichron Yaakov'],['הר ציון','Mount Zion'],
 ['קבר דוד המלך',"King David's Tomb"],['הרובע היהודי','Jewish Quarter'],
 ['מונטיפיורי','Montefiore'],['דוד המלך','King David']
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
  'services_section_title','standalone_services_title','external_services_title'])
  e[key]=field('Event',event.id,key,event[key],'event.'+key);
 e.__english_concept=approvedField(index,'Event',event.id,'concept',event.concept)||
   indexedText(index,'identifier',event.concept)||approvedPlace(event.concept)||null;
 if(event.notes)e.notes=field('Event',event.id,'notes',event.notes,'event.notes');
 if(event.discount_reason)e.discount_reason=field('Event',event.id,'discount_reason',event.discount_reason,'event.discount_reason');
 // Custom event values can be rendered through organizer title templates.
 // Translate values only; the original field IDs must remain byte-for-byte.
 if(typeof event.custom_organizer_fields==='string'&&event.custom_organizer_fields.trim()){
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
 if(Array.isArray(event.parents)){
   e.parents=event.parents.map((p:any,i:number)=>{
     const id=String(p.id||i);
     return {...p,name:field('Event',event.id,'contact_'+id+'_name',p.name,
       'event.contact_'+id+'_name')};
   });
 }
 const translatedServices=services.map(s=>({
  ...s,
  service_name:field('Service',s.id,'service_name',s.service_name,'catalog.service_name'),
  service_description:field('Service',s.id,'service_description',s.service_description,'catalog.service_description')
 }));
 const translatedEventServices=eventServices.map(es=>{
   if(es.is_external&&options.includeExternalServices===false)return es;
   const serviceId=es.service_id;
   const result={...es};
   for(const key of ['service_name','service_description','package_name','package_description',
      'client_notes','price_display_text']){
     if(es[key]!==null&&es[key]!==undefined)
       result[key]=field('EventService',es.id,key,es[key],'service.'+key,serviceId);
   }
   // Public transport details are embedded in the quote, including names
   // and pickup points. Keep their sequence, times and phone numbers intact.
   if(typeof es.pickup_point==='string' && es.pickup_point.trim()){
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
   if(es.on_site_contact_details && typeof es.on_site_contact_details==='object'){
     result.on_site_contact_details={...es.on_site_contact_details,
       name:field('EventService',es.id,'on_site_contact_name',es.on_site_contact_details.name,
         'service.on_site_contact_name')};
   }
   // Notes can be client-facing in the established price/notes renderer. 
   // Never blindly translate or expose internal admin_notes.
   if(es.notes)
     result.notes=field('EventService',es.id,'notes',es.notes,'service.notes',serviceId);
   return result;
 });
 const translatedTemplates=templates.map(t=>({
  ...t,
  content:field('QuoteTemplate',t.id,'content',t.content,'template.'+t.template_type)
 }));
 return {event:e,services:translatedServices,eventServices:translatedEventServices,
   templates:translatedTemplates,missing};
}
