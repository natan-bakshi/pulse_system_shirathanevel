import React from "react";
export default function LinkedText({children,className=""}){
 const text=String(children||"");
 const parts=text.split(/(https?:\/\/[^\s<>"\]]+)/g);
 return <span className={"whitespace-pre-wrap break-words "+className}>{parts.map((part,i)=>{
  if(!/^https?:\/\//i.test(part))return part;
  const url=part.replace(/[.,;!?)}]+$/,""),tail=part.slice(url.length);
  return <React.Fragment key={i}><a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 text-red-900 hover:text-red-700 break-all">{url}</a>{tail}</React.Fragment>;
 })}</span>;
}
