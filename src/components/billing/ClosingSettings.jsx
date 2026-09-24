import React from "react";
export { closingDefaults } from "../../../base44/shared/agreementRules.ts";
const field="block w-full border rounded p-2 bg-white mt-1";
export default function ClosingSettings({settings:s,onChange}){
 return <fieldset dir="rtl" className="space-y-4 border rounded-lg p-4"><legend className="px-2 font-semibold">ברירות מחדל לנוהל סגירת אירוע</legend>
  <p className="text-sm">ההגדרות מועתקות לגרסה חדשה של ההסכם. שינוי כאן אינו משנה הסכם שכבר נחתם. המקדמה נקבעת לפי הגדרות המקדמה הקיימות; אחריה 50% מהיתרה שבוע לפני האירוע, והשאר עד יום האירוע.</p>
  {[["closing_token_required","חובת כרטיס מאומת"],["closing_deposit_required","חובת מקדמה"],["closing_send_copy","שלח עותק חתום בוואטסאפ"],["closing_reminder_enabled","שלח תזכורות מקדימות"],["closing_notify_admin","הודע למנהל על תזכורות"],["closing_exceptional_notice","הודעה מקדימה לפני חיוב חריג"]].map(([k,l])=><label key={k} className="flex gap-2"><input type="checkbox" checked={s[k]==="true"} onChange={e=>onChange(k,String(e.target.checked))}/>{l}</label>)}
  {[["closing_regular_multiplier","תקרת חיוב רגיל — כפולות מחיר האירוע"],["closing_exceptional_multiplier","תקרת חיוב חריג — כפולות מחיר האירוע"],["closing_reminder_days","מספר ימים לפני אבן הדרך לתזכורת"],["closing_exceptional_notice_days","מספר ימי המתנה לאחר הודעה על חיוב חריג"]].map(([k,l])=><label key={k} className="block">{l}<input className={field} type="number" min="0" step={k.includes("multiplier")?"0.1":"1"} value={s[k]||"0"} onChange={e=>onChange(k,e.target.value)}/></label>)}
  <label className="block">שעה מוקדמת ביותר לתזכורת<input className={field} type="time" value={s.closing_reminder_time||"09:00"} onChange={e=>onChange("closing_reminder_time",e.target.value)}/></label>
  <p className="text-xs text-gray-600">לחיסכון בקרדיטים, התזכורות נבדקות במשימה היומית הקיימת ונשלחות בהרצה הראשונה לאחר המועד שנבחר. השעה אינה זמן שליחה מדויק.</p>
  {[["closing_regular_text","הרשאה לגבייה רגילה"],["closing_exceptional_text","הרשאה לגבייה חריגה"],["closing_changes_text","שינויים מוסכמים"],["closing_message_template","תוכן התזכורת"]].map(([k,l])=><label key={k} className="block">{l}<textarea rows={4} className={field} value={s[k]||""} onChange={e=>onChange(k,e.target.value)}/></label>)}
  <p className="text-xs break-words">משתנים בתזכורת: {"{{customer_name}}, {{event_name}}, {{amount}}, {{currency}}, {{due_date}}, {{business_phone}}"}</p>
 </fieldset>;
}
