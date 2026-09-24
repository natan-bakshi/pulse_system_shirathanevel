import React,{useEffect,useRef,useState} from "react";
import { base44 } from "@/api/base44Client";
import { agreementError } from "@/lib/agreementApi";
import { Button } from "@/components/ui/button";
const field="block w-full border rounded p-2 bg-white mt-1";
export default function AgreementChargeForm({event,customer,card,onFinished}){
 const [ctx,setCtx]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[kind,setKind]=useState("regular"),[amount,setAmount]=useState(""),[description,setDescription]=useState("תשלום עבור "+event.event_name),[milestoneId,setMilestone]=useState(""),[noticeId,setNotice]=useState(""),[read,setRead]=useState(false),[quote,setQuote]=useState(null),[message,setMessage]=useState("");
 const key=useRef("");
 const call=async(action,extra={})=>{const {data}=await base44.functions.invoke("invoice4uStoredCards",{action,eventId:event.id,customerId:customer.id,cardId:card.id,agreementHash:ctx?.hash,chargeKind:kind,amount:Number(amount),description,milestoneId:kind==="regular"?milestoneId:"",noticeId:kind==="exceptional"?noticeId:"",...extra});if(data?.error)throw new Error(data.error);return data;};
 const run=async fn=>{setBusy(true);setError("");try{await fn();}catch(e){setError(agreementError(e));}finally{setBusy(false);}};
 useEffect(()=>{run(async()=>setCtx(await call("charge_context")));},[event.id,customer.id,card.id]);
 if(!ctx)return <p role="alert">{error||"טוען את ההרשאה החתומה..."}</p>;
 const s=ctx.snapshot;
 return <div className="space-y-4">
  <p>{customer.name} · כרטיס המסתיים ב־{card.card_suffix}</p>
  <div className="border rounded p-4 space-y-3 bg-stone-50"><p className="font-semibold">הנוסח שעליו חתם {ctx.name} ב־{new Date(ctx.signedAt).toLocaleString("he-IL")} · גרסה {ctx.version}</p>
   {s.clauses.filter(c=>["token","regular","exceptional","fee","changes"].includes(c.code)).map(c=><section key={c.code}><h3 className="font-semibold text-sm">{c.label}</h3><p className="text-sm whitespace-pre-wrap">{c.text}</p></section>)}
   <p>תקרה רגילה: {s.regular_cap} {s.currency} · חריגה: {s.exceptional_cap} {s.currency}</p>
   <p>{s.exceptional_notice?"חיוב חריג מצריך הודעה והמתנה של "+s.exceptional_notice_days+" ימים.":"ההסכם אינו מחייב הודעה מקדימה לחיוב חריג."}</p>
  </div>
  <label className="flex gap-2"><input type="checkbox" disabled={!!quote} checked={read} onChange={e=>setRead(e.target.checked)}/>קראתי את ההרשאה הספציפית, ואני מאשר שהחיוב עומד בתנאי ההסכם</label>
  <label className="block">סוג חיוב<select className={field} disabled={!!quote} value={kind} onChange={e=>{setKind(e.target.value);setAmount("");setNotice("");}}><option value="regular">תשלום אירוע לפי אבן דרך</option><option value="exceptional">חיוב חריג לפי ההסכם</option></select></label>
  {kind==="regular"&&<label className="block">אבן דרך<select className={field} disabled={!!quote} value={milestoneId} onChange={e=>setMilestone(e.target.value)}><option value="">בחר אבן דרך</option>{ctx.milestones.map(m=><option key={m.id} value={m.id}>{m.label} · עד {m.due_date} · מצטבר {m.cumulative_amount} {s.currency}</option>)}</select></label>}
  <label className="block">סכום לפני עמלת סליקה<input type="number" min="0.01" step="0.01" className={field} disabled={!!quote} value={amount} onChange={e=>{setAmount(e.target.value);setNotice("");}}/></label>
  <label className="block">סיבת החיוב<textarea className={field} disabled={!!quote} value={description} onChange={e=>{setDescription(e.target.value);setNotice("");}}/></label>
  {kind==="exceptional"&&<section className="space-y-2"><p className="text-sm">אין חובה לפתוח מחלוקת או לצרף אסמכתא כדי לבצע חיוב חריג מורשה. התקרה נבדקת במצטבר.</p>
   {!!ctx.notices.length&&<label>הודעה קיימת<select className={field} disabled={!!quote} value={noticeId} onChange={e=>{const n=ctx.notices.find(x=>x.id===e.target.value);setNotice(n?.id||"");if(n){setAmount(n.amount);setDescription(n.reason);}}}><option value="">בחר הודעה (אם נדרשת)</option>{ctx.notices.map(n=><option key={n.id} value={n.id}>{n.amount} {s.currency} · אפשרות חיוב מ־{new Date(n.available_at).toLocaleString("he-IL")} · {n.state==="accepted"?"השליחה אושרה":"בבירור"}</option>)}</select></label>}
   <Button variant="outline" disabled={busy||!!quote||!read||!(Number(amount)>0)||!description.trim()} onClick={()=>run(async()=>{const n=await call("charge_notice");setCtx({...ctx,notices:[...ctx.notices,n]});setNotice(n.id);setMessage("ההודעה התקבלה אצל הספק. ניתן לחייב החל מ־"+new Date(n.available_at).toLocaleString("he-IL"));})}>שלח הודעה מקדימה בוואטסאפ</Button>
  </section>}
  {!quote?<Button disabled={busy||!read||!(Number(amount)>0)||!description.trim()||(kind==="regular"&&!milestoneId)} onClick={()=>run(async()=>{setQuote(await call("quote"));key.current=crypto.randomUUID();})}>בדוק הרשאה והצג סכום סופי</Button>:<div className="space-y-3"><p className="bg-blue-50 rounded p-3">סכום: {quote.amount} · עמלת סליקה: {quote.fee}<br/><strong>סה״כ לחיוב: {quote.total} {quote.currency}</strong></p>
   <Button disabled={busy} onClick={()=>run(async()=>{const r=await call("charge",{confirmedTotal:quote.total,currency:quote.currency,requestKey:key.current});await onFinished(r);})}>בצע חיוב ידני בסך {quote.total} {quote.currency}</Button>
   <Button disabled={busy} variant="ghost" onClick={()=>setQuote(null)}>חזור לעריכה</Button></div>}
  {busy&&<p role="status">מבצע בדיקה, נא להמתין…</p>}{error&&<p role="alert" className="text-red-800">{error}</p>}{message&&<p role="status">{message}</p>}
 </div>;
}
