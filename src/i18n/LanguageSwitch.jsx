import React from 'react';
import {useLanguage} from './LanguageProvider';
import {Globe2} from 'lucide-react';

// One compact native control. No settings pages, dialogs or extra navigation.
export default function LanguageSwitch(){
 const {locale,setLocale,t}=useLanguage();
 return <label className="inline-flex items-center rounded-md border border-white/30 bg-white/10 text-white px-1.5 gap-1 max-w-[88px]" title={t('שפת הממשק')}>
  <Globe2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>
  <select value={locale} onChange={event=>setLocale(event.target.value)}
    className="bg-transparent text-white text-xs font-semibold cursor-pointer outline-none py-2 min-w-0 w-10"
    aria-label={t('שפת הממשק')}>
    <option className="text-gray-900" value="he">עב</option>
    <option className="text-gray-900" value="en">EN</option>
  </select>
 </label>;
}
