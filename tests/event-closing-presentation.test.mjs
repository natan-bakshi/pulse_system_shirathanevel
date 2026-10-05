import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
async function load(path){
 const r=await build({entryPoints:[path],bundle:true,platform:"node",format:"esm",write:false,jsx:"transform",
 alias:{"@":process.cwd()+"/src"},plugins:[{name:"react-test",setup(b){
 b.onResolve({filter:/^@\/components\/ui\/button$/},()=>({path:"button",namespace:"button-test"}));
 b.onLoad({filter:/.*/,namespace:"button-test"},()=>({contents:"export const Button=({children,...props})=>globalThis.__React.createElement('button',props,children);"}));
 b.onResolve({filter:/^react\/jsx-runtime$/},()=>({path:"jsx",namespace:"jsx-test"}));
 b.onLoad({filter:/.*/,namespace:"jsx-test"},()=>({contents:"export const {jsx,jsxs,Fragment}=globalThis.__JSX;"}));
 b.onResolve({filter:/^react$/},()=>({path:"react",namespace:"react-test"}));
 b.onLoad({filter:/.*/,namespace:"react-test"},()=>({contents:"const React=globalThis.__React;export const {forwardRef,createElement,createContext,useContext,useState,useEffect,useRef,useMemo,useCallback}=React;export default React;"}));
 }}]});
 return import("data:text/javascript;base64,"+Buffer.from(r.outputFiles[0].text).toString("base64"));
}
globalThis.__React=require("react");globalThis.__JSX=require("react/jsx-runtime");
const {renderToStaticMarkup}=require("react-dom/server");
const {agreementQuote}=await load("base44/shared/agreementQuote.ts");
const {israelDateTime,israelDate}=await load("src/lib/israelDate.js");
const {default:LinkedText}=await load("src/components/billing/LinkedText.jsx");
const {default:AgreementView}=await load("src/components/billing/AgreementView.jsx");
const {default:ClosingStatus}=await load("src/components/billing/ClosingStatus.jsx");
test("compact quote contains packages, quantities and prices but no internal costs",()=>{
 const f={currency:"ILS",finalTotal:900,totalPaid:100,balance:800,discountAmount:10,services:[
 {id:"p",is_package_main_item:true,package_name:"Package",quantity:1,custom_price:500,includes_vat:true},
 {id:"c",parent_package_event_service_id:"p",service_name:"Included",quantity:2,custom_price:700,supplier_cost:99999},
 {id:"s",service_name:"Single",quantity:2,custom_price:200,internal_notes:"secret"},
 {id:"e",service_name:"External",is_external:true,custom_price:500}
 ]};
 const q=agreementQuote({quote_history:[{file_uri:"private:new",created_at:"2026-09-27"},{file_uri:"private:old",created_at:"2026-09-20"}]},f);
 assert.equal(q.summary.rows.length,2);assert.equal(q.summary.rows[0].children[0].quantity,2);
 assert.equal(q.summary.rows[0].price,500);assert.equal(q.quoteFile.file_uri,"private:new");
 assert.equal(JSON.stringify(q).includes("99999"),false);assert.equal(JSON.stringify(q).includes("secret"),false);
 assert.equal(JSON.stringify(q).includes("External"),false);
 assert.equal(q.summary.balance,800);
});
test("legacy package is presented once with all included services",()=>{
 const q=agreementQuote({}, {currency:"ILS",finalTotal:500,totalPaid:0,balance:500,discountAmount:0,services:[
 {package_id:"p",package_name:"Legacy",package_price:500,service_name:"First",quantity:2},
 {package_id:"p",package_name:"Legacy",package_price:500,service_name:"Second",quantity:1}
 ]});
 assert.equal(q.summary.rows.length,1);assert.equal(q.summary.rows[0].children.length,2);
 assert.equal(q.summary.rows[0].price,500);
});
test("Israel dates handle UTC midnight boundary, winter and date-only values",()=>{
 assert.match(israelDateTime("2026-09-27T22:30:00Z"),/28.9.2026/);
 assert.match(israelDateTime("2026-09-27T09:02:05"),/12:02/);
 assert.match(israelDateTime("2026-01-15T09:00:00Z"),/11:00/);
 assert.equal(israelDate("2026-09-27"),"27.09.2026");
});
test("plain-text links become safe clickable anchors without rendering injected HTML",()=>{
 const html=renderToStaticMarkup(globalThis.__React.createElement(LinkedText,null,'Details https://example.test/quote. <script>alert(1)</script> javascript:alert(1)'));
 assert.match(html,/href="https:\/\/example.test\/quote"/);
 assert.match(html,/noopener noreferrer/);assert.match(html,/&lt;script&gt;/);
 assert.equal((html.match(/<a /g)||[]).length,1);
});
test("new and old agreement snapshots render without exposing private file URI",()=>{
 const base={event_name:"Test",event_date:"2026-09-27",total:500,currency:"ILS",terms:"https://example.test/terms",milestones:[],regular_cap:500,exceptional_cap:1000};
 const modern={...base,quote_summary:{rows:[],currency:"ILS",total:500,paid:0,balance:500},quote_file:{file_uri:"private:hidden",file_name:"Quote.pdf"}};
 const html=renderToStaticMarkup(globalThis.__React.createElement(AgreementView,{snapshot:modern,onOpenQuote:()=>{}}));
 assert.match(html,/PDF/);assert.match(html,/href=/);assert.equal(html.includes("private:hidden"),false);
 const old=renderToStaticMarkup(globalThis.__React.createElement(AgreementView,{snapshot:{...base,quote_text:"Legacy quote"}}));
 assert.match(old,/Legacy quote/);
 });
 test("closing shows only required steps, verified card counts, and success needs completion",()=>{
 const render=a=>renderToStaticMarkup(globalThis.__React.createElement(ClosingStatus,{agreement:a,onToken:()=>{},onDeposit:()=>{},onPdf:()=>{},onRefresh:()=>{}}));
 const waiting=render({signed_at:"2026-09-27",require_token:true,token_state:"pending",require_deposit:false,deposit_state:"waived"});
 assert.match(waiting,/מסירת כרטיס לביטחון בלבד/);assert.match(waiting,/מסירת כרטיס לביטחון בדף מאובטח/);
 assert.equal(waiting.includes("תשלום מקדמה בדף מאובטח"),false);
 const verified=render({signed_at:"2026-09-27",require_token:true,token_state:"verified",require_deposit:false,deposit_state:"waived"});
 assert.match(verified,/הדרישות בהסכם הושלמו, אך סגירת האירוע טרם אושרה/);
 assert.equal(verified.includes("מסירת כרטיס לביטחון בדף מאובטח"),false);
 const done=render({signed_at:"2026-09-27",require_token:true,token_state:"verified",require_deposit:false,deposit_state:"waived",completed_at:"2026-09-27"});
 assert.match(done,/הכול מוכן. האירוע אושר/);assert.match(done,/הכרטיס אומת/);
 assert.equal(done.includes("המקדמה שולמה"),false);
 const optional=render({signed_at:"2026-09-27",require_token:false,token_state:"pending",require_deposit:true,deposit_state:"pending"});
 assert.equal(optional.includes("מסירת כרטיס לביטחון בלבד"),false);assert.match(optional,/תשלום מקדמה בדף מאובטח/);
 });
const guidance=await load("src/components/billing/closingGuidance.js");
test("unfinished requirements reflect signature, security card and bank transfer correctly",()=>{
 const a={require_token:true,require_deposit:true,token_state:"pending",deposit_state:"pending"};
 assert.equal(guidance.outstandingClosingSteps(a).length,3);
 assert.equal(guidance.outstandingClosingSteps({...a,signed_at:"now",token_state:"verified"}).length,1);
 assert.equal(guidance.outstandingClosingSteps({...a,completed_at:"now"}).length,0);
 assert.equal(guidance.outstandingClosingSteps({signed_at:"now",require_token:false,require_deposit:false}).length,0);
 assert.match(guidance.outstandingClosingSteps({...a,signed_at:"now",deposit_method:"bank"}).join(" "),/ממתינה לקבלה ולרישום/);
});
test("card-free summary hides card caps and exceptional charge notices",()=>{
 const html=renderToStaticMarkup(globalThis.__React.createElement(AgreementView,{snapshot:{event_name:"Test",currency:"ILS",total:500,terms:"Terms",milestones:[],require_token:false,require_deposit:false,regular_cap:500,exceptional_cap:1000}}));
 for(const text of ["תקרת חיוב","חיוב חריג","כרטיס","עמלת הסליקה"])assert.equal(html.includes(text),false,text);
});
test("deposit explanation uses actual configured fee and distinguishes bank transfer",()=>{
 const a={snapshot:{currency:"ILS",fee_config:{processing_fee_enabled:"true",processing_fee_value:"2.5",processing_fee_type:"percent"}}};
 assert.match(guidance.depositExplanation(a),/2.5%/);assert.match(guidance.depositExplanation(a),/ללא עמלת סליקה מטעמנו/);
 a.snapshot.fee_config.processing_fee_enabled="false";assert.match(guidance.depositExplanation(a),/ללא עמלת סליקה לפי הסכם זה/);
});
