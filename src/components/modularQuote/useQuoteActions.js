import {useState} from 'react';
import {base44} from '@/api/base44Client';
import {toast} from 'sonner';
export async function quoteRequest(payload){const res=await base44.functions.invoke('modularQuote',payload);if(res.data?.error)throw new Error(res.data.error);return res.data;}
export default function useQuoteActions({quote,title,content,onSaved}) {
  const [busy,setBusy]=useState('');const [id,setId]=useState(quote?.id||'');const [html,setHtml]=useState('');const [link,setLink]=useState('');const [pdf,setPdf]=useState('');const [error,setError]=useState('');
  async function save(){const values={title:title.trim()||'הצעה מודולרית',content};if(id){const previous=await base44.entities.ModularQuote.get(id);if(JSON.stringify(previous.content)!==JSON.stringify(content)){values.last_pdf_uri='';values.last_pdf_name='';}}const saved=id?await base44.entities.ModularQuote.update(id,values):await base44.entities.ModularQuote.create(values);setId(saved.id);onSaved(saved);return saved.id;}
  async function run(action){setBusy(action);setError('');try{
    if(action==='preview'){const r=await quoteRequest({action:'preview',content});setHtml(r.html);}
    else {const savedId=await save();if(action==='save')toast.success('ההצעה נשמרה');
      if(action==='share'){const r=await quoteRequest({action:'share',id:savedId});setLink(r.url);toast.success('הקישור מוכן לשיתוף');}
      if(action==='pdf'){const r=await base44.functions.invoke('generateManualQuotePdf',{modularQuoteId:savedId});if(!r.data?.pdf_url)throw new Error(r.data?.error||'לא ניתן להפיק PDF');setPdf(r.data.pdf_url);onSaved({id:savedId});toast.success('ה־PDF מוכן להורדה ולשליחה');}
    }
  }catch(e){setError(e.message||'הפעולה נכשלה');}finally{setBusy('');}}
  return {busy,id,html,link,pdf,error,run,clearPreview:()=>{setHtml('');setPdf('');}};
}