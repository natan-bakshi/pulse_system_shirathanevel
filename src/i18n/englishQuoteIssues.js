// Error adapter used by preview, PDF and share. No backend call is made here.
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
       (status===422&&/English quote has|untranslated or outdated/i.test(message))){
      return [...new Set((fields||[]).filter(x=>typeof x==='string'&&x.length<200))];
    }
  }
  return null;
}
