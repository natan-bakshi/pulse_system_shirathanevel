import React, {createContext,useContext,useEffect,useMemo,useState} from 'react';
import {translateLabel} from './dictionary';

export const supportedLocales = Object.freeze(['he','en']);
export const normalizeLocale = value => value === 'en' ? 'en' : 'he';
const LocaleContext = createContext({locale:'he',setLocale:()=>{},t:value=>value});
const KEY='pulse_interface_locale_v1';
function getInitialLocale(){
  if(typeof window==='undefined')return 'he';
  try{return normalizeLocale(window.localStorage.getItem(KEY));}catch{return 'he';}
}
export function LanguageProvider({children}){
  const [locale,setLocaleState]=useState(getInitialLocale);
  const setLocale=value=>setLocaleState(normalizeLocale(value));
  useEffect(()=>{
    try{window.localStorage.setItem(KEY,locale);}catch{}
    // A semantic language hint only. Layout controls its own direction; do not
    // flip legacy CSS or payment/closing pages through document-level mutation.
    document.documentElement.lang=locale;
  },[locale]);
  const context=useMemo(()=>({
    locale,dir:locale==='en'?'ltr':'rtl',setLocale,
    t:(key)=>translateLabel(key,locale)
  }),[locale]);
  return <LocaleContext.Provider value={context}>{children}</LocaleContext.Provider>;
}
export function useLanguage(){return useContext(LocaleContext);}
