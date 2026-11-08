// Cloudflare Free Workers AI translation draft service.
// Not enabled in Pulse until an owner-controlled Access account is connected.
import {jwtVerify,createRemoteJWKSet} from 'jose';
const MODEL='@cf/google/gemma-4-26b-a4b-it';
const KINDS=new Set([
 'service_name','service_description','package_name','package_description',
 'quote_intro','quote_terms','quote_notes','event_name','event_location',
 'event_notes','client_notes','custom_title','concept','schedule_activity','schedule_notes'
]);
const DAILY_LIMIT=30;
const MAX_SOURCE_LENGTH=2500;
const hdr=origin=>({
 'Access-Control-Allow-Origin':origin,
 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Access-Control-Allow-Headers':'Content-Type',
 'Access-Control-Allow-Credentials':'true',
 'Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'
});
const response=(body,status,origin)=>new Response(JSON.stringify(body),{
 status,headers:{...hdr(origin),'Content-Type':'application/json;charset=utf-8'}
});
const tokens=(s,re)=>(String(s||'').match(re)||[]).sort().join('|');
function validTranslation(source,value){
 if(typeof value!=='string'||!value.trim()||value.length>6000)return false;
 if(/<\s*(script|style|iframe|object|embed|form)\b|\bon\w+\s*=|javascript\s*:/i.test(value))return false;
 // The model may translate only text nodes, not tags, hrefs or attributes.
 if(tokens(source,/<[^>]*>/g)!==tokens(value,/<[^>]*>/g))return false;
 const visible=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ');
 const number=/\d+(?:[.,/]\d+)*(?:%|-\d+(?:[.,/]\d+)*)?/g;
 if(tokens(visible(source),number)!==tokens(visible(value),number))return false;
 if(tokens(source,/https?:\/\/[^\s"'<>]+/g)!==tokens(value,/https?:\/\/[^\s"'<>]+/g))return false;
 if(tokens(source,/\{\{?[^{}]+\}\}?/g)!==tokens(value,/\{\{?[^{}]+\}\}?/g))return false;
 return true;
}
let jwks=null,teamCached='';
async function authenticatedSubject(request,env){
 const team=String(env.ACCESS_TEAM||'').trim();
 const audience=String(env.ACCESS_AUD||'').trim();
 const approved=String(env.ALLOWED_EMAILS||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
 if(!/^[a-z0-9-]+$/.test(team)||!audience||!approved.length)throw Error('Access not configured');
 let token=request.headers.get('Cf-Access-Jwt-Assertion')||'';
 if(!token)token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1]||'';
 if(!token)throw Error('Cloudflare Access token missing');
 if(team!==teamCached||!jwks){
  teamCached=team;
  jwks=createRemoteJWKSet(new URL('https://'+team+'.cloudflareaccess.com/cdn-cgi/access/certs'));
 }
 const {payload}=await jwtVerify(token,jwks,{
  issuer:'https://'+team+'.cloudflareaccess.com',
  audience,algorithms:['RS256']
 });
 const email=String(payload.email||'').toLowerCase();
 if(!approved.includes(email)||!payload.sub)throw Error('User not approved');
 return String(payload.sub);
}
async function takeQuota(env,subject){
 if(!env.LIMITS?.get||!env.LIMITS?.put)throw Error('Quota KV missing');
 const bytes=new TextEncoder().encode(subject);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
  .map(v=>v.toString(16).padStart(2,'0')).join('');
 const key='pulse-english-drafts-v1:'+new Date().toISOString().slice(0,10)+':'+hash;
 const count=Number(await env.LIMITS.get(key)||0);
 if(!Number.isFinite(count)||count>=DAILY_LIMIT)return {allowed:false,remaining:0};
 await env.LIMITS.put(key,String(count+1),{expirationTtl:172800});
 return {allowed:true,remaining:DAILY_LIMIT-count-1};
}
const PROMPT=[
 'Translate Hebrew text into publication-quality natural English for Shirat HaNevel Bar Mitzvah event production.',
 'Be polished, clear, warm and accurate, never literal or exaggerated.',
 'Preserve the factual meaning and all contractual obligations. Never invent services.',
 'Preserve EVERY number, date, percentage, currency, URL, placeholder and HTML tag/attribute.',
 'If the original contains HTML, leave all markup identical and translate text nodes only.',
 'Shirat HaNevel must remain Shirat HaNevel; the Bar Mitzvah boy, Torah aliyah,',
 'ceremonial canopy, shofar, tallit and tefillin are the standard terms.',
 'Return JSON only, with exactly one property named translation.',
 'Never add commentary, markdown or new business terms.'
].join(' ');
export const __test={validTranslation,takeQuota};
export default {
 async fetch(request,env){
  const allow=String(env.ALLOWED_ORIGIN||'https://pulse-system.base44.app');
  if(request.headers.get('Origin')!==allow)return response({error:'Origin not authorized'},403,allow);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:hdr(allow)});
  if(request.method!=='POST'||new URL(request.url).pathname!=='/translate')
   return response({error:'Not found'},404,allow);
  if(!env.AI?.run)return response({error:'AI service is not configured'},503,allow);
  if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))
   return response({error:'JSON required'},415,allow);
  if(Number(request.headers.get('Content-Length')||0)>10000)
   return response({error:'Payload too large'},413,allow);
  let subject;
  try{subject=await authenticatedSubject(request,env);}
  catch{return response({error:'Cloudflare Access authentication required'},401,allow);}
  let body;
  try{body=await request.json();}
  catch{return response({error:'Invalid JSON'},400,allow);}
  if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).some(key=>!['source','kind'].includes(key))||
    !KINDS.has(body.kind)||typeof body.source!=='string'||
    !body.source.trim()||body.source.length>MAX_SOURCE_LENGTH)
     return response({error:'Unsupported input'},400,allow);
  let quota;
  try{quota=await takeQuota(env,subject);}
  catch{return response({error:'Free usage tracking unavailable'},503,allow);}
  if(!quota.allowed)return response({error:'Daily free translation quota reached'},429,allow);
  try{
   const result=await env.AI.run(MODEL,{
    messages:[{role:'system',content:PROMPT},
      {role:'user',content:'Type: '+body.kind+'\nHebrew source:\n'+body.source}],
    response_format:{type:'json_object'},temperature:0.15,
    max_completion_tokens:1500,chat_template_kwargs:{enable_thinking:false}
   },{rejectIfBusy:true});
   const raw=result?.choices?.[0]?.message?.content||result?.response||'';
   let parsed;
   try{parsed=JSON.parse(raw);}
   catch{return response({error:'Invalid AI output'},502,allow);}
   if(!validTranslation(body.source,parsed?.translation))
    return response({error:'Draft failed source integrity checks'},422,allow);
   return response({translation:parsed.translation,kind:body.kind,
    approved:false,reviewRequired:true,remainingToday:quota.remaining},200,allow);
  }catch{return response({error:'Free translation temporarily unavailable'},503,allow);}
 }
};
