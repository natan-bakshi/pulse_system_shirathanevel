import React from "react";
import ClosingLanguageFields from "./ClosingLanguageFields";
export { closingDefaults } from "@/lib/closingDefaults";
const field="block w-full border rounded p-2 bg-white mt-1";
export default function ClosingSettings({settings:s,onChange}){
 return <fieldset dir="rtl" className="space-y-4 border rounded-lg p-4"><legend className="px-2 font-semibold">ברירות מחדל לנוהל סגירת אירוע</legend>
  <p className="text-sm">ההגדרות מועתקות לגרסה חדשה של ההסכם. שינוי כאן אינו משנה הסכם שכבר נחתם. המקדמה נקבעת לפי הגדרות המקדמה הקיימות; אחריה 50% מהיתרה שבוע לפני האירוע, והשאר עד יום האירוע.</p>
  {[["closing_token_required","חובת כרטיס מאומת"],["closing_deposit_required","חובת מקדמה"],["closing_send_copy","שלח עותק חתום בוואטסאפ"],["closing_reminder_enabled","שלח תזכורות מקדימות"],["closing_notify_admin","הודע למנהל על תזכורות"],["closing_exceptional_notice","הודעה מקדימה לפני חיוב חריג"]].map(([k,l])=><label key={k} className="flex gap-2"><input type="checkbox" checked={s[k]==="true"} onChange={e=>onChange(k,String(e.target.checked))}/>{l}</label>)}
  {[["closing_regular_multiplier","תקרת חיוב רגיל — כפולות מחיר האירוע"],["closing_exceptional_multiplier","תקרת חיוב חריג — כפולות מחיר האירוע"],["closing_reminder_days","מספר ימים לפני אבן הדרך לתזכורת"],["closing_exceptional_notice_days","מספר ימי המתנה לאחר הודעה על חיוב חריג"]].map(([k,l])=><label key={k} className="block">{l}<input className={field} type="number" min="0" step={k.includes("multiplier")?"0.1":"1"} value={s[k]||"0"} onChange={e=>onChange(k,e.target.value)}/></label>)}
  <label className="block">שעה מוקדמת ביותר לתזכורת<input className={field} type="time" value={s.closing_reminder_time||"09:00"} onChange={e=>onChange("closing_reminder_time",e.target.value)}/></label>
  <p className="text-xs text-gray-600">לחיסכון בקרדיטים, התזכורות נבדקות במשימה היומית הקיימת ונשלחות בהרצה הראשונה לאחר המועד שנבחר. השעה אינה זמן שליחה מדויק.</p>
  <div className="grid gap-3 sm:grid-cols-2">{[["closing_form_language","שפת טופס כברירת מחדל"],["closing_message_language","שפת הודעות ללקוח כברירת מחדל"]].map(([k,l])=><label key={k}>{l}<select className={field} value={s[k]||"he"} onChange={e=>onChange(k,e.target.value)}><option value="he">עברית</option><option value="en">אנגלית</option></select></label>)}</div>
  <ClosingLanguageFields settings={s} onChange={onChange} />
  <p className="text-sm text-gray-600">טקסטים מותאמים בהצעת מחיר ושמות שירותים אינם מתורגמים אוטומטית.</p>
 </fieldset>;
}