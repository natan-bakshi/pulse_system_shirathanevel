import { jsPDF } from "npm:jspdf@4.0.0";
import { agreementFont } from "./agreementFont.ts";
import { canonical, digest } from "./agreementRules.ts";
export async function makeAgreementPdf(a) {
 const doc=new jsPDF({unit:"mm",format:"a4",compress:true});
 doc.addFileToVFS("NotoSansHebrew.ttf",agreementFont);doc.addFont("NotoSansHebrew.ttf","Agreement","normal");doc.setFont("Agreement");
 doc.setProperties({title:"הסכם חתום — "+a.snapshot.event_name,author:"שירת הנבל",subject:a.id});
 let y=20;
 function line(text,size=11){
  doc.setFontSize(size);
  const parts=doc.splitTextToSize(String(text||""),174);
  for(const part of parts){
   if(y>276){doc.addPage();y=20;}
   doc.text(part,192,y,{align:"right",isInputVisual:false,isOutputVisual:true,isInputRtl:/[\u0590-\u05ff]/.test(part),isOutputRtl:false});y+=size*0.43+1.5;
  } y+=2;
 }
 line("שירת הנבל — הסכם ואישור אירוע",19);
 line(a.snapshot.event_name,15);
 line("מזהה הסכם: "+a.id+" | גרסה: "+a.version,9);
 line("מועד חתימה: "+a.signed_at,10);
 line("לקוח/ה: "+a.snapshot.recipient_name+" | טלפון: "+a.snapshot.recipient_phone);
 line("חותם/ת: "+a.signature.name+" | תפקיד: "+(a.signature.role||"לקוח/ה"));
 line("הצעת המחיר",15);line(a.snapshot.quote_text);
 line("תנאי ההתקשרות",15);line(a.snapshot.terms);
 for(const c of a.snapshot.clauses){line(c.label,13);line(c.text);line("אושר במפורש: "+(a.signature.accepted[c.code]?"כן":"לא"),10);}
 line("אבני דרך לתשלום",15);
 for(const m of a.snapshot.milestones)line(m.label+" — "+m.amount+" "+a.snapshot.currency+" — עד "+m.due_date);
 line("תקרת חיוב רגיל: "+a.snapshot.regular_cap+" "+a.snapshot.currency);
 line("תקרת חיוב חריג: "+a.snapshot.exceptional_cap+" "+a.snapshot.currency);
 line("דרישות סגירה: חתימה"+(a.require_token?" + כרטיס מאומת":"; ללא חובת כרטיס")+(a.require_deposit?" + מקדמה":"; ללא חובת מקדמה"));
 line(a.snapshot.exceptional_notice?"הודעה לפני חיוב חריג: לפחות "+a.snapshot.exceptional_notice_days+" ימים, עם אפשרות לתשלום חלופי.":"ללא חובת הודעה מקדימה לחיוב חריג במסגרת הרשאה זו.");
 line("חתימה",14);
 if(y>235){doc.addPage();y=20;}
 const sig=a.signature.strokes||[];
 doc.setDrawColor(30,30,30);doc.setLineWidth(0.45);
 for(const stroke of sig)for(let i=1;i<stroke.length;i++)doc.line(25+stroke[i-1][0]*150,y+stroke[i-1][1]*40,25+stroke[i][0]*150,y+stroke[i][1]*40);
 y+=47;
 line("תיעוד אימות",14);line("הטלפון אומת באמצעות קוד חד-פעמי בתאריך "+a.verified_at);
 line("טביעת תוכן: "+a.content_hash,8);line("טביעת חתימה: "+a.signature_hash,8);
 const links=[...new Set((a.snapshot.quote_text+"\n"+a.snapshot.terms+"\n"+a.snapshot.clauses.map(c=>c.text).join("\n")).match(/https?:\/\/[^\s<>"\]]+/g)||[])];
 for(const url of links){
  if(y>270){doc.addPage();y=20;}
  const caption="קישור למסמך / מידע נוסף";
  line(caption,10);doc.link(18,y-10,174,8,{url});
  line(url,8);
 }
 const pages=doc.getNumberOfPages();
 for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(8);doc.text(i+" / "+pages,105,290,{align:"center"});}
 return new Uint8Array(doc.output("arraybuffer"));
}
export async function persistAgreementPdf(client,a) {
 if(a.pdf_uri)return a;
 const bytes=await makeAgreementPdf(a);
 const pdfHash=await digest(bytes);
 const upload=await client.integrations.Core.UploadPrivateFile({file:new File([bytes],"agreement-"+a.id+".pdf",{type:"application/pdf"})});
 if(!upload?.file_uri)throw new Error("שמירת PDF נכשלה");
 return client.entities.EventAgreement.update(a.id,{pdf_uri:upload.file_uri,pdf_hash:pdfHash,pdf_state:"ready"});
}
