// Server-only HMAC authenticated action payload for future WhatsApp buttons.
// Does not authorize a business mutation without provider callback auth, supplier
// identity verified from provider data and a durable inbound receipt claim.
// Never write signing keys to Outbox, client code, logs or user-visible settings.
import {validateInteractiveActionBinding,type InteractiveActionBinding} from './whatsappInteractiveActionToken.ts';
import {allowedInboundActionIds} from './whatsappInteractiveActionRegistry.ts';

const encoder=new TextEncoder();
const MAX_TOKEN_LENGTH=2300;
const MAX_LIFETIME_MS=7*86400000;
const MAX_ISSUED_SKEW_MS=120000;
const BASE64URL=/^[A-Za-z0-9_-]+$/;
const NONCE=/^[A-Za-z0-9_-]{16,100}$/;
const AUDIENCE='shirat_whatsapp_assignment_button_v1';
type Payload=InteractiveActionBinding & {audience:string;version:1;nonce:string;issuedAt:string};
function fail(reason:string){throw new Error('Invalid signed WhatsApp action: '+reason);}
function safeKey(raw:string,subtle:SubtleCrypto){
 if(typeof raw!=='string'||raw.length<32||raw.length>512)fail('secret');
 return subtle.importKey('raw',encoder.encode(raw),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function toBase64Url(bytes:Uint8Array){
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromBase64Url(value:string){
 if(!BASE64URL.test(value)||value.length>1800)fail('encoding');
 let binary:string;
 try{binary=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));}
 catch{fail('encoding');}
 return Uint8Array.from(binary,b=>b.charCodeAt(0));
}
function validatePayload(raw:any,now:number):Payload{
 if(!raw||typeof raw!=='object'||raw.audience!==AUDIENCE||raw.version!==1||
  typeof raw.nonce!=='string'||!NONCE.test(raw.nonce))fail('payload');
 const issued=Date.parse(raw.issuedAt);
 const expires=Date.parse(raw.expiresAt);
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||
  issued>now+MAX_ISSUED_SKEW_MS||now-issued>MAX_LIFETIME_MS||
  expires<=issued||expires-issued>MAX_LIFETIME_MS)fail('lifetime');
 const binding=validateInteractiveActionBinding(raw,now);
 if(!allowedInboundActionIds('assignment').includes(binding.action))
  fail('unsupported action for inbound mutation');
 return {...binding,audience:AUDIENCE,version:1,nonce:raw.nonce,
  issuedAt:new Date(issued).toISOString()};
}
export async function createSignedWhatsAppAction(input:{
 binding:InteractiveActionBinding;secret:string;nonce:string;issuedAt?:number
},subtle:SubtleCrypto=crypto.subtle){
 const now=input.issuedAt??Date.now();
 const payload=validatePayload({
  ...input.binding,audience:AUDIENCE,version:1,nonce:input.nonce,
  issuedAt:new Date(now).toISOString()
 },now);
 const body=toBase64Url(encoder.encode(JSON.stringify(payload)));
 const message='v1.'+body;
 const key=await safeKey(input.secret,subtle);
 const sig=new Uint8Array(await subtle.sign('HMAC',key,encoder.encode(message)));
 const token=message+'.'+toBase64Url(sig);
 if(token.length>MAX_TOKEN_LENGTH)fail('length');
 return token;
}
export async function verifySignedWhatsAppAction(input:{
 token:string;secret:string;now?:number
},subtle:SubtleCrypto=crypto.subtle):Promise<Payload|null>{
 const token=input?.token,now=input?.now??Date.now();
 if(typeof token!=='string'||token.length<50||token.length>MAX_TOKEN_LENGTH)return null;
 const chunks=token.split('.');
 if(chunks.length!==3||chunks[0]!=='v1'||chunks[2].length!==43)return null;
 try{
  const key=await safeKey(input.secret,subtle);
  const signature=fromBase64Url(chunks[2]);
  if(signature.length!==32)return null;
  const message=encoder.encode('v1.'+chunks[1]);
  const verified=await subtle.verify('HMAC',key,signature,message);
  if(!verified)return null;
  const bytes=fromBase64Url(chunks[1]);
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const candidate=JSON.parse(decoded);
  return validatePayload(candidate,now);
 }catch{return null;}
}
