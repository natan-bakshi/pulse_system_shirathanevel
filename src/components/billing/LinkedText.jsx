import React from "react";
export default function LinkedText({children,className=""}){
 const text=String(children||"");
 const parts=text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"\]]+)/gi);
 return <span className={"whitespace-pre-wrap break-words "+className}>{parts.map((part,i)=>{
  const named=part.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/i);
  if(named)return <a key={i} href={named[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 text-red-900 hover:text-red-700">{named[1]}</a>;
  if(!/^https?:\/\//i.test(part))return part;
  const url=part.replace(/[.,;!?)}]+$/,""),tail=part.slice(url.length);
  return <React.Fragment key={i}><a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 text-red-900 hover:text-red-700 break-all">{url}</a>{tail}</React.Fragment>;
 })}</span>;
}