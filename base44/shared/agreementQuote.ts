// Compact client-facing quotation snapshot. Never includes supplier costs,
// customer phone lists or internal notes. English names come exclusively from
// approved exact-source translations, never from uncontrolled machine output.
import {translateOrMissing} from './quoteLocalization.ts';
const number=(v:any)=>Number.isFinite(Number(v))?Number(v):0;
export function agreementQuote(event:any,financials:any,language='he',
 index:Map<string,any>=new Map(),missing:Set<string>=new Set()){
 const services=financials.services||[],rows:any[]=[],seen=new Set();
 const english=language==='en';
 const name=(s:any,field:string,raw:string)=>{
  const source=String(raw||'');
  return english?translateOrMissing(index,'EventService',String(s.id||''),field,
   source,missing,'event_service.'+String(s.id||'unknown')+'.'+field):source;
 };
 const label=(s:any)=>s.service_name
  ?name(s,'service_name',s.service_name)
  :s.package_name?name(s,'package_name',s.package_name)
  :(english?'Service':'שירות');
 const item=(s:any)=>({name:label(s),quantity:number(s.quantity)||1});
 for(const s of services){
  if(s.is_external||s.parent_package_event_service_id)continue;
  if(s.is_package_main_item){
   rows.push({kind:'package',
    name:s.package_name?name(s,'package_name',s.package_name):label(s),
    quantity:number(s.quantity)||1,price:number(s.custom_price),
    currency:s.currency||financials.currency,includes_vat:!!s.includes_vat,
    children:services.filter((c:any)=>c.parent_package_event_service_id===s.id&&!c.is_external).map(item)});
  }else if(s.package_id){
   if(seen.has(s.package_id))continue;seen.add(s.package_id);
   rows.push({kind:'package',
    name:s.package_name?name(s,'package_name',s.package_name):english?'Production Package':'חבילת הפקה',
    quantity:1,price:number(s.package_price),currency:s.currency||financials.currency,
    includes_vat:!!s.package_includes_vat,
    children:services.filter((c:any)=>c.package_id===s.package_id&&!c.is_external).map(item)});
  }else rows.push({...item(s),kind:'service',price:number(s.custom_price),
   currency:s.currency||financials.currency,includes_vat:!!s.includes_vat});
 }
 const history=[...(event.quote_history||[])].filter((q:any)=>q?.file_uri)
  .sort((a:any,b:any)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
 // Historical quote history has no locale metadata, so an English agreement
 // must not quietly attach an unverified Hebrew PDF. A new English PDF gets
 // explicit document_language metadata at the moment of generation.
 const latest=history.find((q:any)=>english?q.document_language==='en':
   q.document_language!=='en');
 const quoteFile=latest?{file_uri:latest.file_uri,
  file_name:latest.file_name||(english?'Quotation.pdf':'הצעת מחיר.pdf'),
  created_at:latest.created_at||'',document_language:latest.document_language||'unknown'}:null;
 const allInclusive=event.all_inclusive===true||event.all_inclusive==='true';
 const visibleRows=allInclusive?rows.map(({price,currency,includes_vat,...rest})=>rest):rows;
 const summary={rows:visibleRows,all_inclusive:allInclusive,currency:financials.currency,
  total:financials.finalTotal,paid:financials.totalPaid,balance:financials.balance,
  discount:financials.discountAmount,
  pricing_note:allInclusive||number(event.total_override)!==0||event.is_price_per_guest
   ?(english?'The total in the financial summary is the agreed event price.':
     'המחיר הקובע הוא המחיר הכולל בסיכום הכספי, בהתאם לתמחור האירוע.') :''};
 const quote=visibleRows.map(r=>r.name+' × '+r.quantity+
  (allInclusive?'':' — '+r.price+' '+r.currency+
   (r.includes_vat?(english?' incl. VAT':' כולל מע״מ'):(english?' before VAT':' לפני מע״מ')))+
  (r.children?.length?'\n'+r.children.map((c:any)=>'  '+c.name+' × '+c.quantity).join('\n'):'')
 ).join('\n')+'\n'+(allInclusive
  ?(english?'All-inclusive price (including VAT): ':'מחיר הכל כלול (כולל מע״מ): ')
  :(english?'Total including VAT: ':'סה״כ כולל מע״מ: '))+
  summary.total+' '+summary.currency+'\n'+(english?'Discount: ':'הנחה: ')+
  summary.discount+'\n'+(english?'Paid: ':'שולם: ')+summary.paid+
  '\n'+(english?'Balance: ':'יתרה: ')+summary.balance;
 return {summary,quote,quoteFile};
}
