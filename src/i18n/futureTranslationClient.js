// External translation helper. Calls the independent Cloudflare Worker directly;
// no Base44 integration credits or backend functions. This module is a no-op
// until the protected Worker URL is deliberately configured and tested.
import {translationPreservesProtectedContent} from '../../base44/shared/quoteLocalization.ts';

const endpoint=String(import.meta.env?.VITE_TRANSLATION_WORKER_URL||'').trim().replace(/\/$/,'');
export const externalEnglishEnabled=()=>{
 try{return !!endpoint && new URL(endpoint).protocol==='https:';}
 catch{return false;}
};
export class TranslationDraftError extends Error{
 constructor(message,code){super(message);this.code=code;}
}
export async function requestEnglishDraft({source,kind}){
 if(!externalEnglishEnabled())
  throw new TranslationDraftError('The external translator is not connected yet','not_configured');
 if(typeof source!=='string'||!source.trim())
  throw new TranslationDraftError('Enter the original Hebrew text first.','missing_source');
 if(source.length>2500)
  throw new TranslationDraftError('This text is too long for one free translation request.','too_long');
 const ctrl=new AbortController();
 const timeout=setTimeout(()=>ctrl.abort(),30000);
 try{
  const res=await fetch(endpoint+'/translate',{
   method:'POST',credentials:'include',mode:'cors',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({source,kind}),signal:ctrl.signal,redirect:'error'
  });
  const payload=await res.json().catch(()=>({}));
  if(!res.ok)throw new TranslationDraftError(
    typeof payload.error==='string'?payload.error:'Free translator unavailable',res.status);
  if(typeof payload.translation!=='string'||!payload.translation.trim()||
     payload.approved!==false||payload.reviewRequired!==true)
   throw new TranslationDraftError('Translator response is not a reviewable draft','invalid_response');
  // Ensure numbers/URLs/placeholders did not change. The Worker further
  // requires identical HTML tags and attributes.
  if(!translationPreservesProtectedContent(source,payload.translation))
   throw new TranslationDraftError('Draft changed protected source content','invalid_translation');
  return payload.translation;
 }catch(error){
  if(error.name==='AbortError')throw new TranslationDraftError('Free translator timed out','timeout');
  if(error instanceof TranslationDraftError)throw error;
  throw new TranslationDraftError('Cloudflare Access login or free translation service is unavailable','network');
 }finally{clearTimeout(timeout);}
}
