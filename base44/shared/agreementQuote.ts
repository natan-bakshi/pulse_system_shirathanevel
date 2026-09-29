// Compact client-facing snapshot. Never includes supplier costs or internal notes.
const number=v=>Number.isFinite(Number(v))?Number(v):0;
export function agreementQuote(event,financials,language="he"){
 const services=financials.services||[],rows=[],seen=new Set();
 const label=s=>s.service_name||s.package_name||"שירות";
 const item=s=>({name:label(s),quantity:number(s.quantity)||1});
 for(const s of services){
  if(s.is_external||s.parent_package_event_service_id)continue;
  if(s.is_package_main_item){
   rows.push({kind:"package",name:s.package_name||label(s),quantity:number(s.quantity)||1,price:number(s.custom_price),currency:s.currency||financials.currency,includes_vat:!!s.includes_vat,children:services.filter(c=>c.parent_package_event_service_id===s.id&&!c.is_external).map(item)});
  }else if(s.package_id){
   if(seen.has(s.package_id))continue;seen.add(s.package_id);
   rows.push({kind:"package",name:s.package_name||"חבילת הפקה",quantity:1,price:number(s.package_price),currency:s.currency||financials.currency,includes_vat:!!s.package_includes_vat,children:services.filter(c=>c.package_id===s.package_id&&!c.is_external).map(item)});
  }else rows.push({...item(s),kind:"service",price:number(s.custom_price),currency:s.currency||financials.currency,includes_vat:!!s.includes_vat});
 }
 const history=[...(event.quote_history||[])].filter(q=>q.file_uri).sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
 const latest=history[0];
 const allInclusive=event.all_inclusive===true||event.all_inclusive==="true";
 const visibleRows=allInclusive?rows.map(({price,currency,includes_vat,...details})=>details):rows;
 const summary={rows:visibleRows,all_inclusive:allInclusive,currency:financials.currency,total:financials.finalTotal,paid:financials.totalPaid,balance:financials.balance,discount:financials.discountAmount,
  pricing_note:allInclusive||number(event.total_override)!==0||event.is_price_per_guest?(language==="en"?"The binding price is the total shown in the financial summary according to the event pricing.":"המחיר הקובע הוא המחיר הכולל בסיכום הכספי, בהתאם לתמחור האירוע."):""};
 const en=language==="en";
 const quote=visibleRows.map(r=>r.name+" × "+r.quantity+(allInclusive?"":" — "+r.price+" "+r.currency+(r.includes_vat?(en?" incl. VAT":" כולל מע״מ"):(en?" before VAT":" לפני מע״מ")))+(r.children?.length?"\n"+r.children.map(c=>"  "+c.name+" × "+c.quantity).join("\n"):"")).join("\n")+"\n"+(allInclusive?(en?"All-inclusive price (including VAT): ":"מחיר הכל כלול (כולל מע״מ): "):(en?"Total including VAT: ":"סה״כ כולל מע״מ: "))+summary.total+" "+summary.currency+"\n"+(en?"Discount: ":"הנחה: ")+summary.discount+"\n"+(en?"Paid: ":"שולם: ")+summary.paid+"\n"+(en?"Balance: ":"יתרה: ")+summary.balance;
 return {summary,quote,quoteFile:latest?{file_uri:latest.file_uri,file_name:latest.file_name||"הצעת מחיר.pdf",created_at:latest.created_at||""}:null};
}