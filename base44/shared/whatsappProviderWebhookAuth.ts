// Provider-specific *credential* checks for a future webhook adapter.
// Verified against provider docs on 2026-10-26:
// GREEN API WebhookURLToken is sent as Authorization: Bearer <token>.
// WasenderAPI X-Webhook-Signature contains the configured webhook secret
// (not an HMAC digest). Do NOT use generic verifyWebhookHmac for either.
// Credential authentication is only the first gate: later code MUST enforce
// correct account/session, message binding, durable replay protection,
// supplier identity and current assignment revision before ANY mutation.
// No public webhook endpoint is registered by this module.
export type WhatsAppCallbackProvider='green'|'wasender';
type HeaderSource={get:(name:string)=>string|null}|Record<string,unknown>;

function getHeader(headers:HeaderSource|undefined,name:string):string{
 if(!headers||typeof headers!=='object')return '';
 if(typeof (headers as any).get==='function'){
  const got=(headers as {get:(name:string)=>string|null}).get(name);
  return typeof got==='string'?got:'';
 }
 const key=Object.keys(headers).find(k=>k.toLowerCase()===name.toLowerCase());
 const value=key?(headers as Record<string,unknown>)[key]:undefined;
 return typeof value==='string'?value:'';
}
function safeSecret(secret:unknown):secret is string{
 return typeof secret==='string'&&secret.length>=24&&secret.length<=256&&
  /^[\x21-\x7e]+$/.test(secret);
}
function constantWorkEqual(actual:string,expected:string):boolean{
 // ASCII-only secret and fixed loop prevent a variable-length prefix exit.
 // Compare is for secret headers, not an alternative to a request signature.
 let mismatches=actual.length^expected.length;
 for(let i=0;i<256;i++)mismatches|=(actual.charCodeAt(i)||0)^(expected.charCodeAt(i)||0);
 return mismatches===0;
}
export function authenticateWhatsAppProviderCallback(input:{
 provider:WhatsAppCallbackProvider;headers:HeaderSource;webhookSecret:string
}):boolean{
 if(!input||!safeSecret(input.webhookSecret))return false;
 if(input.provider==='green'){
  const header=getHeader(input.headers,'Authorization');
  if(!header.startsWith('Bearer ')||header.length>300)return false;
  return constantWorkEqual(header.slice(7),input.webhookSecret);
 }
 if(input.provider==='wasender'){
  const header=getHeader(input.headers,'X-Webhook-Signature');
  return header.length<=256 && constantWorkEqual(header,input.webhookSecret);
 }
 return false;
}
