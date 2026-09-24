import { CardError } from "./storedCards.ts";
import { digest } from "./agreementRules.ts";
export async function storeConsentEvidence(client,value){
 if(typeof value!=="string"||value.length>2900000)throw new CardError("תמונת אסמכתא גדולה מדי");
 const match=value.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
 if(!match)throw new CardError("מותרת תמונת PNG או JPEG בלבד");
 let bytes;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}catch{throw new CardError("תמונה לא תקינה");}
 if(bytes.length>2097152||bytes.length<16)throw new CardError("גודל תמונה לא תקין");
 const valid=match[1]==="image/png"?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!valid)throw new CardError("תוכן התמונה אינו תואם לסוג הקובץ");
 const file=new File([bytes],"consent-"+crypto.randomUUID()+(match[1]==="image/png"?".png":".jpg"),{type:match[1]});
 const uploaded=await client.integrations.Core.UploadPrivateFile({file});
 if(!uploaded?.file_uri)throw new CardError("שמירת האסמכתא נכשלה",503);
 return {uri:uploaded.file_uri,hash:await digest(bytes)};
}
