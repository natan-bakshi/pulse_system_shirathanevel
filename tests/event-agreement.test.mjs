import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { webcrypto } from "node:crypto";
globalThis.crypto ||= webcrypto;
globalThis.Deno={serve:fn=>fn};
const plugin={name:"offline-agreements",setup(b){
 b.onResolve({filter:/^npm:@base44\/sdk/},()=>({path:"sdk",namespace:"fake"}));
 b.onResolve({filter:/^base44:runtime$/},()=>({path:"secrets",namespace:"fake"}));
 b.onResolve({filter:/quoteHtml\.ts$/},()=>({path:"quote",namespace:"fake"}));
 b.onResolve({filter:/agreementPdf\.ts$/},()=>({path:"pdf",namespace:"fake"}));
 b.onResolve({filter:/whatsappSend\.ts$/},()=>({path:"whatsapp",namespace:"fake"}));
 b.onResolve({filter:/^npm:html-to-text/},()=>({path:"html",namespace:"fake"}));
 b.onLoad({filter:/.*/,namespace:"fake"},({path})=>({contents:{
 sdk:"export const createClientFromRequest=()=>globalThis.__client;",
 secrets:"export const secrets={get:k=>globalThis.__secrets[k]};",
 quote:'export const generateQuoteHtml=async()=>({html:"הצעת מחיר לבדיקת הסכם"});',
 pdf:'export async function persistAgreementPdf(c,a){if(a.pdf_uri)return a;globalThis.__pdfCount++;return c.entities.EventAgreement.update(a.id,{pdf_uri:"private:test.pdf",pdf_state:"ready"});}',
 whatsapp:'export const normalizeIsraeliPhone=s=>s&&/^0?5\\d{8}$/.test(s)?s:"";export const sendWhatsAppText=async(phone,message)=>{globalThis.__messages.push({phone,message});return {messageId:"m"+globalThis.__messages.length};};export const sendWhatsAppFileByUrl=async(phone,url,name,message)=>{globalThis.__messages.push({phone,url,name,message});return {messageId:"m"+globalThis.__messages.length};};',
 html:"export const convert=s=>s;"
 }[path]}));
}};
async function load(path){const result=await build({entryPoints:[path],bundle:true,platform:"node",format:"esm",write:false,plugins:[plugin]});return import("data:text/javascript;base64,"+Buffer.from(result.outputFiles[0].text).toString("base64"));}
const {default:handler}=await load("base44/functions/eventAgreement/entry.ts");
const rules=await load("base44/shared/agreementRules.ts");
const lifecycle=await load("base44/shared/agreementLifecycle.ts");
function fixture(){
 const db={Event:[{id:"event",event_name:"אירוע טסט",event_date:"2030-01-15",status:"quote",primary_currency:"ILS",total_override:1000,total_override_includes_vat:true,updated_date:"start"}],
 AppSettings:[{setting_key:"default_advance_amount",setting_value:"100"},{setting_key:"default_advance_percent",setting_value:"20"}],
 QuoteTemplate:[{id:"terms",template_type:"agreement_disclaimer",identifier:"default",content:"תנאי ההתקשרות"}],User:[{id:"admin",role:"admin"}]};
 let serial=0,tick=0;
 const match=(r,q)=>Object.entries(q).every(([k,v])=>v&&typeof v==="object"?("$ne" in v?r[k]!==v.$ne:"$nin" in v?!v.$nin.includes(r[k]):false):r[k]===v);
 const entities=new Proxy({},{get(_,name){db[name]||=[];return{
 get:async id=>structuredClone(db[name].find(x=>x.id===id)||null),
 filter:async(q={},sort="id",limit=500,skip=0)=>structuredClone(db[name].filter(x=>match(x,q)).slice(skip,skip+limit)),
 list:async()=>structuredClone(db[name]),
 create:async data=>{const r={id:name+"-"+(++serial),created_date:new Date().toISOString(),updated_date:"u"+(++tick),...structuredClone(data)};db[name].push(r);return structuredClone(r);},
 update:async(id,data)=>{const r=db[name].find(x=>x.id===id);assert.ok(r);Object.assign(r,structuredClone(data),{updated_date:"u"+(++tick)});return structuredClone(r);},
 updateMany:async(q,u)=>{let updated=0;for(const r of db[name])if(match(r,q)){Object.assign(r,structuredClone(u.$set),{updated_date:"u"+(++tick)});updated++;}return {updated};},
 delete:async id=>{db[name]=db[name].filter(x=>x.id!==id);}
 };}});
 const client={entities,auth:{me:async()=>({id:"admin",role:"admin"})},integrations:{Core:{CreateFileSignedUrl:async()=>({signed_url:"https://files.example.test/agreement.pdf"})}}};client.asServiceRole=client;
 globalThis.__client=client;globalThis.__secrets={};globalThis.__messages=[];globalThis.__pdfCount=0;
 globalThis.fetch=async()=>{throw new Error("Live provider calls forbidden in tests");};
 return {client,db};
}
async function req(action,body={}){const r=await handler(new Request("https://test/functions/eventAgreement",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})}));return {status:r.status,data:await r.json()};}
async function create({token=false,deposit=false}={}){
 const p=await req("preview",{eventId:"event"});assert.equal(p.status,200,JSON.stringify(p));
 const r=await req("create",{...p.data,eventId:"event",name:"לקוח בדיקה",phone:"0500000000",require_token:token,require_deposit:deposit,send_copy:false});assert.equal(r.status,200,JSON.stringify(r));return r.data;
}
async function authenticate(a){
 const issue=await req("issue",{agreementId:a.id});assert.equal(issue.status,200,JSON.stringify(issue));
 const token=new URLSearchParams(new URL(issue.data.url).hash.slice(1)).get("token");
 const auth={agreementId:a.id,token,session:crypto.randomUUID()+crypto.randomUUID()};
 assert.equal((await req("open",auth)).status,200);
 assert.equal((await req("otp",auth)).status,200);
 const code=globalThis.__messages.at(-1).message.match(/\d{6}/)[0];
 assert.equal((await req("verify",{...auth,code})).status,200);
 return auth;
}
async function sign(a,auth){
 return req("sign",{...auth,contentHash:a.content_hash,name:"לקוח בדיקה",accepted:Object.fromEntries(a.snapshot.clauses.map(c=>[c.code,true])),strokes:[[[.1,.2],[.2,.4],[.4,.5],[.5,.3],[.7,.4]]]});
}
test("defaults and odd-money milestones sum exactly; invalid dates rejected",()=>{
 const rows=rules.defaultMilestones(1000.01,200,"2030-01-15","2030-01-01");
 assert.deepEqual(rows.map(x=>x.amount),[200,400.01,400]);
 assert.equal(rules.validateMilestones(rows,1000.01).at(-1).cumulative_amount,1000.01);
 assert.throws(()=>rules.validateMilestones([{amount:100,label:"x",due_date:"2030-02-31"}],100));
});
test("public actions reveal no agreement before link and phone verification",async()=>{
 const f=fixture(),a=await create();f.client.auth.me=async()=>{throw new Error("anonymous");};
 assert.equal((await req("list",{eventId:"event"})).status,403);
 assert.equal((await req("view",{agreementId:a.id})).status,403);
 assert.equal((await req("open",{agreementId:a.id,token:"invalid"})).status,403);
 assert.equal(globalThis.__messages.length,0);
});
test("signing is immutable, idempotent, private, and closes waived route",async()=>{
 const f=fixture(),a=await create(),auth=await authenticate(a);
 f.client.auth.me=async()=>null;
 const r=await sign(a,auth);assert.equal(r.status,200,JSON.stringify(r));assert.ok(r.data.signed_at);
 assert.equal(f.db.Event[0].status,"confirmed");
 assert.equal(f.db.ConsentClause.length,6);assert.equal(globalThis.__pdfCount,1);
 const hash=f.db.EventAgreement[0].signature_hash;
 assert.equal((await sign(a,auth)).status,200);
 assert.equal(f.db.EventAgreement[0].signature_hash,hash);assert.equal(globalThis.__pdfCount,1);assert.equal(f.db.ConsentClause.length,6);
 assert.equal(JSON.stringify(r.data).includes("session_hash"),false);
 assert.equal((await req("open",{agreementId:a.id,token:auth.token})).status,403);
});
test("separate consent and drawn signature required; stale content cannot be signed",async()=>{
 fixture();const a=await create(),auth=await authenticate(a);
 const bad=await req("sign",{...auth,contentHash:a.content_hash,name:"test",accepted:{terms:true},strokes:[[[.1,.2],[.2,.4],[.4,.5],[.5,.3],[.7,.4]]]});
 assert.equal(bad.status,400);
 assert.equal((await sign({...a,content_hash:"stale"},auth)).status,409);
 const sig=await req("sign",{...auth,contentHash:a.content_hash,name:"test",accepted:Object.fromEntries(a.snapshot.clauses.map(c=>[c.code,true])),strokes:[[[.1,.1],[.1,.1]]]});
 assert.equal(sig.status,400);
});
test("OTP brute force is bounded; expired session cannot read",async()=>{
 fixture();const a=await create();const issue=await req("issue",{agreementId:a.id}),token=new URLSearchParams(new URL(issue.data.url).hash.slice(1)).get("token");
 const auth={agreementId:a.id,token,session:crypto.randomUUID()+crypto.randomUUID()};
 await req("otp",auth);
 for(let i=0;i<5;i++)assert.equal((await req("verify",{...auth,code:"wrong"})).status,403);
 assert.equal((await req("verify",{...auth,code:"wrong"})).status,429);
 assert.equal((await req("otp",auth)).status,429);
});
test("token and deposit conditions are independent; manual status is respected",async()=>{
 const f=fixture(),a=await create({token:true,deposit:true}),auth=await authenticate(a);
 assert.equal((await sign(a,auth)).status,200);assert.equal(f.db.Event[0].status,"quote");
 f.db.BillingCustomer=[{id:"payer",active_card_id:"card"}];f.db.StoredCard=[{id:"card",customer_id:"payer",state:"active",environment:"production"}];
 f.db.Event[0].billing_customer_id="payer";f.db.EventAgreement[0].customer_id="payer";
 f.db.AppSettings.push({setting_key:"stored_cards_env",setting_value:"production"});
 f.db.Payment=[{event_id:"event",amount:200,currency:"ILS",payment_status:"completed",agreement_id:a.id,agreement_verified:false}];
 await lifecycle.reconcileAgreement(f.client,"event");assert.equal(f.db.Event[0].status,"quote");
 f.db.Payment[0].agreement_verified=true;f.db.Event[0].closing_manual_override=true;
 await lifecycle.reconcileAgreement(f.client,"event");assert.equal(f.db.Event[0].status,"quote");
 f.db.Event[0].closing_manual_override=false;
 await lifecycle.reconcileAgreement(f.client,"event");assert.equal(f.db.Event[0].status,"confirmed");
});
test("new version invalidates old public session, preserves signed snapshot",async()=>{
 const f=fixture(),a=await create(),auth=await authenticate(a);await sign(a,auth);
 const before=JSON.stringify(f.db.EventAgreement[0].snapshot);const b=await create();
 assert.notEqual(b.id,a.id);assert.equal((await req("view",auth)).status,403);
 assert.equal(JSON.stringify(f.db.EventAgreement[0].snapshot),before);assert.ok(f.db.EventAgreement[0].signed_at);
});
test("a consent-free route cannot accidentally trigger a charge; daily job sends once",async()=>{
 const f=fixture(),a=await create(),auth=await authenticate(a);await sign(a,auth);
 for(const m of f.db.PaymentMilestone){m.notify_at="2020-01-01";m.notification_enabled=true;}
 const before=globalThis.__messages.length;
 await lifecycle.processAgreementMilestones(f.client,{});const sent=globalThis.__messages.length-before;
 assert.equal(sent,3);
 await lifecycle.processAgreementMilestones(f.client,{});assert.equal(globalThis.__messages.length-before,sent);
 assert.equal(f.db.Payment?.length||0,0);
});
test("agreement schemas deny direct writes and non-admin reads",async()=>{
 const fs=await import("node:fs");
 for(const name of ["EventAgreement","AgreementAuditEvent","ConsentClause","PaymentMilestone","ClientMessageDelivery","AgreementChargeNotice","AgreementAmendment"]){
  const s=JSON.parse(fs.readFileSync("base44/entities/"+name+".jsonc","utf8"));
  assert.deepEqual(s.rls.read,{user_condition:{role:"admin"}});
  for(const op of ["create","update","delete"])assert.equal(s.rls[op],false,name+" "+op);
 }
});
