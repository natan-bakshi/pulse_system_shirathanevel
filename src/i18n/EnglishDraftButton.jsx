import React,{useState} from 'react';
import {Languages,Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {externalEnglishEnabled,requestEnglishDraft} from '@/i18n/futureTranslationClient';

// Render only after a secure external endpoint has been configured.
// This never saves content or starts a translation unless clicked.
export default function EnglishDraftButton({source,kind,onDraft,compact=false}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!externalEnglishEnabled()||!source?.trim())return null;
 const run=async()=>{
  setBusy(true);setError('');
  try{const draft=await requestEnglishDraft({source,kind});onDraft(draft);}
  catch(err){setError(err.message||'Translation draft unavailable');}
  finally{setBusy(false);}
 };
 return <div className="space-y-1">
  <Button type="button" size="sm" variant="outline" disabled={busy}
   onClick={run} className="h-8 gap-1"
   title="The text is sent to your protected Cloudflare translator. Review before saving.">
    {busy?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Languages className="h-3.5 w-3.5"/>}
    {compact?'AI draft':'Suggest English wording'}
  </Button>
  {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
 </div>;
}
