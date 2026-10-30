// Owner-signed, bounded one-company GREEN pilot scope. Stored ONLY in the
// existing QueueControl row, separate from all queue pacing/worker controls.
// An arbitrary admin may edit the JSON entity field, but cannot forge the
// server HMAC to authorize a different assignment or private phone.
// Stopping sends retains already-accepted inbound scopes until token expiry.
// No provider request, supplier status write or outbound enqueue here.
export const LEGACY_GREEN_PILOT_FIELD='interactive_legacy_assignment_pilot_json';
export const LEGACY_GREEN_PILOT_CONFIRM='I_APPROVE_ONE_REAL_ASSIGNMENT_BUTTON_PILOT';
const ID=/^[A-Za-z0-9_-]{3,100}$/;
const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const TTL_MS=2*86400000;
const CLOCK_SKEW=120000;
const encoder=new TextEncoder();
const CXT='pulse.green.legacy.assignment.pilot.v1:';
const fail=()=>{throw Error('Invalid or unverified Green pilot configuration');};
const isTime=(v:any)=>typeof v==='string'&&
 Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export type PilotTarget={eventServiceId:string;supplierId:string;chatId:string;
 createdAt:string;expiresAt:string};
export type LegacyPilotPayload={version:1;active:boolean;
 current:PilotTarget|null;previous:PilotTarget[]};
type Stored={payload:LegacyPilotPayload;mac:string};
const equalString=(a:string,b:string)=>{
 if(a.length!==b.length)return false;
 let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);
 return x===0;
};
function canonicalTarget(t:any,now:number){
 if(!t||typeof t!=='object'||Array.isArray(t)||
  Object.keys(t).sort().join(',')!=='chatId,createdAt,eventServiceId,expiresAt,supplierId'||
  !ID.test(t.eventServiceId||'')||!ID.test(t.supplierId||'')||
  !PRIVATE.test(t.chatId||'')||!isTime(t.createdAt)||!isTime(t.expiresAt))
  fail();
 const created=Date.parse(t.createdAt),expiry=Date.parse(t.expiresAt);
 if(created>now+CLOCK_SKEW||expiry<=created||
  expiry-created!==TTL_MS)fail();
 return {eventServiceId:t.eventServiceId,supplierId:t.supplierId,
  chatId:t.chatId,createdAt:t.createdAt,expiresAt:t.expiresAt} as PilotTarget;
}
function canonicalPayload(p:any,now:number):LegacyPilotPayload{
 if(!p||typeof p!=='object'||Array.isArray(p)||
  p.version!==1||typeof p.active!=='boolean'||
  !Array.isArray(p.previous)||p.previous.length>3||
  Object.keys(p).sort().join(',')!=='active,current,previous,version')fail();
 const current=p.current===null?null:canonicalTarget(p.current,now);
 const previous=p.previous.map((v:any)=>canonicalTarget(v,now));
 if(p.active&&!current)fail();
 const ids=[...(current?[current]:[]),...previous]
  .map(x=>x.eventServiceId+':'+x.supplierId+':'+x.chatId);
 if(new Set(ids).size!==ids.length)fail();
 return {version:1,active:p.active,current,previous};
}
async function keyFor(secret:string,subtle:SubtleCrypto){
 if(typeof secret!=='string'||secret.length<32)fail();
 return subtle.importKey('raw',encoder.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function toBase64(buffer:ArrayBuffer){
 let s='';for(const n of new Uint8Array(buffer))s+=String.fromCharCode(n);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
export async function signLegacyGreenPilotState(payload:LegacyPilotPayload,
 secret:string,now=Date.now(),subtle:SubtleCrypto=crypto.subtle){
 const normalized=canonicalPayload(payload,now);
 const serialized=JSON.stringify(normalized);
 const mac=toBase64(await subtle.sign('HMAC',await keyFor(secret,subtle),
  encoder.encode(CXT+serialized)));
 return JSON.stringify({payload:normalized,mac} as Stored);
}
export async function verifyLegacyGreenPilotState(raw:any,secret:string,
 now=Date.now(),subtle:SubtleCrypto=crypto.subtle):Promise<LegacyPilotPayload|null>{
 if(raw===undefined||raw===null||raw==='')return null;
 try{
  if(typeof raw!=='string'||raw.length>2600)fail();
  const parsed=JSON.parse(raw) as Stored;
  if(!parsed||Object.keys(parsed).sort().join(',')!=='mac,payload'||
   typeof parsed.mac!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(parsed.mac))fail();
  const payload=canonicalPayload(parsed.payload,now);
  const current=JSON.stringify(payload);
  // Canonical encoding check also protects against accidentally signing
  // polluted JSON objects, unexpected fields or duplicate representations.
  if(!equalString(current,JSON.stringify(parsed.payload)))fail();
  const expected=toBase64(await subtle.sign('HMAC',await keyFor(secret,subtle),
   encoder.encode(CXT+current)));
  if(!equalString(expected,parsed.mac))fail();
  return payload;
 }catch{return null;}
}
export function pilotTarget(eventServiceId:string,supplierId:string,chatId:string,
 now=Date.now()):PilotTarget{
 return canonicalTarget({
  eventServiceId,supplierId,chatId,createdAt:new Date(now).toISOString(),
  expiresAt:new Date(now+TTL_MS).toISOString()
 },now);
}
// Owner may rearm while last accepted replies remain valid; hold <=3 previous
// scopes and never return expired scopes as newly activated destinations.
export function nextLegacyGreenPilotState(current:LegacyPilotPayload|null,
 target:PilotTarget|null,now=Date.now()):LegacyPilotPayload{
 const previous=[...(current?.current?[current.current]:[]),
  ...(current?.previous||[])].filter(t=>Date.parse(t.expiresAt)>now&&
  (!target||!(t.eventServiceId===target.eventServiceId&&
   t.supplierId===target.supplierId&&t.chatId===target.chatId))).slice(0,3);
 const next=target||current?.current||null;
 return canonicalPayload({version:1,active:!!target,current:next,previous},now);
}
export const outboundLegacyPilotTarget=(p:LegacyPilotPayload|null,now=Date.now())=>
 p?.active&&p.current&&Date.parse(p.current.expiresAt)>now?p.current:null;
export function inboundLegacyPilotTarget(p:LegacyPilotPayload|null,
 chatId:string,now=Date.now()):PilotTarget|null{
 if(!PRIVATE.test(chatId||''))return null;
 return [...(p?.current?[p.current]:[]),...(p?.previous||[])]
  .find(t=>t.chatId===chatId&&Date.parse(t.expiresAt)>now)||null;
}
