import React,{useEffect,useState} from "react";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { agreementAction,agreementError,statusLabel } from "@/lib/agreementApi";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from "@/components/ui/dialog";
import AgreementView from "./AgreementView";
const input="block w-full border rounded-md p-2 bg-white mt-1";
const auditNames={created:"נוצרה גרסת הסכם",link_issued:"הופק קישור",invitation_accepted:"הזמנה התקבלה אצל ספק הוואטסאפ",opened:"הקישור נפתח",verification_sent:"נשלח קוד אימות",verified:"הטלפון אומת",signed:"ההסכם נחתם",token_link_created:"נוצר קישור לכרטיס",token_verified:"הכרטיס אומת",deposit_link_created:"נוצר קישור למקדמה",deposit_paid:"המקדמה שולמה",deposit_verified:"תשלום המקדמה אומת מול הספק",event_closed:"האירוע נסגר לפי הנוהל",superseded:"הוחלף בגרסה חדשה",cancelled:"ההסכם בוטל",notification_settings_changed:"עודכנו הגדרות הודעות",amendment_recorded:"תועד שינוי מוסכם",reminder_accepted:"תזכורת התקבלה אצל הספק",exceptional_notice:"נשלחה הודעה על חיוב חריג",workflow_recovered:"שוחררה פעולה שנקטעה"};
function Notifications({value:n,onChange}){
 return <fieldset className="space-y-3 border rounded p-3"><legend>שליטה בהודעות מקדימות</legend>
  <label className="flex gap-2"><input type="checkbox" checked={!!n.enabled} onChange={e=>onChange({...n,enabled:e.target.checked})}/>אפשר תזכורות תשלום אוטומטיות</label>
  <div className="grid grid-cols-2 gap-3"><label>ימים לפני המועד<input type="number" min="0" max="60" className={input} value={n.days} onChange={e=>onChange({...n,days:Number(e.target.value)})}/></label><label>שעה מוקדמת ביותר<input type="time" className={input} value={n.time} onChange={e=>onChange({...n,time:e.target.value})}/></label></div>
  <label className="block">תוכן התזכורת<textarea rows={4} className={input} value={n.template} onChange={e=>onChange({...n,template:e.target.value})}/></label>
  <label className="flex gap-2"><input type="checkbox" checked={!!n.notify_admin} onChange={e=>onChange({...n,notify_admin:e.target.checked})}/>הודעת אישור למנהל</label>
  <p className="text-xs text-gray-600">התזכורות נשלחות בהרצה היומית הראשונה לאחר המועד שנבחר, לחיסכון בקרדיטים. לא מתבצעת סליקה אוטומטית.</p>
 </fieldset>;
}
export default function EventClosingPanel({event,onChanged}){
 const qc=useQueryClient(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[url,setUrl]=useState(""),[draft,setDraft]=useState(null),[notification,setNotification]=useState(null),[amendment,setAmendment]=useState(null);
 const {data,error:loadError,refetch}=useQuery({queryKey:["eventAgreement",event.id],queryFn:()=>agreementAction("list",{eventId:event.id}),staleTime:45000});
 const a=data?.current;
 useEffect(()=>{const stop=base44.entities.EventAgreement.subscribe(c=>{if(c.data?.event_id===event.id||c.id===a?.id)qc.invalidateQueries({queryKey:["eventAgreement",event.id]});});return()=>stop();},[event.id,a?.id,qc]);
 const run=async fn=>{setBusy(true);setError("");setMessage("");try{await fn();await refetch();if(onChanged)await onChanged();}catch(e){setError(agreementError(e));}finally{setBusy(false);}};
 const openDraft=()=>run(async()=>{const p=await agreementAction("preview",{eventId:event.id});setDraft({...p,name:"",phone:"",email:""});});
 const issue=send=>run(async()=>{const r=await agreementAction("issue",{agreementId:a.id,send});setUrl(r.url);setMessage(r.warning|| (send?"הקישור התקבל אצל ספק הוואטסאפ. פתיחה וחתימה יופיעו במעקב.":"הקישור מוכן להעתקה."));});
 const openPdf=id=>run(async()=>{const r=await agreementAction("pdf",{agreementId:id});window.open(r.url,"_blank","noopener,noreferrer");});
 const change=(key,value)=>setDraft(d=>({...d,[key]:value}));
 return <section dir="rtl" className="rounded-xl border bg-white p-5 space-y-4">
  <div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-semibold">סגירת אירוע לפי הנוהל</h2><div className="flex gap-2"><Button disabled={busy} onClick={openDraft}>{a?"הכן גרסה חדשה":"הכן טופס לסגירת אירוע"}</Button><Button disabled={busy} variant="outline" onClick={()=>run(()=>refetch())}>רענן</Button></div></div>
  <p className="text-sm text-gray-600">חתימה, כרטיס מאומת ומקדמה לפי דרישות המנהל. שינוי סטטוס ידני של האירוע נשאר זמין ללא תנאים.</p>
  {a&&<>
   <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[["הסכם",statusLabel(a.state)],["חתימה",a.signed_at?new Date(a.signed_at).toLocaleString("he-IL"):"ממתינה"],["כרטיס",statusLabel(a.token_state)+(a.require_token?"":" · רשות")],["מקדמה",statusLabel(a.deposit_state)+(a.require_deposit?"":" · רשות")]].map(([k,v])=><div key={k} className="bg-stone-50 rounded p-3"><p className="text-xs text-gray-600">{k}</p><p>{v}</p></div>)}</div>
   <p className="text-sm">גרסה {a.version} · {a.snapshot.recipient_name} · {a.snapshot.recipient_phone} · PDF: {statusLabel(a.pdf_state)} · עותק בוואטסאפ: {statusLabel(a.copy_state)}</p>
   {event.closing_manual_override&&<p className="text-amber-800 text-sm">הסטטוס שונה ידנית. השלמת הנוהל הנוכחי לא תדרוס את בחירת המנהל.</p>}
   {a.busy_operation&&<p className="text-amber-800">פעולה בהסכם בטיפול. אם חלפו חמש דקות והפעולה נקטעה, ניתן לשחרר את נעילת הטופס. <Button variant="outline" disabled={busy} onClick={()=>run(()=>agreementAction("recover_workflow",{agreementId:a.id}))}>שחרר פעולה שנקטעה</Button></p>}
   <div className="flex flex-wrap gap-2">
    <Button disabled={busy} variant="outline" onClick={()=>issue(true)}>שלח קישור בוואטסאפ</Button>
    <Button disabled={busy} variant="outline" onClick={()=>issue(false)}>הפק קישור להעתקה</Button>
    {a.signed_at&&<Button disabled={busy} variant="outline" onClick={()=>openPdf(a.id)}>הסכם PDF חתום</Button>}
    <Button disabled={busy} variant="outline" onClick={()=>setNotification({notifications:a.notifications,send_copy:a.send_copy})}>הגדרות הודעות</Button>
    {a.signed_at&&<Button disabled={busy} variant="outline" onClick={()=>setAmendment({description:"",channel:"וואטסאפ",approved_by:"",approved_at:new Date().toISOString().slice(0,16),price_change:0,requires_resign:false})}>תעד שינוי מוסכם</Button>}
    <Button disabled={busy} variant="ghost" onClick={()=>{if(window.confirm("לבטל את הקישור והמשך השימוש בטופס? התיעוד החתום יישמר."))run(async()=>{await agreementAction("cancel",{agreementId:a.id});setUrl("");});}}>בטל טופס</Button>
   </div>
   {url&&<div className="space-y-2 bg-blue-50 p-3 rounded"><label>קישור פרטי ללקוח<input readOnly dir="ltr" className={input} value={url} onFocus={e=>e.target.select()}/></label><Button variant="outline" onClick={()=>run(async()=>{await navigator.clipboard.writeText(url);setMessage("הקישור הועתק");})}>העתק</Button><p className="text-xs">הפקת קישור חדש מבטלת את הקישור וההפעלה הקודמים. תוקף הקישור שבעה ימים.</p></div>}
   {data.deposits?.filter(p=>p.pending).map(p=><div key={p.id} className="rounded bg-amber-50 p-3 text-sm"><p>תשלום מקדמה בסך {p.amount} בבירור. מזהה: {p.id}</p>{p.canRecover?<Button disabled={busy} variant="outline" onClick={()=>run(async()=>{await agreementAction("recover_deposit",{eventId:event.id,paymentId:p.id});setMessage("תוצאת הספק נבדקה מחדש");})}>ברר ואמת מול הספק</Button>:<p>טרם התקבל מזהה עסקה מהספק. אין ליצור תשלום נוסף לפני בירור.</p>}</div>)}
   <details><summary className="cursor-pointer font-semibold">הנוסח שנשלח — גרסה {a.version}</summary><div className="mt-4"><AgreementView snapshot={a.snapshot}/>{a.snapshot.clauses.map(c=><div key={c.code} className="mt-4"><h3 className="font-semibold">{c.label}</h3><p className="whitespace-pre-wrap text-sm">{c.text}</p></div>)}</div></details>
   <details open><summary className="font-semibold cursor-pointer">מעקב פעולות והודעות</summary>
    <p className="text-xs text-gray-600 my-2">״התקבל אצל ספק הוואטסאפ״ אינו אישור מסירה או קריאה. פתיחת הטופס, אימות וחתימה מתועדים בפועל.</p>
    <ol className="space-y-2 max-h-72 overflow-auto">{[...(data.audit||[])].sort((x,y)=>String(y.at).localeCompare(String(x.at))).map(row=><li key={row.id} className="text-sm border-b py-2">{new Date(row.at).toLocaleString("he-IL")} — {auditNames[row.kind]||row.kind}</li>)}</ol>
    {(data.deliveries||[]).map(d=><p className="text-xs mt-2" key={d.id}>{new Date(d.attempted_at).toLocaleString("he-IL")} · {({verification:"קוד אימות",invitation:"הזמנה",signed_copy:"עותק חתום",milestone:"תזכורת",exceptional_notice:"הודעת חיוב חריג"})[d.kind]||d.kind}: {statusLabel(d.state)}</p>)}
   </details>
   {!!data.amendments?.length&&<details><summary className="font-semibold">שינויים מתועדים</summary>{data.amendments.map(m=><div key={m.id} className="p-3 border-b text-sm"><p className="whitespace-pre-wrap">{m.description}</p><p>{m.channel} · {m.approved_by} · {new Date(m.approved_at).toLocaleString("he-IL")} · שינוי במחיר: {m.price_change} {a.snapshot.currency}</p>{m.requires_resign&&<p className="text-amber-800">נדרשת הסכמה מחודשת — יש להכין גרסה חדשה</p>}</div>)}</details>}
  </>}
  {!!data?.agreements?.filter(x=>x.signed_at&&x.id!==a?.id).length&&<details><summary>מסמכים חתומים קודמים</summary>{data.agreements.filter(x=>x.signed_at&&x.id!==a?.id).map(x=><Button key={x.id} disabled={busy} variant="link" onClick={()=>openPdf(x.id)}>PDF גרסה {x.version}</Button>)}</details>}
  {(error||loadError)&&<p role="alert" className="text-red-800 whitespace-pre-wrap">{error||agreementError(loadError)}</p>}
  {message&&<p role="status" className="text-sm whitespace-pre-wrap">{message}</p>}
  <Dialog open={!!draft} onOpenChange={open=>{if(!open&&!busy)setDraft(null);}}><DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>הכנת טופס סגירת אירוע</DialogTitle><DialogDescription>הנוסח יישמר כגרסה קבועה. ניתן לערוך את הסעיפים לפני יצירת הטופס.</DialogDescription></DialogHeader>
   {draft&&<div className="space-y-4">
    {!!draft.contacts?.length&&<label className="block">מילוי מתוך אנשי הקשר באירוע<select className={input} defaultValue="" onChange={e=>{const c=draft.contacts[Number(e.target.value)];if(c)setDraft({...draft,name:c.name,phone:c.phone,email:c.email});}}><option value="" disabled>בחר איש קשר</option>{draft.contacts.map((c,i)=><option key={i} value={i}>{c.name} — {c.phone}</option>)}</select></label>}
    {[["name","שם מלא"],["phone","טלפון הלקוח בוואטסאפ"],["email","אימייל (רשות)"]].map(([k,l])=><label key={k} className="block">{l}<input className={input} value={draft[k]} onChange={e=>change(k,e.target.value)}/></label>)}
    <div className="bg-stone-50 p-3 rounded"><p>מחיר האירוע: {draft.total} {draft.currency}</p>{[["require_token","חובת כרטיס מאומת לסגירה"],["require_deposit","חובת מקדמה לסגירה"],["send_copy","שלח ללקוח עותק PDF חתום בוואטסאפ"]].map(([k,l])=><label key={k} className="flex gap-2 mt-2"><input type="checkbox" checked={!!draft[k]} onChange={e=>change(k,e.target.checked)}/>{l}</label>)}</div>
    <details><summary className="font-semibold cursor-pointer">תצוגת הצעת המחיר שתצורף</summary><p className="whitespace-pre-wrap text-sm leading-7">{draft.quote}</p></details>
    <label className="block">תנאי ההתקשרות<textarea rows={8} className={input} value={draft.terms} onChange={e=>change("terms",e.target.value)}/></label>
    {draft.clauses.map((c,i)=><label key={c.code} className="block">{c.label}<textarea className={input} rows={3} value={c.text} onChange={e=>change("clauses",draft.clauses.map((x,j)=>j===i?{...x,text:e.target.value}:x))}/></label>)}
    <div className="grid grid-cols-2 gap-3">{[["regular_cap","תקרת חיוב רגיל"],["exceptional_cap","תקרת חיוב חריג"]].map(([k,l])=><label key={k}>{l}<input type="number" min="0" step="0.01" className={input} value={draft[k]} onChange={e=>change(k,Number(e.target.value))}/></label>)}</div>
    <p className="text-sm">חיוב חריג: {draft.exceptional_notice?"הודעה מקדימה והמתנה של "+draft.exceptional_notice_days+" ימים לפחות":"ללא חובת הודעה מקדימה"}. ברירת המחדל ניתנת לשינוי בהגדרות החיוב לפני יצירת הסכם.</p>
    <h3 className="font-semibold">אבני דרך — הראשונה מגדירה את המקדמה</h3>
    {draft.milestones.map((m,i)=><div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-2 border rounded p-3">{[["label","תיאור","text"],["amount","סכום","number"],["due_date","מועד אחרון","date"]].map(([k,l,t])=><label key={k} className="text-sm">{l}<input className={input} type={t} min={t==="number"?"0":undefined} step={t==="number"?"0.01":undefined} value={m[k]} onChange={e=>change("milestones",draft.milestones.map((x,j)=>j===i?{...x,[k]:t==="number"?Number(e.target.value):e.target.value}:x))}/></label>)}</div>)}
    <Notifications value={draft.notifications} onChange={n=>change("notifications",n)}/>
    {a&&<p className="text-amber-800 text-sm">יצירת גרסה חדשה תבטל קישורים לגרסה הקודמת. המסמך החתום הקודם נשמר.</p>}
    {error&&<p role="alert" className="text-red-800">{error}</p>}
    <Button disabled={busy||!draft.name.trim()||!draft.phone.trim()||!draft.terms.trim()} onClick={()=>run(async()=>{await agreementAction("create",{...draft,eventId:event.id});setDraft(null);setUrl("");setMessage("הגרסה נשמרה. כעת ניתן לשלוח קישור בוואטסאפ או להעתיק אותו.");})}>{busy?"שומר...":"שמור את הטופס והכן לשליחה"}</Button>
   </div>}
  </DialogContent></Dialog>
  <Dialog open={!!notification} onOpenChange={open=>{if(!open&&!busy)setNotification(null);}}><DialogContent dir="rtl" className="max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>הודעות ללקוח</DialogTitle><DialogDescription>העדכון חל על הודעות עתידיות. הרשאות הגבייה החתומות אינן משתנות.</DialogDescription></DialogHeader>{notification&&<><Notifications value={notification.notifications} onChange={n=>setNotification({...notification,notifications:n})}/><label className="flex gap-2"><input type="checkbox" checked={notification.send_copy} onChange={e=>setNotification({...notification,send_copy:e.target.checked})}/>שלח עותק חתום בוואטסאפ</label>{error&&<p className="text-red-800">{error}</p>}<Button disabled={busy} onClick={()=>run(async()=>{await agreementAction("notifications",{agreementId:a.id,...notification});setNotification(null);})}>שמור הגדרות הודעות</Button></>}</DialogContent></Dialog>
  <Dialog open={!!amendment} onOpenChange={open=>{if(!open&&!busy)setAmendment(null);}}><DialogContent dir="rtl" className="max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>תיעוד שינוי שהלקוח אישר</DialogTitle><DialogDescription>התיעוד מצורף להסכם. הוא אינו מגדיל את תקרת החיוב החתומה; שינוי במחיר או בהרשאה מחייב גרסה מוסכמת מעודכנת לפני שימוש בכרטיס.</DialogDescription></DialogHeader>{amendment&&<div className="space-y-3">{[["description","תוכן השינוי"],["channel","ערוץ האישור"],["approved_by","מי אישר"]].map(([k,l])=><label key={k}>{l}<textarea className={input} value={amendment[k]} onChange={e=>setAmendment({...amendment,[k]:e.target.value})}/></label>)}<label>מועד האישור<input className={input} type="datetime-local" value={amendment.approved_at} onChange={e=>setAmendment({...amendment,approved_at:e.target.value})}/></label><label>שינוי במחיר<input className={input} type="number" value={amendment.price_change} onChange={e=>setAmendment({...amendment,price_change:Number(e.target.value)})}/></label><label className="flex gap-2"><input type="checkbox" checked={amendment.requires_resign} onChange={e=>setAmendment({...amendment,requires_resign:e.target.checked})}/>נדרשת הסכמה מחודשת</label>{error&&<p className="text-red-800">{error}</p>}<Button disabled={busy} onClick={()=>run(async()=>{await agreementAction("amendment",{...amendment,approved_at:new Date(amendment.approved_at).toISOString(),agreementId:a.id});setAmendment(null);})}>שמור תיעוד</Button></div>}</DialogContent></Dialog>
 </section>;
}
