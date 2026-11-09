import React,{useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useLanguage} from './LanguageProvider';
import {Globe2,Loader2} from 'lucide-react';
import {base44} from '@/api/base44Client';

// Personal-area preference only; does not change customer document language.
export default function LanguageSwitch(){
 const {locale,setLocale,t}=useLanguage();
 const queryClient=useQueryClient();
 const [saving,setSaving]=useState(false);
 const [failed,setFailed]=useState(false);
 const inFlight=useRef(false);
 const change=async value=>{
  if(inFlight.current||value===locale||!['he','en'].includes(value))return;
  const previous=locale;
  inFlight.current=true;
  setFailed(false);setSaving(true);setLocale(value);
  try{
   await base44.auth.updateMe({preferred_language:value});
   queryClient.setQueryData(['currentUser'],old=>old?{...old,preferred_language:value}:old);
  }catch{
   setLocale(previous);setFailed(true);
  }finally{inFlight.current=false;setSaving(false);}
 };
 return <div className="space-y-2">
  <label className="inline-flex items-center gap-3 text-gray-800" htmlFor="pulse-account-language">
   <Globe2 className="h-5 w-5 text-gray-600 shrink-0" aria-hidden="true"/>
   <select id="pulse-account-language" value={locale}
     onChange={event=>change(event.target.value)} disabled={saving}
     className="rounded-md border border-gray-300 bg-white text-gray-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-red-700 disabled:opacity-60"
     aria-label={t('שפת המערכת')}>
     <option value="he" lang="he">עברית</option>
     <option value="en" lang="en">English</option>
   </select>
   {saving&&<Loader2 className="h-4 w-4 animate-spin" aria-label={t('שמירה')}/>}
  </label>
  {failed&&<p role="alert" className="text-xs text-red-700">{t('לא ניתן לשמור את שפת המערכת. נסה שוב.')}</p>}
 </div>;
}