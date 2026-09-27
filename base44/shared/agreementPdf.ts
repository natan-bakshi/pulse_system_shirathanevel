import { jsPDF } from "npm:jspdf@4.2.0";
import { agreementFont } from "./agreementFont.ts";
import { digest } from "./agreementRules.ts";
import { loadAgreementBackground, agreementPdfMargins } from "./agreementPdfBackground.ts";

// The signed snapshot is immutable. This renderer changes its presentation, not its contents.
export async function makeAgreementPdf(a, config={}) {
  const doc=new jsPDF({unit:"mm",format:"a4",compress:true});
  const background=await loadAgreementBackground(config);
  const margins=agreementPdfMargins(config);
  doc.addFileToVFS("NotoSansHebrew.ttf",agreementFont);
  doc.addFont("NotoSansHebrew.ttf","Agreement","normal");
  doc.setFont("Agreement");
  const s=a.snapshot,english=a.signature?.language==="en",right=!english;
  const ink=[42,38,37],muted=[104,99,95],red=[127,29,29],paper=[250,247,243];
  const t=(he,en)=>english?en:he;
  const money=n=>new Intl.NumberFormat(english?"en-US":"he-IL",{maximumFractionDigits:2}).format(Number(n)||0)+" "+s.currency;
  doc.setProperties({title:t("הסכם חתום — ","Signed agreement — ")+s.event_name,author:"שירת הנבל",subject:a.id});
  let y=margins.top;
  function header(){
    if(background){
      const p=doc.getImageProperties(background.data);
      const scale=Math.max(210/p.width,297/p.height);
      const width=p.width*scale,height=p.height*scale;
      doc.addImage(background.data,background.format,(210-width)/2,(297-height)/2,width,height,undefined,"FAST");
    }else{
      doc.setFillColor(...red);doc.rect(0,0,210,10,"F");
      doc.setDrawColor(227,218,207);doc.line(18,281,192,281);
    }
  }
  function pageIf(height=10){if(y+height>297-margins.bottom){doc.addPage();header();y=margins.top;}}
  header();
  function lines(value,size=10,color=ink,pad=2){
    doc.setFontSize(size);doc.setTextColor(...color);
    for(const part of doc.splitTextToSize(String(value??""),174)){
      pageIf(size*.46+2);
      const rtl=/[\u0590-\u05ff]/.test(part);
      doc.text(part,right?192:18,y,{align:right?"right":"left",isInputVisual:false,isOutputVisual:true,isInputRtl:rtl,isOutputRtl:false});
      y+=size*.46+1.8;
    }
    y+=pad;
  }
  function section(label){
    pageIf(20);y+=5;doc.setFillColor(...paper);doc.roundedRect(18,y-5,174,12,2,2,"F");
    doc.setFillColor(...red);doc.rect(right?189:18,y-5,3,12,"F");
    doc.setFontSize(12);doc.setTextColor(...red);
    doc.text(label,right?184:26,y+3,{align:right?"right":"left",isInputVisual:false,isOutputVisual:true,isInputRtl:!english,isOutputRtl:false});y+=15;
  }
  lines("שירת הנבל",11,red,1);
  lines(t("הסכם ואישור אירוע","Event agreement & confirmation"),19,red,2);
  lines(s.event_name,15,ink,3);
  doc.setDrawColor(227,218,207);doc.line(18,y,192,y);y+=6;
  lines(t("מזהה הסכם: ","Agreement ID: ")+a.id+"  ·  "+t("גרסה: ","Version: ")+a.version,9,muted);
  lines(t("נחתם: ","Signed: ")+a.signed_at,9,muted);
  section(t("פרטי האירוע והחותם","Event & signatory"));
  lines(t("לקוח/ה: ","Client: ")+s.recipient_name+"  ·  "+t("טלפון: ","Phone: ")+s.recipient_phone);
  lines(t("מועד האירוע: ","Event date: ")+(s.event_date||"")+"  ·  "+t("מחיר כולל: ","Total: ")+money(s.total));
  lines(t("חותם/ת: ","Signed by: ")+a.signature.name+(a.signature.role?"  ·  "+a.signature.role:""));
  section(t("פרטי הצעת המחיר","Quote details"));
  lines(s.quote_text||s.quote||"",10,ink,1);
  section(t("תנאי ההתקשרות","Agreement terms"));
  lines(s.terms,10,ink,1);
  section(t("אישורים והרשאות","Consents & authorizations"));
  for(const c of s.clauses||[]){
    pageIf(20);lines(c.label,11,red,0);lines(c.text,10,ink,0);
    lines(t("אושר במפורש: ","Explicitly accepted: ")+(a.signature.accepted?.[c.code]?t("כן","Yes"):t("לא","No")),9,muted,4);
  }
  section(t("אבני הדרך לתשלום","Payment milestones"));
  for(const m of s.milestones||[])lines(m.label+"  ·  "+money(m.amount)+"  ·  "+t("עד ","Due ")+m.due_date,10,ink,1);
  lines(t("תקרת חיוב רגיל: ","Regular charge limit: ")+money(s.regular_cap));
  lines(t("תקרת חיוב חריג: ","Exceptional charge limit: ")+money(s.exceptional_cap));
  lines(t("דרישות סגירה: חתימה","Closing requirements: signature")+(a.require_token?t(" וכרטיס מאומת"," and verified card"):t("; ללא חובת כרטיס","; card not required"))+(a.require_deposit?t(" ומקדמה"," and deposit"):t("; ללא חובת מקדמה","; deposit not required")));
  lines(s.exceptional_notice?t("הודעה לפני חיוב חריג: לפחות ","Exceptional charge notice: at least ")+s.exceptional_notice_days+t(" ימים, עם אפשרות לתשלום חלופי."," days, with an alternative payment option."):t("ללא חובת הודעה מקדימה לחיוב חריג במסגרת הרשאה זו.","No advance notice is required for an exceptional charge under this authorization."));
  pageIf(73);section(t("חתימה ואימות","Signature & verification"));
  const sigY=y;
  doc.setDrawColor(222,211,200);doc.roundedRect(18,sigY-4,174,45,2,2,"S");
  doc.setDrawColor(...ink);doc.setLineWidth(0.45);
  for(const stroke of a.signature.strokes||[])for(let i=1;i<stroke.length;i++)doc.line(27+stroke[i-1][0]*155,sigY+stroke[i-1][1]*32,27+stroke[i][0]*155,sigY+stroke[i][1]*32);
  y=sigY+45;
  lines(t("הטלפון אומת באמצעות קוד חד־פעמי: ","Phone verified using a one-time code: ")+(a.signature.verified_at||a.verified_at),9,muted);
  lines(t("טביעת תוכן: ","Content hash: ")+a.content_hash,8,muted,0);
  lines(t("טביעת חתימה: ","Signature hash: ")+a.signature_hash,8,muted,0);
  const links=[...new Set(((s.quote_text||"")+"\n"+(s.terms||"")+"\n"+(s.clauses||[]).map(c=>c.text).join("\n")).match(/https?:\/\/[^\s<>"\]]+/g)||[])];
  if(links.length)section(t("קישורים הנזכרים בהסכם","Links referenced in the agreement"));
  for(const url of links){pageIf(16);const top=y;lines(url,8,muted,0);doc.link(18,top-4,174,y-top+4,{url});}
  const pages=doc.getNumberOfPages();
  if(!background)for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(...muted);doc.text(i+" / "+pages,105,297-Math.min(margins.bottom/2,14),{align:"center"});}
  return new Uint8Array(doc.output("arraybuffer"));
}
export async function persistAgreementPdf(client,a) {
  if(a.pdf_uri)return a;
  const config=Object.fromEntries((await client.entities.AppSettings.list()).map(r=>[r.setting_key,r.setting_value]));
  const bytes=await makeAgreementPdf(a,config);
  const pdfHash=await digest(bytes);
  const upload=await client.integrations.Core.UploadPrivateFile({file:new File([bytes],"agreement-"+a.id+".pdf",{type:"application/pdf"})});
  if(!upload?.file_uri)throw new Error("שמירת PDF נכשלה");
  return client.entities.EventAgreement.update(a.id,{pdf_uri:upload.file_uri,pdf_hash:pdfHash,pdf_state:"ready"});
}