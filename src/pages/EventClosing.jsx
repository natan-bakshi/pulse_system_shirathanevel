import LinkedText from "@/components/billing/LinkedText";
import ClosingIntroduction from "@/components/billing/ClosingIntroduction";
import {securityExplanation,outstandingClosingSteps} from "@/components/billing/closingGuidance";
import React,{useCallback,useEffect,useRef,useState} from "react";
import { agreementAction,agreementError,statusLabel } from "@/lib/agreementApi";
import AgreementView from "@/components/billing/AgreementView";
import { base44 } from "@/api/base44Client";
import AdminClosingVerification from "@/components/billing/AdminClosingVerification";
import ClosingStatus from "@/components/billing/ClosingStatus";
import { closingText,localizedSnapshot } from "@/components/billing/closingI18n";
import { Button } from "@/components/ui/button";
const field="w-full rounded-md border p-3 bg-white";
function SignaturePad({onChange,clearLabel="נקה חתימה"}) {
 const canvas=useRef(null),lines=useRef([]),drawing=useRef(false);
 const repaint=()=>{const c=canvas.current;if(!c)return;const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle="#172033";ctx.lineWidth=2.5;ctx.lineCap="round";for(const stroke of lines.current){ctx.beginPath();stroke.forEach(([x,y],i)=>i?ctx.lineTo(x*c.width,y*c.height):ctx.moveTo(x*c.width,y*c.height));ctx.stroke();}};
 const point=e=>{const r=canvas.current.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
 return <div><canvas ref={canvas} width={900} height={260} aria-label={clearLabel==="Clear signature"?"Signature area: draw with a finger or mouse":"שטח חתימה: יש לצייר באצבע או בעכבר"} className="w-full h-40 border-2 rounded-md bg-white touch-none"
 onPointerDown={e=>{drawing.current=true;canvas.current.setPointerCapture(e.pointerId);lines.current.push([point(e)]);}}
 onPointerMove={e=>{if(drawing.current){lines.current.at(-1).push(point(e));repaint();}}}
 onPointerUp={e=>{if(!drawing.current)return;lines.current.at(-1).push(point(e));drawing.current=false;onChange(lines.current.map(s=>s.map(p=>[...p])));repaint();}}
 onPointerCancel={()=>{drawing.current=false;lines.current.pop();onChange([...lines.current]);repaint();}} />
 <Button type="button" variant="ghost" onClick={()=>{lines.current=[];repaint();onChange([]);}}>{clearLabel}</Button></div>;
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
 const [language,setLanguage]=useState("he");
 const [introSeen,setIntroSeen]=useState(false);
 const intentionalDeparture=useRef(false);
 const outstanding=outstandingClosingSteps(agreement,language);
 const incomplete=!!agreement&&!agreement.completed_at&&outstanding.length>0;
 const exitText=(language==="en"?"The process is not complete. Remaining: ":"התהליך עדיין לא הושלם. נותרו: ")+outstanding.join(" · ")+(language==="en"?" . Leave anyway?":" . לצאת בכל זאת?");
 useEffect(()=>{
  if(!incomplete)return;
  const unload=e=>{if(intentionalDeparture.current)return;e.preventDefault();e.returnValue="";};
  const link=e=>{
   const a=e.target.closest?.("a[href]");if(!a||a.target==="_blank"||a.hasAttribute("download")||e.ctrlKey||e.metaKey||e.shiftKey||e.button!==0)return;
   if(a.getAttribute("href")?.startsWith("#"))return;
   if(!window.confirm(exitText)){e.preventDefault();e.stopPropagation();}else intentionalDeparture.current=true;
  };
  const reset=()=>{intentionalDeparture.current=false;};
  window.addEventListener("beforeunload",unload);document.addEventListener("click",link,true);window.addEventListener("pageshow",reset);
  return()=>{window.removeEventListener("beforeunload",unload);document.removeEventListener("click",link,true);window.removeEventListener("pageshow",reset);};
 },[incomplete,exitText]);
 const userSelectedLanguage=useRef(false);
 const [isAdmin,setIsAdmin]=useState(false),[adminPassword,setAdminPassword]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[info,setInfo]=useState("");
 const [name,setName]=useState(""),[role,setRole]=useState(""),[strokes,setStrokes]=useState([]),[accepted,setAccepted]=useState({});
 const call=useCallback((action,body={})=>agreementAction(action,{agreementId:id,...auth.current,...body}),[id]);
 const run=async fn=>{setBusy(true);setError("");setInfo("");try{return await fn();}catch(e){setError(agreementError(e));return false;}finally{setBusy(false);}};
 const refresh=useCallback(async()=>{
  if(auth.current.verified){try{const a=await call("view");setAgreement(a);if(!userSelectedLanguage.current)setLanguage(a.signature?.language||a.snapshot?.form_language||"he");return;}catch(e){if(e.response?.status!==403)throw e;auth.current.verified=false;}}
  setOpened(await call("open"));
 },[call]);
 useEffect(()=>{let active=true;base44.auth.me().then(u=>{if(active)setIsAdmin(u?.role==="admin");}).catch(()=>{});return()=>{active=false;};},[]);
 useEffect(()=>{const previous=document.title;document.title="אישור אירוע וחתימה — שירת הנבל";const meta=document.createElement("meta");meta.name="referrer";meta.content="no-referrer";document.head.appendChild(meta);run(refresh);return()=>{document.title=previous;meta.remove();};},[refresh]);
 useEffect(()=>{const focus=()=>{if(auth.current.verified&&!busy)refresh().catch(()=>{});};window.addEventListener("focus",focus);return()=>window.removeEventListener("focus",focus);},[refresh,busy]);
 const redirect=async action=>{const result=await call(action);if(result.redirectUrl&&/^https:\/\//.test(result.redirectUrl)){intentionalDeparture.current=true;location.assign(result.redirectUrl);}else await refresh();};
 const pdf=async(kind)=>{const tab=window.open("","_blank");if(tab)tab.opener=null;try{const r=await call("document",{kind});if(r.url){if(tab)tab.location.replace(r.url);else location.assign(r.url);}}catch(e){tab?.close();throw e;}};
 const t=closingText[language]||closingText.he;
 const view=agreement?localizedSnapshot(agreement.snapshot,language):null;
 const statusActions={agreement,language,busy,onToken:()=>run(()=>redirect("token")),onDeposit:()=>run(()=>redirect("deposit")),onBank:()=>run(async()=>{const a=await call("choose_deposit_method",{method:"bank"});setAgreement(a);return true;}),onPdf:()=>run(()=>pdf("signed")),onQuote:()=>run(()=>pdf("quote")),onRefresh:()=>run(refresh)};
 if(agreement?.completed_at)return <main dir={language==="en"?"ltr":"rtl"} className="min-h-screen bg-gradient-to-b from-stone-100 via-amber-50/30 to-white px-3 py-6 sm:px-6 sm:py-10 text-stone-800"><article className="mx-auto max-w-2xl rounded-3xl border border-stone-200 bg-white p-5 sm:p-10 shadow-lg"><ClosingStatus {...statusActions}/>{error&&<p role="alert" className="rounded bg-red-50 text-red-800 p-4 mt-5">{error}</p>}</article></main>;
 return <main dir={language==="en"?"ltr":"rtl"} className="min-h-screen bg-gradient-to-b from-stone-100 via-amber-50/30 to-white py-5 sm:py-10 px-3 sm:px-6 text-stone-800"><article className="mx-auto max-w-4xl rounded-3xl border border-stone-200 bg-white p-4 sm:p-10 space-y-7 shadow-lg">
  <header className="text-center border-b border-amber-100 pb-6"><p className="text-red-900 font-semibold tracking-wide">{t.brand}</p><h1 className="text-2xl sm:text-3xl font-bold text-red-950 mt-3">{t.title}</h1><p className="text-stone-500 mt-3 text-sm">{t.subtitle}</p></header>
  <nav aria-label="שלבי סגירת האירוע" className="grid grid-cols-3 gap-2 text-xs sm:text-sm">{t.steps.map((label,i)=><div key={label} className={"text-center rounded-lg py-3 "+((!agreement?0:agreement.signed_at?2:1)===i?"bg-red-900 text-white":"bg-stone-100 text-stone-600")}>{i+1}. {label}</div>)}</nav>
  {!agreement&&<section className="space-y-4"><p>{t.verifyIntro} {opened?.phone||""}.</p>
   <Button disabled={busy||!opened} onClick={()=>run(async()=>{await call("otp");setSent(true);setInfo(language==="en"?"A code was sent via WhatsApp and expires in 10 minutes.":"קוד נשלח לוואטסאפ שלך, ותוקפו 10 דקות.");})}>{sent?t.resendCode:t.sendCode}</Button>
   {sent&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();run(async()=>{const a=await call("verify",{code});auth.current.verified=true;sessionStorage.setItem("agreement:"+id,JSON.stringify(auth.current));setAgreement(a);setLanguage(a.signature?.language||a.snapshot?.form_language||"he");setName(a.snapshot.recipient_name||"");});}}>
    <label className="block">{t.code}<input className={field} autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} /></label>
    <Button disabled={busy||code.length!==6}>{t.verify}</Button></form>}
   {isAdmin&&<AdminClosingVerification password={adminPassword} onChange={setAdminPassword} busy={busy} ready={!!opened} language={language} onSubmit={()=>run(async()=>{const a=await call("admin_verify",{password:adminPassword});setAdminPassword("");auth.current.verified=true;sessionStorage.setItem("agreement:"+id,JSON.stringify(auth.current));setAgreement(a);setLanguage(a.signature?.language||a.snapshot?.form_language||"he");setName(a.snapshot.recipient_name||"");})}/>}
   {!opened&&!busy&&<Button variant="outline" onClick={()=>run(refresh)}>{t.retry}</Button>}
  </section>}
  {agreement&&<>
   <ClosingIntroduction agreement={agreement} language={language} open={!introSeen} onClose={()=>setIntroSeen(true)}/>
   <div className="flex flex-wrap justify-between gap-2"><Button variant="link" onClick={()=>setIntroSeen(false)}>{language==="en"?"What does this process include?":"מה כולל התהליך?"}</Button></div>
   {incomplete&&<aside role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7"><strong>{language==="en"?"Still needed to complete the process:":"להשלמת התהליך עדיין נדרשים:"}</strong><ul className="list-disc list-inside">{outstanding.map(step=><li key={step}>{step}</li>)}</ul>{agreement.deposit_method==="bank"&&<p>{language==="en"?"You may return after the transfer is recorded; your saved signature is retained.":"אפשר לחזור לאחר רישום ההעברה; החתימה שנשמרה נשארת בתוקף."}</p>}</aside>}
   {agreement.require_token&&<aside className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 text-sm leading-7"><h2 className="font-bold text-red-950 mb-2">{language==="en"?"The card is security for the agreement":"הכרטיס הוא ביטחון לקיום ההסכם"}</h2>{securityExplanation[language]||securityExplanation.he}</aside>}
   <div className="flex justify-end"><label className="text-sm">{language==="en"?"Form language":"שפת הטופס"}<select aria-label={language==="en"?"Form language":"שפת הטופס"} className="ms-2 rounded border p-2" value={language} disabled={!!agreement.signed_at} onChange={e=>{userSelectedLanguage.current=true;setLanguage(e.target.value);setAccepted({});}}><option value="he">עברית</option>{agreement.snapshot.translations?.en?.terms&&<option value="en">English</option>}</select></label></div>
   <p className="text-sm text-slate-600">{t.version} {agreement.version} · {t.state}: {statusLabel(agreement.state,language)}</p>
   <AgreementView snapshot={agreement.snapshot} language={language} paidAmount={agreement.deposit_received} busy={busy} onOpenQuote={()=>run(()=>pdf("quote"))}/>
   <section className="space-y-4"><h2 className="text-xl font-semibold">{t.consents}</h2>{view.clauses.map(c=><label key={c.code} className="block border border-stone-200 rounded-xl p-5 bg-stone-50/50">
    <span className="font-semibold block mb-2">{c.label}</span><LinkedText className="text-sm leading-7">{c.text}</LinkedText>
    <span className="flex items-start gap-3 mt-3"><input className="mt-1 w-5 h-5" type="checkbox" disabled={!!agreement.signed_at||busy} checked={!!(agreement.signed_at?agreement.signature?.accepted?.[c.code]:accepted[c.code])} onChange={e=>setAccepted({...accepted,[c.code]:e.target.checked})}/>{t.accept}</span>
   </label>)}</section>
   {!agreement.signed_at?<section className="space-y-4 border-t pt-5"><h2 className="text-xl font-semibold">{t.signature}</h2>
    <label className="block">{t.name}<input className={field} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className="block">{t.role}<input className={field} value={role} onChange={e=>setRole(e.target.value)}/></label>
    <p className="text-sm">{t.signHelp}</p>
         <SignaturePad onChange={setStrokes} clearLabel={t.clear}/>
    <Button className="w-full bg-red-900" disabled={busy||name.trim().length<2||!strokes.length||view.clauses.some(c=>!accepted[c.code])} onClick={()=>run(async()=>{const a=await call("sign",{name,role,strokes,accepted,language,contentHash:agreement.content_hash});setAgreement(a);setInfo(language==="en"?"Your signature is saved. You can now complete the closing requirements.":"החתימה נשמרה. אפשר כעת להשלים את דרישות סגירת האירוע.");})}>{busy?t.saving:t.sign}</Button>
   </section>:<ClosingStatus {...statusActions}/>}
  </>}
  {busy&&<p role="status">{t.working}</p>}
  {error&&<p role="alert" className="rounded bg-red-50 text-red-800 p-4 whitespace-pre-wrap">{error}</p>}
  {info&&<p role="status" className="rounded bg-blue-50 p-4">{info}</p>}
 </article></main>;
}