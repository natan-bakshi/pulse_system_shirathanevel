import {translationPreservesProtectedContent} from '../../base44/shared/quoteLocalization.ts';

// Keep the existing Service / Package writes as the sole source of truth.
// This only writes a separate admin-restricted ContentTranslation record when
// an English field was explicitly edited.
export async function persistCatalogEnglish(base44,{
 entity,id,source,values,changed,loadedRecord
}){
 if(!id||!['Service','Package'].includes(entity))throw Error('Invalid catalog record');
 const touched=[...new Set(changed||[])];
 if(!touched.length)return {changed:false};
 const allowed=entity==='Service'
  ?new Set(['service_name','service_description'])
  :new Set(['package_name','package_description']);
 if(touched.some(field=>!allowed.has(field)))throw Error('Unknown English field');
 const found=await base44.entities.ContentTranslation.filter({
  source_entity:entity,source_id:id,locale:'en'
 });
 if(found.length>1)throw Error('Duplicate translation records need review');
 const row=found[0];
 if(loadedRecord && (row?.id!==loadedRecord.id||row?.updated_date!==loadedRecord.updated_date))
  throw Error('The English content was modified in another session. Reopen the editor.');
 if(!loadedRecord&&row)
  throw Error('The English content was created in another session. Reopen the editor.');
 const next={...(row?.fields||{})};
 for(const field of touched){
  const input=String(values[field]||'').trim();
  const original=String(source[field]||'');
  if(!input){delete next[field];continue;}
  if(!original.trim())throw Error('Save the Hebrew source before translating '+field);
  if(!translationPreservesProtectedContent(original,input))
   throw Error('English must retain the original numbers, URLs and placeholders: '+field);
  next[field]={source:original,value:input};
 }
 if(row){
  await base44.entities.ContentTranslation.update(row.id,{
   fields:next,status:'approved',provenance:'human_reviewed'
  });
 }else if(Object.keys(next).length){
  await base44.entities.ContentTranslation.create({
   source_entity:entity,source_id:id,locale:'en',fields:next,
   status:'approved',provenance:'human_reviewed'
  });
 }
 return {changed:true};
}
