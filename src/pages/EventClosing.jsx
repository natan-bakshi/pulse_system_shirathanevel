import LinkedText from "@/components/billing/LinkedText";
import {israelDateTime} from "@/lib/israelDate";
import React,{useCallback,useEffect,useRef,useState} from "react";
import { agreementAction,agreementError,statusLabel } from "@/lib/agreementApi";
import AgreementView from "@/components/billing/AgreementView";
import { base44 } from "@/api/base44Client";
import AdminClosingVerification from "@/components/billing/AdminClosingVerification";
import { Button } from "@/components/ui/button";
const field="w-full rounded-md border p-3 bg-white";
function SignaturePad({onChange}) {
 const canvas=useRef(null),lines=useRef([]),drawing=useRef(false);
 const repaint=()=>{const c=canvas.current;if(!c)return;const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle="#172033";ctx.lineWidth=2.5;ctx.lineCap="round";for(const stroke of lines.current){ctx.beginPath();stroke.forEach(([x,y],i)=>i?ctx.lineTo(x*c.width,y*c.height):ctx.moveTo(x*c.width,y*c.height));ctx.stroke();}};
 const point=e=>{const r=canvas.current.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
 return <div><canvas ref={canvas} width={900} height={260} aria-label="שטח חתימה: יש לצייר באצבע או בעכבר" className="w-full h-40 border-2 rounded-md bg-white touch-none"
 onPointerDown={e=>{drawing.current=true;canvas.current.setPointerCapture(e.pointerId);lines.current.push([point(e)]);}}
 onPointerMove={e=>{if(drawing.current){lines.current.at(-1).push(point(e));repaint();}}}
 onPointerUp={e=>{if(!drawing.current)return;lines.current.at(-1).push(point(e));drawing.current=false;onChange(lines.current.map(s=>s.map(p=>[...p])));repaint();}}
 onPointerCancel={()=>{drawing.current=false;lines.current.pop();onChange([...lines.current]);repaint();}} />
 <Button type="button" variant="ghost" onClick={()=>{lines.current=[];repaint();onChange([]);}}>נקה חתימה</Button></div>;
}
export default function EventClosing(){
 const id=new URLSearchParams(location.search).get("id")||"";
 const auth=useRef(null);
 if(!auth.current){
  const key="agreement:"+id;let saved={};try{saved=JSON.parse(sessionStorage.getItem(key)||"{}");}catch{}
  const token=new URLSearchParams(location.hash.slice(1)).get("token");
  auth.current=token?{token,session:crypto.randomUUID()+crypto.randomUUID()}:saved;
  if(token){sessionStorage.setItem(key,JSON.stringify(auth.current));history.replaceState(null,"",location.pathname+location.search);}
 }
 const [agreement,setAgreement]=useState(null),[opened,setOpened]=useState(null),[sent,setSent]=useState(false),[code,setCode]=useState("");
 const [isAdmin,setIsAdmin]=useState(false),[adminPassword,setAdminPassword]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[info,setInfo]=useState("");
 const [name,setName]=useState(""),[role,setRole]=useState(""),[strokes,setStrokes]=useState([]),[accepted,setAccepted]=useState({});
 const call=useCallback((action,body={})=>agreementAction(action,{agreementId:id,...auth.current,...body}),[id]);
 const run=async fn=>{setBusy(true);setError("");setInfo("");try{await fn();}catch(e){setError(agreementError(e));}finally{setBusy(false);}};
 const refresh=useCallback(async()=>{
  if(auth.current.verified){try{const a=await call("view");setAgreement(a);return;}catch(e){if(e.response?.status!==403)throw e;auth.current.verified=false;}}
  setOpened(await call("open"));
 },[call]);
 useEffect(()=>{let active=true;base44.auth.me().then(u=>{if(active)setIsAdmin(u?.role==="admin");}).catch(()=>{});return()=>{active=false;};},[]);
 useEffect(()=>{const previous=document.title;document.title="אישור אירוע וחתימה — שירת הנבל";const meta=document.createElement("meta");meta.name="referrer";meta.content="no-referrer";document.head.appendChild(meta);run(refresh);return()=>{document.title=previous;meta.remove();};},[refresh]);
 useEffect(()=>{const focus=()=>{if(auth.current.verified&&!busy)refresh().catch(()=>{});};window.addEventListener("focus",focus);return()=>window.removeEventListener("focus",focus);},[refresh,busy]);
 const redirect=async action=>{const result=await call(action);if(result.redirectUrl&&/^https:\/\//.test(result.redirectUrl))location.assign(result.redirectUrl);else await refresh();};
 const pdf=async(kind)=>{const tab=window.open("","_blank");if(tab)tab.opener=null;try{const r=await call("document",{kind});if(r.url){if(tab)tab.location.replace(r.url);else location.assign(r.url);}}catch(e){tab?.close();throw e;}};
 return <main dir="rtl" className="min-h-screen bg-gradient-to-b from-stone-100 via-amber-50/30 to-white py-5 sm:py-10 px-3 sm:px-6 text-stone-800"><article className="mx-auto max-w-4xl rounded-3xl border border-stone-200 bg-white p-4 sm:p-10 space-y-7 shadow-lg">
  <header className="text-center border-b border-amber-100 pb-6"><p className="text-red-900 font-semibold tracking-wide">שירת הנבל</p><h1 className="text-2xl sm:text-3xl font-bold text-red-950 mt-3">עוד צעד קטן לקראת האירוע שלכם</h1><p className="text-stone-500 mt-3 text-sm">עוברים על הפרטים, מאשרים וחותמים — הכול במקום אחד</p></header>
  <nav aria-label="שלבי סגירת האירוע" className="grid grid-cols-3 gap-2 text-xs sm:text-sm">{["אימות טלפון","פרטי האירוע וחתימה","השלמת הסגירה"].map((label,i)=><div key={label} className={"text-center rounded-lg py-3 "+((!agreement?0:agreement.signed_at?2:1)===i?"bg-red-900 text-white":"bg-stone-100 text-stone-600")}>{i+1}. {label}</div>)}</nav>
  {!agreement&&<section className="space-y-4"><p>כדי לצפות בהסכם ולחתום יש לאמת את הטלפון שנקבע עבור ההזמנה. קוד חד־פעמי יישלח בוואטסאפ {opened?.phone||""}.</p>
   <Button disabled={busy||!opened} onClick={()=>run(async()=>{await call("otp");setSent(true);setInfo("קוד נשלח לוואטסאפ שלך, ותוקפו 10 דקות.");})}>{sent?"שלח קוד נוסף":"שלח קוד אימות"}</Button>
   {sent&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();run(async()=>{const a=await call("verify",{code});auth.current.verified=true;sessionStorage.setItem("agreement:"+id,JSON.stringify(auth.current));setAgreement(a);setName(a.snapshot.recipient_name||"");});}}>
    <label className="block">קוד אימות<input className={field} autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} /></label>
    <Button disabled={busy||code.length!==6}>אמת והצג את ההסכם</Button></form>}
   {isAdmin&&<AdminClosingVerification password={adminPassword} onChange={setAdminPassword} busy={busy} ready={!!opened} onSubmit={()=>run(async()=>{const a=await call("admin_verify",{password:adminPassword});setAdminPassword("");auth.current.verified=true;sessionStorage.setItem("agreement:"+id,JSON.stringify(auth.current));setAgreement(a);setName(a.snapshot.recipient_name||"");})}/>}
   {!opened&&!busy&&<Button variant="outline" onClick={()=>run(refresh)}>נסה שוב</Button>}
  </section>}
  {agreement&&<>
   <p className="text-sm text-slate-600">גרסה {agreement.version} · מצב: {statusLabel(agreement.state)}</p>
   <AgreementView snapshot={agreement.snapshot} busy={busy} onOpenQuote={()=>run(()=>pdf("quote"))}/>
   <section className="space-y-4"><h2 className="text-xl font-semibold">אישורים והרשאות</h2>{agreement.snapshot.clauses.map(c=><label key={c.code} className="block border border-stone-200 rounded-xl p-5 bg-stone-50/50">
    <span className="font-semibold block mb-2">{c.label}</span><LinkedText className="text-sm leading-7">{c.text}</LinkedText>
    <span className="flex items-start gap-3 mt-3"><input className="mt-1 w-5 h-5" type="checkbox" disabled={!!agreement.signed_at||busy} checked={!!(agreement.signed_at?agreement.signature?.accepted?.[c.code]:accepted[c.code])} onChange={e=>setAccepted({...accepted,[c.code]:e.target.checked})}/>קראתי ואני מאשר/ת סעיף זה</span>
   </label>)}</section>
   {!agreement.signed_at?<section className="space-y-4 border-t pt-5"><h2 className="text-xl font-semibold">חתימה</h2>
    <label className="block">שם מלא של החותם/ת<input className={field} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className="block">תפקיד או קשר לאירוע (רשות)<input className={field} value={role} onChange={e=>setRole(e.target.value)}/></label>
    <p className="text-sm">יש לחתום באצבע או בעכבר. עם האישור יישמרו המסמך, החתימה, מועד האימות ותיעוד טכני של הפעולה.</p>
    <SignaturePad onChange={setStrokes}/>
    <Button className="w-full bg-red-900" disabled={busy||name.trim().length<2||!strokes.length||agreement.snapshot.clauses.some(c=>!accepted[c.code])} onClick={()=>run(async()=>{const a=await call("sign",{name,role,strokes,accepted,contentHash:agreement.content_hash});setAgreement(a);setInfo("החתימה נשמרה. אפשר כעת להשלים את דרישות סגירת האירוע.");})}>{busy?"שומר...":"אני מאשר/ת את ההסכם וחותם/ת"}</Button>
   </section>:<section className="space-y-4 border-t pt-5">
    <p className="rounded bg-green-50 p-4">ההסכם נחתם ב־{israelDateTime(agreement.signed_at)}. {agreement.completed_at?"נוהל סגירת האירוע הושלם.":"יש להשלים את הדרישות המפורטות להלן."}</p>
    <p>כרטיס: {statusLabel(agreement.token_state)}{!agreement.require_token?" (רשות)":""} · מקדמה: {statusLabel(agreement.deposit_state)}{!agreement.require_deposit?" (רשות)":""}</p>
    <p className="text-sm">פרטי האשראי יוזנו רק בדף המאובטח של Invoice4U. שמירת כרטיס אינה חיוב. בסיום יש לחזור לכאן ולרענן את המצב.</p>
    <div className="flex flex-wrap gap-3">
     {agreement.token_state!=="verified"&&<Button disabled={busy} onClick={()=>run(()=>redirect("token"))}>עבור לשמירת כרטיס מאובטחת</Button>}
     {agreement.require_deposit&&agreement.deposit_state!=="paid"&&agreement.snapshot.deposit>0&&<Button disabled={busy} onClick={()=>run(()=>redirect("deposit"))}>שלם מקדמה בדף מאובטח</Button>}
     <Button disabled={busy} variant="outline" onClick={()=>run(()=>pdf("signed"))}>פתח עותק PDF חתום</Button>
     <Button disabled={busy} variant="outline" onClick={()=>run(refresh)}>רענן מצב</Button>
    </div>
   </section>}
  </>}
  {busy&&<p role="status">מבצע את הפעולה, נא להמתין…</p>}
  {error&&<p role="alert" className="rounded bg-red-50 text-red-800 p-4 whitespace-pre-wrap">{error}</p>}
  {info&&<p role="status" className="rounded bg-blue-50 p-4">{info}</p>}
 </article></main>;
}