import {base44} from '@/api/base44Client';

// Assignment saves are considered successful in the business database even if
// WhatsApp fails; report that distinction instead of pretending to have sent.
const list=(value)=>{
  if(Array.isArray(value))return value;
  try{const v=JSON.parse(String(value||'[]'));return Array.isArray(v)?v:[];}catch{return [];}
};
const statuses=value=>{
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  try{const v=JSON.parse(String(value||'{}'));return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}
};
export function newAssignmentRecipients(oldIds,newIds,oldStatuses={},newStatuses={}){
  const previous=new Set(list(oldIds));
  const before=statuses(oldStatuses);
  const after=statuses(newStatuses);
  return [...new Set(list(newIds).filter(id=>{
    if(!previous.has(id))return true;
    // Reinstating a previously rejected/confirmed supplier requires fresh approval.
    return after[id]==='pending' && !!before[id] && before[id]!=='pending';
  }))];
}
export async function verifyAssignmentWhatsApp(eventServiceId, supplierIds){
  if(!eventServiceId||!supplierIds?.length)return {success:true,requested:0};
  try{
    const r=await base44.functions.invoke('ensureAssignmentWhatsApp',{
      eventServiceId,newSupplierIds:supplierIds
    });
    const data=r?.data||{};
    if(data.success!==true)throw new Error(data.error||
      (Array.isArray(data.errors)?data.errors.join('; '):'הודעת WhatsApp לא נשמרה בתור'));
    return data;
  }catch(error){
    const detail=error?.response?.data?.error||
      (error?.response?.data?.errors||[]).join('; ')||
      error?.message||'תקלה לא ידועה';
    return {success:false,requested:supplierIds.length,error:detail};
  }
}
export function showAssignmentWhatsAppWarning(report){
  if(report?.success)return;
  window.alert('השיבוץ נשמר במערכת, אבל לא התקבל אישור שהודעת WhatsApp הוכנסה לתור.\n'+
    'יש לבדוק את ספק ה־WhatsApp ואת תור ההודעות ולא להניח שהספק קיבל הודעה.\n\n'+
    String(report?.error||'יצירת ההודעה נכשלה').slice(0,400));
}
