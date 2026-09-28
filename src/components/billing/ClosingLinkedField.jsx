import React, {useRef, useState} from "react";
import LinkedText from "./LinkedText";

export default function ClosingLinkedField({label,value,onChange,dir="rtl",rows=3}) {
  const [text,setText]=useState(""),[url,setUrl]=useState("");
  const area=useRef(null);
  const valid=/^https?:\/\/[^\s]+$/i.test(url.trim());
  const insert=()=>{
    if(!text.trim()||!valid)return;
    const start=area.current?.selectionStart??value.length,end=area.current?.selectionEnd??start;
    const addition=`[${text.trim()}](${url.trim()})`;
    onChange(value.slice(0,start)+addition+value.slice(end));
    setText("");setUrl("");
    requestAnimationFrame(()=>{area.current?.focus();area.current?.setSelectionRange(start+addition.length,start+addition.length);});
  };
  return <div className="space-y-2">
    <label className="block">{label}<textarea ref={area} dir={dir} rows={rows} className="block w-full border rounded p-2 bg-white mt-1" value={value} onChange={e=>onChange(e.target.value)}/></label>
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex-1 min-w-32">טקסט הקישור<input aria-label={`${label} — טקסט הקישור`} className="block w-full border rounded p-2 bg-white mt-1" value={text} onChange={e=>setText(e.target.value)} placeholder="למשל: תקנון האירוע"/></label>
      <label className="flex-1 min-w-40">כתובת הקישור<input aria-label={`${label} — כתובת הקישור`} dir="ltr" type="url" className="block w-full border rounded p-2 bg-white mt-1" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..."/></label>
      <button type="button" disabled={!text.trim()||!valid} onClick={insert} className="rounded border px-3 py-2 text-red-900 hover:bg-red-50 disabled:opacity-50">הוסף קישור לטקסט</button>
    </div>
    {value&&<p className="text-sm leading-7 rounded border p-2 bg-stone-50">תצוגה מקדימה: <LinkedText>{value}</LinkedText></p>}
  </div>;
}