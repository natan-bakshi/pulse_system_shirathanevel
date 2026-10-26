import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOfficeWhatsAppInquiryLink} from '../base44/shared/whatsappOfficeInquiryLink.ts';
import {webcrypto} from 'node:crypto';
import {createFutureInteractiveButtonSnapshot} from '../base44/shared/whatsappButtonBindings.ts';
import {previewGreenInteractiveAssignment} from '../base44/shared/greenInteractiveOutbound.ts';
const digits='972541234567';
const basic={officeNumber:digits,outboxJobId:'job-7AB6C3',
 messageText:'שלום\nשיבוץ ליום חמישי בהר ציון, 052-1234567, טופס: https://secret.example/abc?token=SECRET'};
test('DEFAULT remains plain wa.me URL and does not disclose any origin',()=>{
 assert.equal(buildOfficeWhatsAppInquiryLink({...basic}),'https://wa.me/'+digits);
 assert.equal(buildOfficeWhatsAppInquiryLink({...basic,contextMode:'none'}),'https://wa.me/'+digits);
});
test('reference mode opens editable WhatsApp draft with exact stable outbox identifier',()=>{
 const url=buildOfficeWhatsAppInquiryLink({...basic,contextMode:'reference'});
 const parsed=new URL(url);
 assert.equal(parsed.origin,'https://wa.me');
 assert.equal(parsed.pathname,'/'+digits);
 const text=parsed.searchParams.get('text');
 assert.match(text,/אסמכתא: job-7AB6C3/);
 assert.match(text,/השאלה שלי:/);
 assert.equal(text.includes('הר ציון'),false);
 assert.equal(text.includes('SECRET'),false);
 assert.equal(text.includes('052-1234567'),false);
});
test('explicit excerpt mode gives office context but strips URLs, emails and phone numbers',()=>{
 const url=buildOfficeWhatsAppInquiryLink({...basic,contextMode:'excerpt',
  messageText:basic.messageText+'\ncontact@example.test\nחופה'});
 const text=new URL(url).searchParams.get('text');
 assert.match(text,/הר ציון/);
 assert.match(text,/job-7AB6C3/);
 assert.equal(text.includes('secret.example'),false);
 assert.equal(text.includes('SECRET'),false);
 assert.equal(text.includes('052-1234567'),false);
 assert.equal(text.includes('contact@example.test'),false);
 assert.match(text,/\[טלפון הוסר\]/);
});
test('malformed office number, origin or unknown mode cannot make an external open redirect',()=>{
 for(const bad of [
  {officeNumber:'+972541234567'},{officeNumber:'972541234567?text=override'},
  {officeNumber:'https://evil.invalid'},{outboxJobId:'<script>'},
  {contextMode:'forward_unsafe'}
 ]){
  assert.throws(()=>buildOfficeWhatsAppInquiryLink({...basic,contextMode:'reference',...bad}));
 }
});
test('long Hebrew message is bounded and never copies the whole confidential body into link',()=>{
 const huge='אירוע בר מצווה '.repeat(2000);
 const link=buildOfficeWhatsAppInquiryLink({...basic,contextMode:'excerpt',messageText:huge});
 assert.ok(link.length<1800);
 assert.ok(new URL(link).searchParams.get('text').length<400);
});
test('Green mixed URL button can optionally carry context; no text submitted on click',async()=>{
 const now=Date.now(),secret='synthetic-office-context-unit-test-signing-secret-12345';
 const job={id:'job-7AB6C3',status:'sending',message_type:'text',
  source_type:'assignment_new',requested_provider:'green',
  message_text:'שיבוץ בבית הכנסת המרכזי',chat_id:'972501234567@c.us',
  provider:'green',event_service_id:'service-123',supplier_id:'supplier-123',
  sender_account_id:'9903183013',assignment_revision:'r1'};
 job.interactive_button_bindings_json=await createFutureInteractiveButtonSnapshot({
  job,signingSecret:secret,issuedAt:now,policy:{enabled:true,quoteAssignment:false,
   buttons:[{action:'assignment_approve',label:'אישור'},
    {action:'assignment_reject',label:'דחייה'},
    {action:'contact_office',label:'דבר עם המשרד'}]}
 },webcrypto.subtle);
 const preview=await previewGreenInteractiveAssignment({
  job,signingSecret:secret,now,subtle:webcrypto.subtle,
  officeNumber:digits,officeLabel:'דבר עם המשרד',
  capability:'mixed_url',rolloutEnabled:true,
  frozenSnapshot:job.interactive_button_bindings_json,
  officeContextMode:'excerpt'
 });
 assert.equal(preview.method,'sendInteractiveButtons');
 assert.equal(preview.body.buttons.length,3);
 const office=preview.body.buttons[2];
 assert.equal(office.type,'url');
 assert.match(new URL(office.url).searchParams.get('text'),/בית הכנסת המרכזי/);
 assert.match(new URL(office.url).searchParams.get('text'),/job-7AB6C3/);
 assert.equal(preview.providerRequestsMade,0);
});
