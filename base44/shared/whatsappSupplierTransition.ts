// Shared transition rules for supplier dashboard and future signed WhatsApp responses.
// Does not authorize identities or mutate the database; caller must do both.
export type SupplierStatus = 'pending'|'confirmed'|'rejected';
export function normalizeSupplierStatus(status:unknown):SupplierStatus {
 if(status==='confirmed'||status==='rejected')return status;
 return 'pending';
}
export function supplierTransition(current:unknown,next:unknown,strictPending=false):{
 allowed:boolean;changed:boolean;reason:string;next:SupplierStatus|null}{
 if(!['pending','confirmed','rejected'].includes(String(next)))return {allowed:false,changed:false,reason:'invalid_status',next:null};
 const from=normalizeSupplierStatus(current);
 const to=next as SupplierStatus;
 if(from===to)return {allowed:true,changed:false,reason:'already_applied',next:to};
 if(strictPending&&from!=='pending')return {allowed:false,changed:false,reason:'stale_or_processed',next:null};
 return {allowed:true,changed:true,reason:'apply',next:to};
}
export function supplierAssigned(supplierIdsRaw:unknown,supplierId:string):boolean {
 try{
  const ids=typeof supplierIdsRaw==='string'?JSON.parse(supplierIdsRaw):supplierIdsRaw;
  return Array.isArray(ids)&&ids.includes(supplierId);
 }catch{return false;}
}
