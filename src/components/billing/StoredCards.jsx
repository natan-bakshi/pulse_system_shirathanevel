import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export async function storedCardAction(action, body = {}) {
  const { data } = await base44.functions.invoke("invoice4uStoredCards", { ...body, action });
  return data;
}
const errorText = e => e.response?.data?.error || e.message || "הפעולה לא הושלמה";
const cardLabel = c => c ? ((c.brand || "כרטיס") + " •••• " + (c.card_suffix || "")) : "אין כרטיס שמור";
const inputClass = "w-full rounded border p-2 bg-white";
export function StoredCardSettings({ settings, onChange }) {
  return <fieldset className="space-y-3 rounded-lg border p-4" dir="rtl">
    <legend className="font-semibold px-2">כרטיסים שמורים ללקוחות</legend>
    <label className="flex gap-2 items-center"><input type="checkbox" checked={settings.stored_cards_enabled === "true"} onChange={e => onChange("stored_cards_enabled", String(e.target.checked))} />אפשר ניהול כרטיסים שמורים</label>
    <label className="block">סביבת כרטיסים שמורים
      <select className={inputClass} value={settings.stored_cards_env || "qa"} onChange={e => onChange("stored_cards_env", e.target.value)}>
        <option value="qa">בדיקות QA — נפרד מהסליקה הרגילה</option><option value="production">ייצור</option>
      </select>
    </label>
    <label className="block">לאחר שכל אירועי הלקוח הסתיימו והחובות סולקו
      <select className={inputClass} value={settings.stored_cards_cleanup || "off"} onChange={e => onChange("stored_cards_cleanup", e.target.value)}>
        <option value="off">הסרה ידנית בלבד</option><option value="approval">בקש אישור מנהל להסרה</option><option value="automatic">הסר באופן אוטומטי</option>
      </select>
    </label>
    <p className="text-sm text-gray-600">הכרטיס משותף לכל אירועי הלקוח. אירוע פעיל, חוב או תשלום בטיפול מונעים הסרה אוטומטית. הפעלת המדיניות אינה מוחקת כרטיסים קיימים מיד; ניתן לטפל בהם ברשימה המרוכזת.</p>
    <p className="text-sm text-amber-800">הפעלה בייצור זמינה רק לאחר אימות החיבור לספק הסליקה. בדיקות נעשות עם מפתח QA נפרד.</p>
  </fieldset>;
}
export default function StoredCardPanel({ event, onChanged }) {
  const { data: settings = [] } = useQuery({ queryKey: ["appSettings"], queryFn: () => base44.entities.AppSettings.list(), staleTime: 180000 });
  const enabled = settings.some(r => r.setting_key === "stored_cards_enabled" && r.setting_value === "true");
  return enabled && event?.id ? <CardPanel event={event} onChanged={onChanged} /> : null;
}
function CardPanel({ event, onChanged }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", identifier: "" });
  const [consent, setConsent] = useState(false);
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [quote, setQuote] = useState(null);
  const requestKey = useRef("");
  const key = ["storedCard", event.id];
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: key, queryFn: () => storedCardAction("status", { eventId: event.id }), staleTime: 30000
  });
  const customer = data?.customer, card = data?.card;
  useEffect(() => {
    if (!customer?.id) return;
    const stop = base44.entities.BillingCustomer.subscribe(e => {
      if (e.id === customer.id) qc.invalidateQueries({ queryKey: ["storedCard"] });
    });
    const stopCard = base44.entities.StoredCard.subscribe(e => {
      if (e.id === card?.id) qc.invalidateQueries({ queryKey: key });
    });
    return () => { stop(); stopCard(); };
  }, [customer?.id, card?.id, event.id, qc]);
  const run = async fn => {
    setBusy(true); setMessage("");
    try { await fn(); }
    catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); await refetch(); }
  };
  const changed = async () => {
    qc.invalidateQueries({ queryKey: ["storedCards"] });
    qc.invalidateQueries({ queryKey: ["storedCard"] });
    qc.invalidateQueries({ queryKey: ["eventFinancialDocuments", event.id] });
    if (onChanged) await onChanged();
  };
  const loadCustomers = async (append = false, search = customerSearch) => {
    const result = await storedCardAction("customers", { skip: append ? customers.length : 0, search });
    setCustomers(old => append ? [...old, ...result.customers] : result.customers);
    setHasMore(result.hasMore);
    if (!append) setSelected("");
  };
  const bind = async id => {
    await storedCardAction("bind", { eventId: event.id, customerId: id });
    setMode(null); await changed();
  };
  const remove = async eligibleOnly => {
    if (!window.confirm("הכרטיס יוסר מהלקוח ומכל האירועים המקושרים אליו. היסטוריית התשלומים תישמר. להסיר?")) return;
    await run(async () => {
      await storedCardAction("remove", { customerId: customer.id, cardId: card.id, eligibleOnly });
      setMessage("הכרטיס הוסר מהמערכת"); await changed();
    });
  };
  const unlinkCustomer = async () => {
    if (!window.confirm("לנתק את הלקוח המשלם מהאירוע הזה בלבד? הלקוח והכרטיס יישארו זמינים לאירועים אחרים.")) return;
    await run(async () => {
      await storedCardAction("unbind", { eventId: event.id, customerId: customer.id });
      setMessage("הלקוח נותק מהאירוע"); await changed();
    });
  };
  const deleteCustomer = async () => {
    const count = Number(customer?.linked_event_count) || 0;
    const linkedWarning = count > 1 ? " הלקוח מקושר ל-" + count + " אירועים וינותק מכולם." : "";
    const cardWarning = card ? " הכרטיס השמור יוסר גם הוא." : "";
    if (!window.confirm("למחוק את הלקוח המשלם?" + linkedWarning + cardWarning + " היסטוריית התשלומים והמסמכים תישמר.")) return;
    await run(async () => {
      const result = await storedCardAction("delete_customer", { customerId: customer.id });
      setMessage("הלקוח נמחק ונותק מ-" + result.unlinkedEvents + " אירועים" + (result.removedCard ? "; הכרטיס הוסר" : ""));
      await changed();
    });
  };
  return <Card dir="rtl" className="bg-white">
    <CardHeader><CardTitle>הכרטיס השמור של הלקוח</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {isLoading ? <p>טוען...</p> : error ? <p role="alert" className="text-red-700">{errorText(error)}</p> : <>
        <p>{customer ? customer.name + " — " + cardLabel(card) : "יש לקשר לקוח משלם כדי לשמור כרטיס משותף לאירועים שלו."}</p>
        {card?.environment === "qa" && <p className="text-amber-800">כרטיס בדיקה בסביבת QA</p>}
        {card?.cleanup_pending && <div className="rounded border border-amber-400 bg-amber-50 p-3">
          <p>האירועים הסתיימו והחובות סולקו. נדרש אישור להסרת הכרטיס.</p>
          <Button disabled={busy || customer?.busy} className="mt-2 bg-red-800" onClick={() => remove(true)}>הסר כרטיס</Button>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || customer?.busy} onClick={() => run(async () => {
            setCustomerSearch(""); await loadCustomers(false, ""); setMode("customer");
          })}>{customer ? "שינוי לקוח משלם" : "בחר לקוח משלם"}</Button>
          {customer && <Button variant="outline" disabled={busy || customer.busy} onClick={() => { setConsent(false); setReference(""); setMode("setup"); }}>{card ? "החלף כרטיס" : "הוסף כרטיס"}</Button>}
          {card?.state === "active" && <>
            <Button disabled={busy || customer?.busy} onClick={() => { setQuote(null); setAmount(""); setDescription("תשלום עבור " + event.event_name); setMode("charge"); }}>חיוב מכרטיס שמור</Button>
            <Button variant="outline" disabled={busy || customer?.busy} onClick={() => remove(false)}>הסר כרטיס בלבד</Button>
          </>}
          {customer && <>
            <Button variant="outline" disabled={busy || customer.busy} onClick={unlinkCustomer}>נתק מהאירוע בלבד</Button>
            <Button variant="outline" className="text-red-700 border-red-300" disabled={busy || customer.busy} onClick={deleteCustomer}>מחק לקוח משלם</Button>
          </>}
          <Button variant="ghost" disabled={busy} onClick={() => refetch()}>רענן</Button>
        </div>
        {data?.pending?.kind === "setup" && <div className="rounded bg-blue-50 p-3 space-y-2">
          <p>ממתין לשמירת הכרטיס בדף המאובטח. תוקף הבקשה: {new Date(data.pending.expiresAt).toLocaleString("he-IL")}</p>
          {data.pending.url && <div className="flex gap-2">
            <a href={data.pending.url} target="_blank" rel="noopener noreferrer" className="underline">פתח דף שמירת כרטיס</a>
            <Button variant="outline" disabled={busy} onClick={() => run(async () => { await navigator.clipboard.writeText(data.pending.url); setMessage("הקישור הועתק"); })}>העתק קישור ללקוח</Button>
          </div>}
          {data.pending.canRecover && <Button variant="outline" disabled={busy} onClick={() => run(async () => {
            await storedCardAction("recover_setup", { customerId: customer.id }); setMessage("שמירת הכרטיס אומתה והושלמה"); await changed();
          })}>השלם אימות שמירת כרטיס</Button>}
          <Button variant="outline" disabled={busy || data.pending.state === "verifying"} onClick={() => run(async () => { await storedCardAction("cancel_setup", { customerId: customer.id }); await changed(); })}>בטל בקשת שמירה</Button>
        </div>}
        {data?.pending?.kind === "charge" && <div className="rounded bg-amber-50 p-3">
          <p>חיוב בטיפול או בבירור. אין לבצע חיוב נוסף לפני קבלת תוצאה.</p>
          <p className="text-xs break-all">מזהה פעולה לבירור: {data.pending.id}</p>
          <Button variant="outline" disabled={busy} onClick={() => run(async () => {
            const result = await storedCardAction("reconcile", { customerId: customer.id, operationId: data.pending.id });
            setMessage(result.state === "completed" ? "החיוב אומת ונרשם" : "הפעולה עדיין בבירור"); await changed();
          })}>ברר תוצאה מול הספק</Button>
        </div>}
      </>}
      {message && <p role="status" className="text-sm whitespace-pre-line">{message}</p>}
      <Dialog open={!!mode} onOpenChange={open => { if (!open && !busy) setMode(null); }}>
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{mode === "customer" ? "לקוח משלם" : mode === "setup" ? "שמירת כרטיס ללקוח" : "חיוב כרטיס שמור"}</DialogTitle>
            <DialogDescription>הכרטיס משותף לכל האירועים המשויכים ללקוח המשלם.</DialogDescription></DialogHeader>
          {mode === "customer" && <div className="space-y-3">
            <p className="text-sm text-gray-600">לקוחות קיימים מוצגים כאן רק אם כבר שמור להם כרטיס פעיל.</p>
            <div className="flex gap-2">
              <Input aria-label="חיפוש לקוח משלם" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") run(() => loadCustomers(false, customerSearch)); }}
                placeholder="חיפוש לפי שם, טלפון, אימייל או מזהה" />
              <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => loadCustomers(false, customerSearch))}>חפש</Button>
            </div>
            <label className="block">לקוח קיים<select className={inputClass} value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">בחר לקוח</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
            </select></label>
            {hasMore && <Button variant="outline" disabled={busy} onClick={() => run(() => loadCustomers(true, customerSearch))}>טען לקוחות נוספים</Button>}
            <Button disabled={!selected || busy} onClick={() => run(() => bind(selected))}>קשר לאירוע</Button>
            <p className="font-semibold border-t pt-3">לקוח חדש + כרטיס</p>
            <p className="text-sm text-gray-600">הלקוח יישמר במערכת רק לאחר שהכרטיס יאומת בהצלחה.</p>
            {[["name", "שם מלא"], ["phone", "טלפון"], ["email", "אימייל"], ["identifier", "תעודת זהות / ח.פ. (רשות)"]].map(([field, label]) =>
              <label key={field} className="block">{label}<Input value={form[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} /></label>)}
            <label className="block">אסמכתא להסכמת הלקוח<Input value={reference} onChange={e => setReference(e.target.value)} placeholder="מספר הסכם או הפניה להסכמה מתועדת" /></label>
            <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />התקבלה הסכמת הלקוח לשמירת הכרטיס ולחיובים בהתאם להסכם</label>
            <Button disabled={busy || !form.name.trim() || !form.phone.trim() || !consent || !reference.trim()} onClick={() => run(async () => {
              const result = await storedCardAction("create_customer_and_setup", {
                eventId: event.id, ...form, consentConfirmed: consent, consentReference: reference
              });
              setMode(null);
              setForm({ name: "", phone: "", email: "", identifier: "" }); setConsent(false); setReference("");
              setMessage("הלקוח נוצר זמנית והקישור המאובטח מוכן. לאחר אימות הכרטיס הלקוח יישמר סופית.");
              await changed();
              if (result.redirectUrl) await navigator.clipboard.writeText(result.redirectUrl).catch(() => {});
            })}>הוסף לקוח וצור קישור לכרטיס</Button>
          </div>}
          {mode === "setup" && <div className="space-y-3">
            <p>פרטי הכרטיס יוזנו בדף המאובטח של Invoice4U. הבקשה מיועדת לשמירה ללא חיוב.</p>
            <label className="block">אסמכתא להסכמת הלקוח<Input value={reference} onChange={e => setReference(e.target.value)} placeholder="מספר הסכם או הפניה להסכמה מתועדת" /></label>
            <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />התקבלה הסכמת הלקוח לשמירת הכרטיס ולחיובים בהתאם להסכם</label>
            <Button disabled={busy || !consent || !reference.trim()} onClick={() => run(async () => {
              await storedCardAction("setup", { eventId: event.id, customerId: customer.id, consentConfirmed: consent, consentReference: reference });
              setMode(null); await changed();
            })}>צור קישור לשמירת כרטיס</Button>
          </div>}
          {mode === "charge" && <div className="space-y-3">
            <p>{customer?.name} — {cardLabel(card)}</p>
            <label className="block">סכום<Input type="number" min="0.01" step="0.01" value={amount} disabled={!!quote} onChange={e => setAmount(e.target.value)} /></label>
            <label className="block">סיבת החיוב<Input value={description} disabled={!!quote} onChange={e => setDescription(e.target.value)} /></label>
            {!quote ? <Button disabled={busy || !Number(amount) || !description.trim()} onClick={() => run(async () => {
              const result = await storedCardAction("quote", { eventId: event.id, customerId: customer.id, cardId: card.id, amount: Number(amount) });
              requestKey.current = crypto.randomUUID(); setQuote(result);
            })}>הצג סכום סופי לאישור</Button> : <>
              <div className="rounded bg-gray-50 p-3">תשלום: {quote.amount} · עמלה: {quote.fee}<br /><strong>סה״כ לחיוב: {quote.total} {quote.currency}</strong></div>
              <Button disabled={busy} onClick={() => run(async () => {
                const result = await storedCardAction("charge", { eventId: event.id, customerId: customer.id, cardId: quote.card.id,
                  amount: quote.amount, confirmedTotal: quote.total, currency: quote.currency, requestKey: requestKey.current, description });
                setMessage(result.state === "completed" ? "החיוב הושלם ונרשם" : result.message || "הפעולה נרשמה; יש לבדוק את מצבה");
                setMode(null); await changed();
              })}>אשר חיוב {quote.total} {quote.currency}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setQuote(null)}>שנה סכום</Button>
            </>}
          </div>}
          {message && <p role="alert" className="text-red-700">{message}</p>}
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
export function StoredCardsManager() {
  const [skip, setSkip] = useState(0);
  const [selected, setSelected] = useState(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["storedCards", skip],
    queryFn: () => storedCardAction("list", { skip }), staleTime: 30000 });
  const toggle = row => setSelected(old => { const next = new Map(old); if (next.has(row.customer.id)) next.delete(row.customer.id);
    else next.set(row.customer.id, { customerId: row.customer.id, cardId: row.card.id }); return next; });
  const selectAll = async () => {
    setBusy(true); setMessage("");
    try {
      const next = new Map();
      for (let offset = 0; ; offset += 20) {
        const page = await storedCardAction("list", { skip: offset });
        for (const row of page.rows) if (row.eligible) next.set(row.customer.id, { customerId: row.customer.id, cardId: row.card.id });
        if (!page.hasMore) break;
      }
      setSelected(next);
    } catch (e) { setMessage(errorText(e)); } finally { setBusy(false); }
  };
  const removeSelected = async () => {
    if (!window.confirm("להסיר " + selected.size + " כרטיסים מהלקוחות שנבחרו ומכל אירועיהם? התנאים יאומתו לפני כל הסרה.")) return;
    setBusy(true); setMessage("");
    const results = [];
    try {
      const items = [...selected.values()];
      for (let i = 0; i < items.length; i += 20) {
        const result = await storedCardAction("bulk_remove", { items: items.slice(i, i + 20) });
        results.push(...result.results);
        setSelected(old => { const next = new Map(old); for (const r of result.results) if (r.status === "removed") next.delete(r.customerId); return next; });
      }
      setMessage("הוסרו: " + results.filter(r => r.status === "removed").length +
        " · דולגו: " + results.filter(r => r.status === "skipped").length + " · נכשלו: " + results.filter(r => r.status === "error").length);
    } catch (e) { setMessage("הפעולה נעצרה לאחר הסרת " + results.filter(r => r.status === "removed").length + " כרטיסים. " + errorText(e)); }
    finally { setBusy(false); await refetch(); }
  };
  return <Card dir="rtl"><CardHeader><CardTitle>כרטיסי לקוחות — הסרה מרוכזת</CardTitle></CardHeader><CardContent className="space-y-4">
    <p>מוצגים לקוחות, לא אירועים. רק לקוחות שכל אירועיהם הסתיימו וחובותיהם סולקו ניתנים לבחירה.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={selectAll}>בחר את כל המתאימים</Button>
      <Button variant="outline" disabled={busy} onClick={() => setSelected(new Map())}>נקה בחירה</Button>
      <Button disabled={busy || !selected.size} onClick={removeSelected}>הסר {selected.size} כרטיסים שנבחרו</Button>
      <Button variant="ghost" disabled={busy} onClick={() => refetch()}>רענן</Button>
    </div>
    {isLoading && <p>טוען...</p>}{error && <p role="alert">{errorText(error)}</p>}
    <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead><tr><th>בחירה</th><th>לקוח</th><th>כרטיס</th><th>מצב</th></tr></thead>
      <tbody>{data?.rows.map(row => <tr key={row.customer.id} className="border-t"><td className="py-3"><input aria-label={"בחר " + row.customer.name} type="checkbox" disabled={busy || !row.eligible} checked={selected.has(row.customer.id)} onChange={() => toggle(row)} /></td>
        <td>{row.customer.name}</td><td>{cardLabel(row.card)}{row.card?.environment === "qa" && " (QA)"}</td><td>{row.reason}</td></tr>)}</tbody>
    </table></div>
    <div className="flex gap-2"><Button variant="outline" disabled={busy || !skip} onClick={() => setSkip(Math.max(0, skip - 20))}>הקודם</Button><Button variant="outline" disabled={busy || !data?.hasMore} onClick={() => setSkip(skip + 20)}>הבא</Button></div>
    {message && <p role="status">{message}</p>}
  </CardContent></Card>;
}
