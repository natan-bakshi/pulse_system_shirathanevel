// READ-ONLY Green API callback-shape adapter, not a public webhook endpoint.
// Normalizes the documented selection formats only. Provider authentication
// must happen BEFORE calling this; account id MUST come from trusted settings.
// No message text/selected display text is persisted or used as an action.
// Reference: Green API selected-buttons and InteractiveButtonsReply beta docs.
const ID=/^[A-Za-z0-9_-]{5,180}$/;
const BUTTON=/^[A-Za-z0-9_.-]{1,128}$/;
const PRIVATE_CHAT=/^[1-9][0-9]{7,14}@c\.us$/;
export type ParsedGreenButtonClick={
 provider:'green';senderAccountId:string;providerEventId:string;
 originalProviderMessageId:string;senderChatId:string;buttonId:string;
 providerTimestampSeconds:number;callbackFormat:string
};
export function parseGreenButtonSelection(raw:any,expectedInstanceId:string,
 now=Date.now()):ParsedGreenButtonClick|null{
 if(!raw||typeof raw!=='object'||raw.typeWebhook!=='incomingMessageReceived'||
  !/^[0-9]{5,20}$/.test(String(expectedInstanceId||''))||
  String(raw.instanceData?.idInstance)!==String(expectedInstanceId)||
  raw.instanceData?.typeInstance!=='whatsapp')return null;
 const sender=raw.senderData?.chatId;
 if(typeof sender!=='string'||!PRIVATE_CHAT.test(sender)||
  raw.senderData?.sender!==sender)return null;
 const messageId=raw.idMessage;
 if(typeof messageId!=='string'||!ID.test(messageId))return null;
 const t=raw.timestamp;
 // Green retries callbacks for up to 24h. A bounded 48h timestamp window
 // allows replay dedup but discards unreasonable/future provider messages.
 if(!Number.isSafeInteger(t)||t<0||Math.abs(now-t*1000)>48*3600000||
  t*1000>now+300000)return null;
 const body=raw.messageData;
 if(!body||typeof body!=='object')return null;
 let selected:any=null,original:any=null;
 switch(body.typeMessage){
  case 'buttonsResponseMessage':
   selected=body.buttonsResponseMessage?.selectedButtonId;
   original=body.buttonsResponseMessage?.stanzaId;
   break;
  case 'templateButtonsReplyMessage':
  case 'templateButtonReplyMessage':
   // Green's own documentation has both singular and plural typeMessage
   // spelling across examples; the nested reply object is singular in both.
   // Always require the original stanza and signed selectedId, never text.
   selected=body.templateButtonReplyMessage?.selectedId;
   original=body.templateButtonReplyMessage?.stanzaId;
   break;
  case 'interactiveButtonsResponse':
   selected=body.interactiveButtonsResponse?.selectedId;
   original=body.interactiveButtonsResponse?.stanzaId;
   if(body.quotedMessage?.stanzaId &&
     body.quotedMessage.stanzaId!==original)return null;
   break;
  default:return null;
 }
 if(typeof selected!=='string'||!BUTTON.test(selected)||
  typeof original!=='string'||!ID.test(original))return null;
 return {provider:'green',senderAccountId:String(expectedInstanceId),
  providerEventId:messageId,originalProviderMessageId:original,
  senderChatId:sender,buttonId:selected,providerTimestampSeconds:t,
  callbackFormat:body.typeMessage};
}
