// Per-supplier signed legacy WhatsApp assignment revision.
// A status decision about Supplier A must not invalidate Supplier B's
// still-pending signed action merely because EventService.updated_date changed.
// Written in the SAME EventService business update as ID/status transitions;
// unrelated price/calendar/note edits never rotate a supplier revision.
// Existing unsigned/legacy rows WITHOUT this marker keep the previous,
// conservative full-row timestamp rule. No mutation, I/O or provider access.
const ID=/^[A-Za-z0-9_-]{3,128}$/;
const REV=/^r[1-9][0-9]{0,12}$/;
const RETIRED='retired';
const STATUS=new Set(['pending','confirmed','rejected']);
const MAX_SUPPLIERS=80;
export const LEGACY_SUPPLIER_REPLY_FIELD='supplier_assignment_reply_revisions';
export function parseLegacySupplierReplyRevisions(raw:any):Record<string,string>{
 let v=raw;
 if(v==null||v==='')return {};
 if(typeof v==='string'){
  if(v.length>10000)throw Error('Invalid supplier reply revision map');
  try{v=JSON.parse(v);}catch{throw Error('Invalid supplier reply revision map');}
 }
 if(!v||typeof v!=='object'||Array.isArray(v)||
  Object.keys(v).length>MAX_SUPPLIERS||
  Object.entries(v).some(([id,rev])=>!ID.test(id)||
    (rev!==RETIRED&&!REV.test(String(rev)))))
  throw Error('Invalid supplier reply revision map');
 return v;
}
function list(raw:any):string[]{
 let x=raw;
 if(x==null||x==='')return [];
 if(typeof x==='string'){try{x=JSON.parse(x);}catch{throw Error('Invalid supplier_ids');}}
 if(!Array.isArray(x)||x.length>MAX_SUPPLIERS||
  x.some(id=>typeof id!=='string'||!ID.test(id))||
  new Set(x).size!==x.length)throw Error('Invalid supplier_ids');
 return x;
}
function statuses(raw:any):Record<string,string>{
 let x=raw;
 if(x==null||x==='')return {};
 if(typeof x==='string'){try{x=JSON.parse(x);}catch{throw Error('Invalid supplier_statuses');}}
 if(!x||typeof x!=='object'||Array.isArray(x)||
  Object.entries(x).some(([id,s])=>!ID.test(id)||!STATUS.has(String(s))))
  throw Error('Invalid supplier_statuses');
 return x;
}
function nextRevision(current:Record<string,string>,now:number){
 if(!Number.isFinite(now)||now<1)throw Error('Invalid revision clock');
 let n=Math.floor(now);
 for(const value of Object.values(current)){
  if(REV.test(value))n=Math.max(n,Number(value.slice(1))+1);
 }
 if(!Number.isSafeInteger(n)||n>9999999999999)throw Error('Revision clock overflow');
 return 'r'+n;
}
export function planLegacySupplierReplyRevisions(old:any,patch:any,
 now=Date.now()):Record<string,string>{
 if(!old||!patch||typeof patch!=='object')return {};
 if(!Object.prototype.hasOwnProperty.call(patch,'supplier_ids')&&
    !Object.prototype.hasOwnProperty.call(patch,'supplier_statuses')&&
    patch.is_external!==true)return {};
 const beforeIds=list(old.supplier_ids),beforeStatuses=statuses(old.supplier_statuses);
 const afterIds=patch.is_external===true?[]:
  list(patch.supplier_ids===undefined?old.supplier_ids:patch.supplier_ids);
 const afterStatuses=statuses(patch.supplier_statuses===undefined?
  old.supplier_statuses:patch.supplier_statuses);
 const beforeSet=new Set(beforeIds),afterSet=new Set(afterIds);
 const revisionMap=parseLegacySupplierReplyRevisions(old[LEGACY_SUPPLIER_REPLY_FIELD]);
 const next={...revisionMap};
 let touched=false;
 for(const id of new Set([...beforeIds,...afterIds])){
  const was=beforeSet.has(id),is=afterSet.has(id);
  const before=beforeStatuses[id]||'pending',after=afterStatuses[id]||'pending';
  if(was===is&&(!is||before===after))continue;
  touched=true;
  if(!is||after!=='pending')next[id]=RETIRED;
  else next[id]=nextRevision(next,now);
 }
 return touched?{[LEGACY_SUPPLIER_REPLY_FIELD]:JSON.stringify(next)}:{};
}
export function legacySupplierReplyRevision(service:any,supplierId:string):string|null|undefined{
 if(!ID.test(supplierId||''))return null;
 try{
  const revisions=parseLegacySupplierReplyRevisions(service?.[LEGACY_SUPPLIER_REPLY_FIELD]);
  const own=revisions[supplierId];
  if(own===RETIRED)return null;
  if(own!==undefined)return REV.test(own)?own:null;
  return undefined; // Legacy rows retain their original strict behavior.
 }catch{return null;}
}
