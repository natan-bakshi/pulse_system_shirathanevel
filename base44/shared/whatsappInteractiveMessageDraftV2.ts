// Pure future multi-message, multi-tenant interactive settings envelope.
// Not persisted by the current assignment settings UI and never a rollout
// switch. This provides a stable *draft key* and normalized policy contract
// for new message kinds, recipients and providers without touching QA v1.
import {
 getInteractiveMessageContract,validateInteractiveMessagePolicyDraft,
 type InteractiveActionRegistry,REGISTERED_WHATSAPP_ACTIONS
} from './whatsappInteractiveActionRegistry.ts';

const ID=/^[A-Za-z0-9_-]{3,128}$/;
const PHONE=/^[1-9][0-9]{7,14}$/;
export type MessageInteractiveDraftV2={
 schemaVersion:2;companyId:string;messageKind:string;
 audience:'supplier'|'client'|'admin';provider:'green'|'wasender';
 version:number;officeNumber:string;policy:{
  schemaVersion:1;messageKind:string;enabled:false;buttons:{action:string;label:string}[]
 }
};
export function interactiveMessageDraftKey(input:{
 companyId:string;messageKind:string;provider:string
},registry:InteractiveActionRegistry=REGISTERED_WHATSAPP_ACTIONS):string{
 if(!input||typeof input.companyId!=='string'||!ID.test(input.companyId)||
  !['green','wasender'].includes(input.provider)||
  !getInteractiveMessageContract(input.messageKind,registry))
  throw Error('Invalid company, provider or message-kind draft scope');
 return 'wa_interactive_draft:v2:'+input.companyId+':'+input.provider+
  ':'+input.messageKind;
}
export function normalizeMessageInteractiveDraftV2(input:any,
 registry:InteractiveActionRegistry=REGISTERED_WHATSAPP_ACTIONS):MessageInteractiveDraftV2{
 if(!input||typeof input!=='object'||Array.isArray(input)||input.schemaVersion!==2)
  throw Error('Invalid interactive message draft version');
 const key=interactiveMessageDraftKey(input,registry);
 if(!key)throw Error('Missing interactive message draft key');
 if(!Number.isSafeInteger(input.version)||input.version<1||
  input.version>2147483647)throw Error('Invalid draft version');
 if(typeof input.officeNumber!=='string'||
  (input.officeNumber!==''&&!PHONE.test(input.officeNumber)))
  throw Error('Invalid office number');
 const kind=getInteractiveMessageContract(input.messageKind,registry)!;
 if(input.audience!==kind.audience)
  throw Error('Interactive draft audience mismatch');
 const policy=validateInteractiveMessagePolicyDraft(input.policy,registry);
 if(policy.messageKind!==kind.messageKind)
  throw Error('Interactive draft policy scope mismatch');
 const normalized:MessageInteractiveDraftV2={
  schemaVersion:2,companyId:input.companyId,messageKind:kind.messageKind,
  audience:kind.audience,provider:input.provider,version:input.version,
  officeNumber:input.officeNumber,policy:{
   schemaVersion:1,messageKind:kind.messageKind,enabled:false,buttons:policy.buttons
  }
 };
 if(JSON.stringify(normalized).length>4096)throw Error('Oversized policy draft');
 return normalized;
}
