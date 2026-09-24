// Local-only visual fixture. No Base44, WhatsApp or payment requests.
import {build} from "esbuild";
import {createRequire} from "node:module";
import {webcrypto} from "node:crypto";
import fs from "node:fs";
globalThis.crypto ||= webcrypto;
const require=createRequire(import.meta.url);
await build({entryPoints:["base44/shared/agreementPdf.ts"],bundle:true,platform:"node",format:"esm",outfile:"/tmp/agreement-pdf-test.mjs",plugins:[{name:"npm",setup(b){b.onResolve({filter:/^npm:jspdf/},()=>({path:require.resolve("jspdf"),external:true}));}}]});
const {makeAgreementPdf}=await import("/tmp/agreement-pdf-test.mjs");
const a={id:"agreement-test-123",version:1,signed_at:"2026-09-24T10:30:00Z",verified_at:"2026-09-24T10:25:00Z",require_token:true,require_deposit:false,content_hash:"f".repeat(64),signature_hash:"a".repeat(64),signature:{name:"נתן לוי",role:"מזמין האירוע",accepted:{terms:true},strokes:[[[.1,.2],[.2,.4],[.4,.2],[.45,.7],[.7,.4]]]},snapshot:{event_name:"בר מצווה - משפחת לוי",recipient_name:"נתן לוי",recipient_phone:"0501234567",quote_text:"הצעת מחיר לאירוע בתאריך 15/01/2030\nשירותי נגינה: 4 נגנים, ₪12,000 כולל מע״מ.\nשירות נוסף: קבלת פנים בעלות 2,000 ₪.\nלצפייה: https://example.com/quote",terms:"ההסכם כולל שירותי מוזיקה והפקת האירוע. הלקוח מאשר את השירותים והמחירים המפורטים בהצעה.",clauses:[{code:"terms",label:"תנאי ההתקשרות",text:"קראתי ואני מאשר את תנאי ההתקשרות, כולל אבני הדרך וההרשאות לגבייה ידנית."}],milestones:[{label:"מקדמה בסגירת האירוע",amount:2500,due_date:"2026-09-24"},{label:"50% מהיתרה - שבוע לפני האירוע",amount:5750,due_date:"2030-01-08"},{label:"יתרה ביום האירוע",amount:5750,due_date:"2030-01-15"}],currency:"ILS",regular_cap:14000,exceptional_cap:28000,exceptional_notice:true,exceptional_notice_days:3}};
const bytes=await makeAgreementPdf(a);
if(!Buffer.from(bytes).includes(Buffer.from("https://example.com/quote")))throw new Error("PDF link missing");
fs.writeFileSync(process.argv[2]||"/tmp/agreement-sample.pdf",bytes);
