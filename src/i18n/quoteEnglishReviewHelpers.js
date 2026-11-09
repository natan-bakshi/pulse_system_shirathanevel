// Admin-only English quote editor helpers. Never modify a Hebrew source record.
const he=/[\u0590-\u05ff]/;
const decode=s=>String(s||'').replace(/&(?:nbsp|rlm|lrm);/gi,' ')
 .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
 .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_m,hex,dec)=>{
  const n=parseInt(hex||dec,hex?16:10);
  return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
 });
const clean=s=>decode(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().normalize('NFC');

export function matchesResidualEnglishSample(value,samples=[]){
 if(typeof value!=='string'||!value.trim())return false;
 const text=clean(value);
 return (samples||[]).some(sample=>{
  const fragment=clean(sample);
  return he.test(fragment)&&fragment.length>=2&&text.includes(fragment);
 });
}

// Only full text nodes can be replaced; no attributes, HTML, amounts or tags
// are blindly rewritten. Longer untranslated source content stays in the
// editable full text field for review, rather than being silently shortened.
export function hebrewTextNodesInTranslation(value){
 if(typeof value!=='string'||!he.test(value))return [];
 const nodes=/</.test(value)?[...value.matchAll(/>([^<>]*)</g)].map(x=>x[1]):[value];
 return [...new Set(nodes.map(s=>s.trim()).filter(s=>s&&
  he.test(decode(s).replace(/\[[^\[\]]{1,150}\]/g,' ')
    .replace(/\{\{[^{}]+\}\}/g,' '))))].slice(0,10);
}

export function substituteExactHebrewTextNode(current,original,english){
 const target=String(english||'').trim();
 if(!target||he.test(decode(target))||/[<>]/.test(target)||!original)return null;
 const escaped=target.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
 if(!/<[^>]+>/.test(current))return current.trim()===original?escaped:null;
 let count=0;
 const revised=current.replace(/>([^<>]*)</g,(all,inside)=>{
  if(inside.trim()!==original)return all;
  count++;
  const lead=inside.match(/^\s*/)?.[0]||'',trail=inside.match(/\s*$/)?.[0]||'';
  return '>'+lead+escaped+trail+'<';
 });
 return count?revised:null;
}
