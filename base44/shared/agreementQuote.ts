// Compact client-facing snapshot. Never includes supplier costs or internal notes.
const number=v=>Number.isFinite(Number(v))?Number(v):0;
export function agreementQuote(event,financials){
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
 const summary={rows,currency:financials.currency,total:financials.finalTotal,paid:financials.totalPaid,balance:financials.balance,discount:financials.discountAmount,
  pricing_note:event.all_inclusive||number(event.total_override)!==0||event.is_price_per_guest?"המחיר הקובע הוא המחיר הכולל בסיכום הכספי, בהתאם לתמחור האירוע.":""};
 const quote=rows.map(r=>r.name+" × "+r.quantity+" — "+r.price+" "+r.currency+(r.includes_vat?" כולל מע״מ":" לפני מע״מ")+(r.children?.length?"\n"+r.children.map(c=>"  "+c.name+" × "+c.quantity).join("\n"):"")).join("\n")+"\nסה״כ כולל מע״מ: "+summary.total+" "+summary.currency+"\nהנחה: "+summary.discount+"\nשולם: "+summary.paid+"\nיתרה: "+summary.balance;
 return {summary,quote,quoteFile:latest?{file_uri:latest.file_uri,file_name:latest.file_name||"הצעת מחיר.pdf",created_at:latest.created_at||""}:null};
}
