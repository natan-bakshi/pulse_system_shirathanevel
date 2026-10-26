// Provider-agnostic HMAC primitive for a future adapter. A provider-specific
// implementation MUST confirm the actual signature format and raw body rules.
// This is NOT a live webhook endpoint and is not a claim of provider support.
const encoder=new TextEncoder();
function hex(bytes:Uint8Array){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export async function hmacSha256Hex(secret:string,payload:string,subtle:SubtleCrypto=crypto.subtle){
 if(typeof secret!=='string'||secret.length<24||typeof payload!=='string')throw Error('Invalid webhook signature inputs');
 const key=await subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(new Uint8Array(await subtle.sign('HMAC',key,encoder.encode(payload))));
}
export function constantTimeHexEqual(left:unknown,right:unknown){
 if(typeof left!=='string'||typeof right!=='string'||!/^[a-f0-9]{64}$/i.test(left)||!/^[a-f0-9]{64}$/i.test(right))return false;
 let diff=0;
 for(let i=0;i<64;i++)diff|=left.charCodeAt(i)^right.charCodeAt(i);
 return diff===0;
}
export async function verifyWebhookHmac(input:{secret:string;rawBody:string;signature:string;
 timestampSeconds:number;maxAgeSeconds?:number},now=Date.now(),subtle:SubtleCrypto=crypto.subtle){
 const maxAge=Math.min(600,Math.max(30,input.maxAgeSeconds??300));
 if(!Number.isSafeInteger(input.timestampSeconds)||Math.abs(now-input.timestampSeconds*1000)>maxAge*1000)return false;
 if(typeof input.rawBody!=='string'||input.rawBody.length>100000)return false;
 if(typeof input.signature!=='string'||!/^[a-f0-9]{64}$/i.test(input.signature))return false;
 try{
  const expected=await hmacSha256Hex(input.secret,`${input.timestampSeconds}.${input.rawBody}`,subtle);
  return constantTimeHexEqual(expected,input.signature.toLowerCase());
 }catch{return false;}
}
