// Error adapters for preview, PDF and share. No backend call is made here.
export function englishQuoteVisibleSamplesFromError(error) {
  const payload=error?.response?.data||error?.data||error;
  const samples=payload?.samples;
  if(!Array.isArray(samples))return [];
  return [...new Set(samples.filter(x=>typeof x==='string'&&
    /[\u0590-\u05ff]/.test(x)).map(x=>x.slice(0,640)))].slice(0,12);
}
export function englishQuoteIssuesFromError(error) {
  const candidates=[error?.response?.data,error?.data,error?.response,error];
  for(let payload of candidates){
    if(typeof payload==='string'){try{payload=JSON.parse(payload);}catch{continue;}}
    if(!payload||typeof payload!=='object')continue;
    const code=payload.code||payload.error?.code;
    const status=payload.status||payload.statusCode||error?.response?.status;
    const message=typeof payload.error==='string'?payload.error:
      typeof payload.message==='string'?payload.message:'';
    const fields=Array.isArray(payload.fields)?payload.fields:
      Array.isArray(payload.error?.fields)?payload.error.fields:null;
    if(code==='ENGLISH_TRANSLATION_INCOMPLETE'||
       (status===422&&fields)||
       (status===422&&/English quote has|untranslated or outdated|contains visible text that was not translated/i.test(message))){
      return [...new Set((fields||[]).filter(x=>typeof x==='string'&&x.length<200))];
    }
  }
  return null;
}
