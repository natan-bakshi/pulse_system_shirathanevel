import React,{useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {useLanguage} from '@/i18n/LanguageProvider';

// Public quote viewer follows the QUOTE language, not the viewer's UI setting.
export default function ModularQuoteView() {
  const {t: uiTranslate}=useLanguage();
  const token=new URLSearchParams(window.location.search).get('quote');
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [pdf,setPdf]=useState('');
  const english=data?.document_language==='en';

  useEffect(()=>{
    let active=true;
    setData(null);setError('');setPdf('');
    async function load(){
      try{
        const response=await base44.functions.invoke('modularQuote',{action:'view',token});
        if(response.data?.error)throw new Error(response.data.error);
        if(active)setData(response.data);
      }catch(e){
        if(active)setError(e.response?.data?.error||'ההצעה אינה זמינה או שהקישור אינו תקין');
      }
    }
    load();
    return()=>{active=false;};
  },[token]);

  async function download(){
    setBusy(true);
    try{
      const response=await base44.functions.invoke('modularQuote',{action:'download',token});
      if(!response.data?.signed_url)throw new Error();
      setPdf(response.data.signed_url);
    }catch{
      setError(english?'The PDF cannot be downloaded right now.':'לא ניתן להוריד את הקובץ כרגע');
    }finally{setBusy(false);}
  }

  return <div dir={english?'ltr':'rtl'} lang={english?'en':'he'} className="min-h-screen bg-background text-foreground">
    {!data&&!error&&<p className="text-center p-8" role="status">{uiTranslate("טוען הצעה…")}</p>}
    {error&&<p className="text-center p-6 text-destructive" role="alert">{error}</p>}
    {data&&<>
      {data.has_pdf&&<div className="max-w-4xl mx-auto p-3 flex justify-end">
        {pdf?<Button asChild><a href={pdf} download target="_blank" rel="noreferrer">{english?'Open / Download PDF':'פתח / הורד PDF'}</a></Button>:
          <Button disabled={busy} onClick={download}>{busy?(english?'Preparing File…':'מכין קובץ…'):(english?'Download PDF':'הורד PDF')}</Button>}
      </div>}
      <iframe title={english?'Quotation':'הצעת המחיר'} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={data.html}
        className="block w-full min-h-screen border-0" style={{height:'100vh'}}/>
    </>}
  </div>;
}