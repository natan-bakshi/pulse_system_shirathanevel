import React from 'react';
import { FileCheck2, CreditCard, Landmark, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {useLanguage} from '@/i18n/LanguageProvider';

export default function ClosingIntroDialog({open,onChoice}) {
  const {t: uiTranslate}=useLanguage();
  return <Dialog open={open} onOpenChange={value=>{if(!value)onChoice(false,false);}}><DialogContent dir="rtl" className="max-w-md rounded-2xl bg-card p-6 sm:p-8"><DialogHeader><DialogTitle className="text-xl text-foreground">{uiTranslate("כך סוגרים אירוע")}</DialogTitle><DialogDescription>{uiTranslate("ארבעה צעדים פשוטים, בלי חיוב אוטומטי.")}</DialogDescription></DialogHeader>
    <ol className="space-y-4 text-sm leading-6 text-foreground">
      <li className="flex gap-3"><FileCheck2 className="h-5 w-5 shrink-0 text-red-800"/><span><strong>{uiTranslate("המנהל מכין ושולח טופס.")}</strong> {uiTranslate("הוא קובע אבני דרך, תקרות ותנאים. אפשר לעיין בהצעת המחיר לפני החתימה.")}</span></li>
      <li className="flex gap-3"><CheckCircle2 className="h-5 w-5 shrink-0 text-red-800"/><span><strong>{uiTranslate("הלקוח מאמת וחותם.")}</strong> {uiTranslate("הוא רואה את ההסכם ומאשר כל סעיף בנפרד.")}</span></li>
      <li className="flex gap-3"><CreditCard className="h-5 w-5 shrink-0 text-red-800"/><span><strong>{uiTranslate("משלימים רק את הדרישות שנבחרו.")}</strong> {uiTranslate("אם נדרש כרטיס שומרים אותו באישור הלקוח. המנהל רשאי לחייב אותו ידנית רק לפי ההרשאות החתומות, לא אוטומטית.")}</span></li>
      <li className="flex gap-3"><Landmark className="h-5 w-5 shrink-0 text-red-800"/><span><strong>{uiTranslate("מקדמה, אם נדרשה.")}</strong> {uiTranslate("אפשר לשלם באשראי או לבחור העברה בנקאית ולסיים בלי סליקה; האירוע ייסגר רק לאחר שהתשלום ייקלט והדרישות יושלמו.")}</span></li>
    </ol>
    <div className="flex flex-wrap gap-2 pt-2"><Button onClick={()=>onChoice(true,true)}>{uiTranslate("הבנתי, אל תציג שוב")}</Button><Button variant="outline" onClick={()=>onChoice(false,true)}>{uiTranslate("הבנתי, הצג בפעם הבאה")}</Button></div>
  </DialogContent></Dialog>;
}