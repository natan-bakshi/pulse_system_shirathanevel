// INTERNAL, bounded request-decoder for a FUTURE Green API button webhook.
// This module DOES NOT register an HTTP endpoint, call a provider, write the
// database, or grant permission to mutate assignments. Production rollout OFF.
// Input secret/capability come only from trusted backend settings, never JSON.
// Verify provider bearer token before consuming any request body. Then decode
// at most 32 KiB raw UTF-8 JSON while streaming; Content-Length alone is not
// trusted. A public function requires a separate durable admission/rate limiter,
// account capability QA, owner approval, and safe callback ACK policy.
import {authenticateWhatsAppProviderCallback} from './whatsappProviderWebhookAuth.ts';
const MAX_BYTES=32768;
const MIN_BYTES=20;
type HeadersLike={get:(name:string)=>string|null};
type Accepted={ok:true;status:200;headers:HeadersLike;rawCallback:any;callbackByteLength:number};
type Rejected={ok:false;status:400|401|404|405|413|415;reason:string;noProviderCalls:true;noDatabaseCalls:true};
type BoundaryResult=Accepted|Rejected;
const refused=(status:Rejected['status'],reason:string):Rejected=>({
 ok:false,status,reason,noProviderCalls:true,noDatabaseCalls:true
});
async function readBoundedBytes(body:any):Promise<Uint8Array|null>{
 if(!body||typeof body.getReader!=='function')return null;
 const reader=body.getReader();
 const chunks:Uint8Array[]=[];
 let length=0;
 try{
  while(true){
   const step=await reader.read();
   if(step.done)break;
   const chunk=step.value;
   if(!(chunk instanceof Uint8Array)||chunk.byteLength===0)continue;
   length+=chunk.byteLength;
   if(length>MAX_BYTES)return null;
   chunks.push(chunk);
  }
  if(length<MIN_BYTES)return null;
  const output=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
  return output;
 }finally{
  // Stop reading larger-than-allowed streams; this decoder owns the body.
  try{await reader.cancel();}catch{}
  try{reader.releaseLock();}catch{}
 }
}
export async function decodeFutureGreenInteractiveHttpRequest(request:any,config:{
 rolloutAuthorized:boolean;accountCapabilityVerified:boolean;
 webhookSecret:string
}):Promise<BoundaryResult>{
 // Deliberately do not touch the request or DB when rollout is disabled.
 if(config?.rolloutAuthorized!==true||config?.accountCapabilityVerified!==true)
  return refused(404,'callback_not_enabled');
 if(request?.method!=='POST')return refused(405,'method_not_allowed');
 const headers=request?.headers as HeadersLike;
 if(!headers||typeof headers.get!=='function')
  return refused(400,'invalid_headers');
 const type=String(headers.get('content-type')||'');
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type))
  return refused(415,'unsupported_content_type');
 const encoding=String(headers.get('content-encoding')||'identity').toLowerCase();
 if(encoding!=='identity')return refused(415,'unsupported_content_encoding');
 const lengthHeader=headers.get('content-length');
 if(lengthHeader!==null && (!/^[0-9]{1,8}$/.test(lengthHeader)||
   Number(lengthHeader)>MAX_BYTES))
  return refused(413,'invalid_content_length');
 if(!authenticateWhatsAppProviderCallback({
  provider:'green',headers,webhookSecret:config.webhookSecret
 }))return refused(401,'provider_authentication_failed');
 let bytes:Uint8Array|null;
 try{bytes=await readBoundedBytes(request.body);}
 catch{return refused(400,'unreadable_callback_body');}
 if(!bytes)return refused(413,'invalid_callback_size');
 if(lengthHeader!==null&&Number(lengthHeader)!==bytes.length)
  return refused(400,'content_length_mismatch');
 let parsed:any;
 try{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(text.charCodeAt(0)===0xfeff)throw Error('BOM not allowed');
  parsed=JSON.parse(text);
 }catch{return refused(400,'invalid_json_utf8');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
  return refused(400,'invalid_callback_object');
 return {ok:true,status:200,headers,rawCallback:parsed,callbackByteLength:bytes.length};
}
