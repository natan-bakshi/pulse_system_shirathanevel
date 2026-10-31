// Server-side, purpose-separated HMAC for future multi-kind WhatsApp
// reply buttons. This is a PREPARATORY primitive, not a webhook handler,
// delivery rollout, authorization to change a business object, or inbox.
// Live assignment v1 tokens/snapshots retain their exact existing format.
//
// SECURITY: call only from a trusted backend with the existing server secret.
// After verifying a token, authenticate the provider's incoming webhook,
// verify exact accepted Outbox origin and use a durable one-owner receipt CAS
// BEFORE dispatching any registered business handler. No raw chat text is an
// action. Unregistered and not_implemented handlers always fail closed.
import {validateInteractiveActionBindingV2,
 type InteractiveActionBindingV2,
 compareVerifiedInteractiveV2Origin} from './whatsappInteractiveActionBindingV2.ts';
import {getInteractiveActionContract,
 type InteractiveActionRegistry,REGISTERED_WHATSAPP_ACTIONS}
 from './whatsappInteractiveActionRegistry.ts';

const DOMAIN='pulse-shirat-whatsapp-interactive-action:v2\n';
const PURPOSE='pulse_shirat_interactive_reply_v2';
const NONCE=/^[A-Za-z0-9_-]{22}$/;
const BASE64=/^[A-Za-z0-9_-]+$/;
const MAX_TOKEN=2700;
const MIN_BODY=130;
const MAX_BODY=2500;
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});

type SignedPayloadV2=InteractiveActionBindingV2 & {
 purpose:typeof PURPOSE;nonce:string
};
function fail(message:string):never{
 throw Error('Invalid WhatsApp V2 signed action: '+message);
}
function encoding(bytes:Uint8Array){
 let raw='';for(const b of bytes)raw+=String.fromCharCode(b);
 return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decoding(value:string,limit:number):Uint8Array{
 if(typeof value!=='string'||value.length<1||value.length>limit||
  !BASE64.test(value)||value.length%4===1)fail('base64url');
 let raw:string;
 try{raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+
    '='.repeat((4-value.length%4)%4));}
 catch{fail('base64url');}
 const bytes=Uint8Array.from(raw,character=>character.charCodeAt(0));
 if(encoding(bytes)!==value)fail('noncanonical_base64url');
 return bytes;
}
function nonce():string{
 return encoding(crypto.getRandomValues(new Uint8Array(16)));
}
function actionAllowed(binding:InteractiveActionBindingV2,
 registry:InteractiveActionRegistry){
 const action=getInteractiveActionContract(binding.messageKind,binding.action,registry);
 // A new action remains completely unusable until its audited handler has
 // actually been registered. No URL button can impersonate a reply.
 return !!action&&action.delivery==='reply'&&
  action.handler!=='office_link'&&action.handler!=='not_implemented';
}
async function signingKey(secret:string,subtle:SubtleCrypto):Promise<CryptoKey>{
 if(typeof secret!=='string'||secret.length<32||secret.length>512)
  fail('server_secret');
 return subtle.importKey('raw',encoder.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function payloadFrom(raw:any,registry:InteractiveActionRegistry,
 now:number):SignedPayloadV2{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  raw.purpose!==PURPOSE||typeof raw.nonce!=='string'||!NONCE.test(raw.nonce))
  fail('purpose_or_nonce');
 const binding=validateInteractiveActionBindingV2(
  Object.fromEntries(Object.entries(raw).filter(([key])=>
   key!=='purpose'&&key!=='nonce')),registry,now);
 if(!actionAllowed(binding,registry))fail('unimplemented_action');
 return {purpose:PURPOSE,nonce:raw.nonce,...binding};
}
function signedMessage(encodedBody:string){
 return 'v2.'+encodedBody;
}
export async function createSignedWhatsAppActionV2(input:{
 binding:InteractiveActionBindingV2;secret:string;
 now?:number;registry?:InteractiveActionRegistry
},subtle:SubtleCrypto=crypto.subtle):Promise<string>{
 const now=input?.now??Date.now(),registry=input?.registry??REGISTERED_WHATSAPP_ACTIONS;
 const key=await signingKey(input?.secret,subtle);
 const binding=validateInteractiveActionBindingV2(input?.binding,registry,now);
 if(!actionAllowed(binding,registry))fail('unimplemented_action');
 const payload:SignedPayloadV2={purpose:PURPOSE,nonce:nonce(),...binding};
 const json=JSON.stringify(payload);
 const body=encoding(encoder.encode(json));
 if(body.length<MIN_BODY||body.length>MAX_BODY)fail('payload_length');
 const msg=signedMessage(body);
 const signature=encoding(new Uint8Array(await subtle.sign('HMAC',key,
  encoder.encode(DOMAIN+msg))));
 const token=msg+'.'+signature;
 if(token.length>MAX_TOKEN)fail('token_length');
 return token;
}
export async function verifySignedWhatsAppActionV2(input:{
 token:string;secret:string;now?:number;registry?:InteractiveActionRegistry
},subtle:SubtleCrypto=crypto.subtle):Promise<SignedPayloadV2|null>{
 const token=input?.token,now=input?.now??Date.now(),registry=input?.registry??REGISTERED_WHATSAPP_ACTIONS;
 if(typeof token!=='string'||token.length<50||token.length>MAX_TOKEN)return null;
 const chunks=token.split('.');
 if(chunks.length!==3||chunks[0]!=='v2'||chunks[2].length!==43||
  chunks[1].length<MIN_BODY||chunks[1].length>MAX_BODY)return null;
 try{
  const key=await signingKey(input?.secret,subtle);
  const signature=decoding(chunks[2],43);
  if(signature.length!==32||
   !await subtle.verify('HMAC',key,signature,
    encoder.encode(DOMAIN+signedMessage(chunks[1]))))return null;
  const decoded=decoder.decode(decoding(chunks[1],MAX_BODY));
  const candidate=JSON.parse(decoded);
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||
   Object.keys(candidate).length!==18)return null;
  const normalized=payloadFrom(candidate,registry,now);
  // Reject altered representations, duplicate JSON names and extra fields
  // even if a caller attempts to construct an alternative signed encoding.
  if(JSON.stringify(normalized)!==decoded)return null;
  return Object.freeze(normalized);
 }catch{return null;}
}
// Convenience verifier for an ALREADY AUTHENTICATED provider event.
// This does not fetch Outbox or authenticate Green/Wasender's HTTP callback,
// does not claim a durable receipt and never runs any business handler.
export async function verifySignedWhatsAppV2Origin(input:{
 token:string;secret:string;trustedOutbox:any;
 authenticatedProviderEvent:any;now?:number;
 registry?:InteractiveActionRegistry
},subtle:SubtleCrypto=crypto.subtle):Promise<SignedPayloadV2|null>{
 const now=input?.now??Date.now(),registry=input?.registry??REGISTERED_WHATSAPP_ACTIONS;
 const signed=await verifySignedWhatsAppActionV2({
  token:input?.token,secret:input?.secret,now,registry
 },subtle);
 if(!signed)return null;
 const {purpose,nonce,...binding}=signed;
 return compareVerifiedInteractiveV2Origin(binding,input.trustedOutbox,
  input.authenticatedProviderEvent,registry,now)?signed:null;
}
