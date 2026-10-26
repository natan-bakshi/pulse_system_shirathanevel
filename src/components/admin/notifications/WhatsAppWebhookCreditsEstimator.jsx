import React,{useMemo,useState} from 'react';
import {Input} from '@/components/ui/input';
import {estimateGreenWebhookInvocationCredits} from '@/lib/whatsappWebhookCreditModel';

// All math is client-only. This widget never calls a provider, Base44
// function, database or polling endpoint. Values are a HYPOTHETICAL example,
// not a measurement, invoice, provider quota or activation instruction.
export default function WhatsAppWebhookCreditsEstimator(){
 const [daily,setDaily]=useState('200');
 const [buttons,setButtons]=useState('10');
 const [unknown,setUnknown]=useState('2');
 const estimate=useMemo(()=>{
  try{return estimateGreenWebhookInvocationCredits({
   incomingEventsPerDay:Number(daily),buttonClicksPerDay:Number(buttons),
   unknownEventsPerDay:Number(unknown)
  });}catch{return null;}
 },[daily,buttons,unknown]);
 const display=n=>new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(n);
 return <details className="rounded border p-3 text-sm" dir="rtl">
  <summary className="cursor-pointer font-medium">השוואת קרדיטים ל־Webhook — חישוב מקומי בלבד</summary>
  <div className="space-y-3 pt-3">
   <p className="text-xs text-gray-600">המספרים ההתחלתיים להמחשה בלבד, ולא נמדדו בחשבון. ניתן לשנות את הכמויות כדי לבחון האם כדאי לבדוק שער סינון חיצוני. אין שליחת בקשה בזמן הזנת הנתונים.</p>
   <div className="flex flex-wrap gap-3">
    <label className="space-y-1 text-xs flex-1 min-w-[150px] max-w-[200px]">
     <span>כל האירועים הנכנסים ביום</span>
     <Input aria-label="כל האירועים הנכנסים ביום" type="number" min="0" max="1000000"
      value={daily} onChange={e=>setDaily(e.target.value)}/>
    </label>
    <label className="space-y-1 text-xs flex-1 min-w-[150px] max-w-[200px]">
     <span>לחיצות כפתורים ביום</span>
     <Input aria-label="לחיצות כפתורים ביום" type="number" min="0" max="1000000"
      value={buttons} onChange={e=>setButtons(e.target.value)}/>
    </label>
    <label className="space-y-1 text-xs flex-1 min-w-[150px] max-w-[200px]">
     <span>אירועים לא מזוהים ביום (מעבירים לטיפול)</span>
     <Input aria-label="אירועים לא מזוהים ביום" type="number" min="0" max="1000000"
      value={unknown} onChange={e=>setUnknown(e.target.value)}/>
    </label>
   </div>
   {estimate?<div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs" aria-label="אומדן שימוש חודשי בלבד">
    <div className="rounded border p-2">
     <strong>Webhook ישיר ל־Base44</strong>
     <p>{display(estimate.directBase44Invocations)} הפעלות בחודש</p>
     <p>כ־{display(estimate.directEstimatedCredits)} קרדיטים</p>
    </div>
    <div className="rounded border p-2">
     <strong>Webhook דרך מסנן חיצוני</strong>
     <p>{display(estimate.filteredGatewayBase44Invocations)} הפעלות Base44 בחודש</p>
     <p>כ־{display(estimate.gatewayEstimatedBase44Credits)} קרדיטים ב־Base44</p>
    </div>
    <div className="rounded border p-2">
     <strong>חיסכון אפשרי בהפעלות Base44</strong>
     <p>כ־{display(estimate.backendCreditsPotentiallyAvoided)} קרדיטים בחודש</p>
     <p>לפני עלות ותפעול המסנן החיצוני</p>
    </div>
   </div>:<p role="alert" className="text-xs text-amber-800">הזן מספרים שלמים תקינים. מספר לחיצות ואירועים לא מזוהים יחד אינו יכול לעלות על סך האירועים הנכנסים.</p>}
   <p className="text-xs text-gray-600">מבוסס על אומדן Base44 המתועד: כקרדיט אחד ל־100 הפעלות של פונקציית Backend. המחיר עשוי להשתנות לפי החשבון. העלויות אינן כוללות שירות Gateway חיצוני, שליחת WhatsApp, תפעול, אחסון, ניסיונות חוזרים או שירותים נוספים. לפני החלטת ארכיטקטורה נדרשת מדידה ב־Credit Usage ואימות מנגנון ACK בטוח.</p>
   <p className="text-xs text-gray-500">הסינון חייב להעביר גם תגובות לא מזוהות לבירור, ולא למחוק אותן. שום פעולה כאן אינה מפעילה Webhook.</p>
  </div>
 </details>;
}
