export const securityExplanation={he:"הכרטיס נמסר לביטחון בלבד, בדומה לצ׳ק פיקדון, ולא כאמצעי התשלום השוטף לאירוע. הזנת הכרטיס אינה תשלום. פרטי הכרטיס המלאים נשמרים אצל ספק הסליקה ואינם נגישים לשירת הנבל; המשרד מקבל מזהה מאובטח והרשאה לחיוב ידני בלבד במקרים ובתקרות שאישרתם בהסכם, למשל אם תשלום לא הוסדר עד המועד שנקבע. לא מתבצעת גבייה אוטומטית. תשלום מקדמה באשראי, אם תבחרו בו, הוא פעולה נפרדת.",en:"The card is provided as security, similar to a security deposit cheque, rather than for routine event payments. Entering the card is not a payment. Full card details are stored by the payment provider and are not accessible to Shirat Hanevel. The office receives a secure identifier and authorization for manual charges only in the circumstances and limits you approve in the agreement, for example if a payment remains unpaid after its due date. There are no automatic charges. Paying a deposit by card, if you choose to do so, is a separate action."};
export function outstandingClosingSteps(a,language="he"){
 if(!a||a.completed_at)return [];
 const en=language==="en",steps=[];
 if(!a.signed_at)steps.push(en?"Sign the quotation and agreement":"חתימה על הצעת המחיר וההסכם");
 if(a.require_token&&a.token_state!=="verified")steps.push(en?"Provide and verify the security card":"מסירת ואימות כרטיס לביטחון");
 if(a.require_deposit&&a.deposit_state!=="paid")steps.push(a.deposit_method==="bank"?(en?"Bank deposit is awaiting receipt and recording":"המקדמה בהעברה בנקאית ממתינה לקבלה ולרישום"):(en?"Pay the deposit":"תשלום המקדמה"));
 return steps;
}
export function depositExplanation(a,language="he"){
 const en=language==="en",fee=a.snapshot?.fee_config||{};
 const charge=fee.processing_fee_enabled==="true"&&Number(fee.processing_fee_value)>0;
 const feeAmount=Number(fee.processing_fee_value)+(fee.processing_fee_type==="fixed"?" "+(a.snapshot.currency||"ILS"):"%");
 return en
 ?"You may pay the deposit by bank transfer with no processing fee charged by us, or on a secure card payment page"+(charge?" with a processing fee of "+feeAmount: " with no processing fee under this agreement")+". A bank transfer counts only after it is received and recorded by the office."
 :"אפשר להעביר מקדמה בהעברה בנקאית ללא עמלת סליקה מטעמנו, או לשלם בדף אשראי מאובטח"+(charge?" בתוספת עמלת סליקה של "+feeAmount:" ללא עמלת סליקה לפי הסכם זה")+". העברה בנקאית תיחשב כתשלום לאחר שתתקבל ותירשם במשרד.";
}