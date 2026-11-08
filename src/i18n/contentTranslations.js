// ContentTranslation records are admin-only and must be read only from an
// authorized screen. This helper is pure; it never mutates catalog entries.
export function exactEnglishField(row,field,source){
  if(!row || row.locale!=='en' || row.status!=='approved')return null;
  const pair=row.fields?.[field];
  if(!pair || typeof pair.source!=='string'||typeof pair.value!=='string')return null;
  return pair.source===source && pair.value.trim() ? pair.value : null;
}
export function indexTranslations(rows=[]){
 const index=new Map();
 for(const row of rows){
  if(!row||!row.source_entity||!row.source_id||row.locale!=='en')continue;
  index.set(row.source_entity+':'+row.source_id,row);
 }
 return index;
}
export function translatedValue(index,entity,row,field,locale='he'){
 const source=row?.[field];
 if(locale!=='en'||!row||source===undefined||source===null)return source;
 const record=index.get(entity+':'+row.id);
 return exactEnglishField(record,field,source)??source;
}
export const freshEnglish= (row,sourceField,sourceValue)=>
 exactEnglishField(row,sourceField,sourceValue)!==null;
