import React,{useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
export default function ModularQuoteView() {
  const token=new URLSearchParams(window.location.search).get('quote');
  const [data,setData]=useState(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [pdf,setPdf]=useState('');
  useEffect(()=>{let active=true;setData(null);setError('');async function load(){try{const r=await base44.functions.invoke('modularQuote',{action:'view',token});if(r.data?.error)throw new Error(r.data.error);if(active)setData(r.data);}catch(e){if(active)setError(e.response?.data?.error||'ההצעה אינה זמינה או שהקישור אינו תקין');}}load();return()=>{active=false;};},[token]);
  async function download(){setBusy(true);try{const r=await base44.functions.invoke('modularQuote',{action:'download',token});if(!r.data?.signed_url)throw new Error();setPdf(r.data.signed_url);}catch{setError('לא ניתן להוריד את הקובץ כרגע');}finally{setBusy(false);}}
  return <div dir="rtl" className="min-h-screen bg-background text-foreground">{!data&&!error&&<p className="text-center p-8" role="status">טוען הצעה…</p>}{error&&<p className="text-center p-6 text-destructive" role="alert">{error}</p>}{data&&<>{data.has_pdf&&<div className="max-w-4xl mx-auto p-3 flex justify-end">{pdf?<Button asChild><a href={pdf} download target="_blank" rel="noreferrer">פתח / הורד PDF</a></Button>:<Button disabled={busy} onClick={download}>{busy?'מכין קובץ…':'הורד PDF'}</Button>}</div>}<iframe title="הצעת המחיר" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={data.html} className="block w-full min-h-screen border-0" style={{height:'100vh'}}/></>}</div>;
}