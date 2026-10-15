import {base44} from '@/api/base44Client';
import {refreshEventStatus} from '@/lib/eventStatus';

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
// Save already succeeded. Both backend checks are independent: waiting for one
// before starting the other only increases time spent in the supplier dialog.
// A notification failure must never be labelled a failed assignment save.
export async function verifyAndRefreshAssignment(eventServiceId, supplierIds, eventId){
  const [delivery, status] = await Promise.allSettled([
    verifyAssignmentWhatsApp(eventServiceId,supplierIds),
    refreshEventStatus(eventId)
  ]);
  const report=delivery.status==='fulfilled'?delivery.value:
    {success:false,error:'בדיקת תור WhatsApp נכשלה'};
  showAssignmentWhatsAppWarning(report);
  if(status.status==='rejected'){
    console.warn('[Assignments] event status refresh pending');
    window.alert('השיבוץ נשמר, אבל עדכון סטטוס האירוע טרם אושר. כדאי לרענן את האירוע.');
  }
  return {delivery:report,statusUpdated:status.status==='fulfilled'};
}
export function showAssignmentWhatsAppWarning(report){
  if(report?.success)return;
  window.alert('השיבוץ נשמר במערכת, אבל לא התקבל אישור שהודעת WhatsApp הוכנסה לתור.\n'+
    'יש לבדוק את ספק ה־WhatsApp ואת תור ההודעות ולא להניח שהספק קיבל הודעה.\n\n'+
    String(report?.error||'יצירת ההודעה נכשלה').slice(0,400));
}
