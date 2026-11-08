import React,{useState} from 'react';
import {base44} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';
import {useLanguage} from '@/i18n/LanguageProvider';
export default function QuoteWhatsAppButton({file}) {
  const {t,dir}=useLanguage();
  const [open,setOpen]=useState(false);const [phone,setPhone]=useState('');const [message,setMessage]=useState('מצורפת הצעת מחיר');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function send(e){
    e.preventDefault();setError('');
    const digits=phone.replace(/\D/g,'');
    if(!/^[+\d\s()-]+$/.test(phone)||digits.length<8||digits.length>15){setError(t('יש להזין מספר טלפון תקין, לדוגמה 0501234567 או מספר עם קידומת מדינה.'));return;}
    setBusy(true);
    try{
      const result=await base44.functions.invoke('WhatsApp_SendFile',{Phone:phone,FileUri:file.uri,FileName:file.name||'הצעת מחיר.pdf',Caption:message.trim()});
      if(!result.data?.success)throw new Error('שליחת הקובץ נכשלה. ניתן לנסות שוב.');
      setOpen(false);toast.success(t(result.data?.queued?'ה־PDF נשמר בתור WhatsApp לשליחה':'ה־PDF התקבל אצל ספק WhatsApp'));
    }catch{setError(t('שליחת הקובץ נכשלה. יש לבדוק את המספר וחיבור הוואטסאפ ולנסות שוב.'));}finally{setBusy(false);}
  }
  return <><Button variant="outline" onClick={()=>{setError('');setOpen(true);}}>{t('שלח PDF בוואטסאפ')}</Button><Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent dir={dir}><DialogHeader><DialogTitle>{t('שליחת הצעת המחיר בוואטסאפ')}</DialogTitle><DialogDescription>{t('ה־PDF שהופק יישלח כקובץ מצורף למספר שתזין.')}</DialogDescription></DialogHeader><form onSubmit={send} className="space-y-4"><p className="text-sm text-muted-foreground break-words">{file.name||'הצעת מחיר.pdf'}</p><div><Label htmlFor="quote-whatsapp-phone">{t('מספר וואטסאפ')}</Label><Input id="quote-whatsapp-phone" type="tel" dir="ltr" required autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="0501234567" disabled={busy}/></div><div><Label htmlFor="quote-whatsapp-message">{t('הודעה נלווית (רשות)')}</Label><Textarea id="quote-whatsapp-message" value={message} onChange={e=>setMessage(e.target.value)} disabled={busy}/></div>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>setOpen(false)}>{t('ביטול')}</Button><Button type="submit" disabled={busy}>{t(busy?'שולח…':'שלח PDF')}</Button></div></form></DialogContent></Dialog></>;
}