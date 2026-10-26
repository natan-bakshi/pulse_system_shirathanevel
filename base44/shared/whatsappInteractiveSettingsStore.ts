// Draft-only interactive WhatsApp settings for the single-company Shirat HaNevel app.
// No public actions, outbound provider traffic or tenant onboarding is enabled here.
import {readWhatsAppQueueControl} from './whatsappOutbox.ts';
import {defaultCompanyWhatsAppPolicy,normalizeCompanyWhatsAppPolicy} from './whatsappInteractiveCompanyPolicy.ts';

export const SHIRAT_WHATSAPP_COMPANY_ID = 'shirat_hanevel' as const;
const FIELDS={
  green:'interactive_assignment_green_policy_json',
  wasender:'interactive_assignment_wasender_policy_json'
} as const;
type Provider=keyof typeof FIELDS;
function fail(message:string,status:number) {
  return Object.assign(new Error(message),{status});
}
function providerOrThrow(input:any):Provider {
  if(input!=='green' && input!=='wasender')throw fail('Unsupported WhatsApp provider',400);
  return input;
}
export function parseSavedWhatsAppInteractivePolicy(control:any,providerInput:any) {
  const provider=providerOrThrow(providerInput);
  const raw=control?.[FIELDS[provider]];
  const fallback=defaultCompanyWhatsAppPolicy(SHIRAT_WHATSAPP_COMPANY_ID,provider);
  if(raw===undefined||raw===null||raw==='')return {setting:fallback,configured:false,corrupt:false};
  if(typeof raw!=='string'||raw.length>4096)return {setting:fallback,configured:true,corrupt:true};
  try {
    const setting=normalizeCompanyWhatsAppPolicy(JSON.parse(raw));
    if(setting.companyId!==SHIRAT_WHATSAPP_COMPANY_ID || setting.provider!==provider ||
       setting.messageKind!=='assignment')throw Error('Stored policy scope does not match');
    return {setting,configured:true,corrupt:false};
  }catch{
    return {setting:fallback,configured:true,corrupt:true};
  }
}
export async function readSavedWhatsAppInteractivePolicy(client:any,providerInput:any) {
  const control=await readWhatsAppQueueControl(client);
  return parseSavedWhatsAppInteractivePolicy(control,providerInput);
}
export async function saveWhatsAppInteractivePolicyDraft(client:any,input:any) {
  const provider=providerOrThrow(input?.provider);
  // The app is Shirat HaNevel only: never accept arbitrary tenant scope.
  if(input.companyId!==undefined && input.companyId!==SHIRAT_WHATSAPP_COMPANY_ID)
    throw fail('Company scope is not authorized',403);
  if(input.messageKind!==undefined && input.messageKind!=='assignment')
    throw fail('Unsupported WhatsApp template',400);
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)
    throw fail('Expected version is required',400);

  const control=await readWhatsAppQueueControl(client);
  const field=FIELDS[provider];
  const current=parseSavedWhatsAppInteractivePolicy(control,provider);
  if(current.corrupt)throw fail('Saved policy is invalid; owner review is required',409);
  if(current.setting.version!==input.expectedVersion)
    throw fail('Settings changed; refresh before saving',409);

  let next;
  try {
    next=normalizeCompanyWhatsAppPolicy({
      companyId:SHIRAT_WHATSAPP_COMPANY_ID,provider,messageKind:'assignment',
      version:current.setting.version+1,
      officeNumber:input.officeNumber,policy:input.policy
    });
  }catch{throw fail('Invalid interactive WhatsApp draft',400);}
  const serialized=JSON.stringify(next);
  if(serialized.length>4096)throw fail('Draft exceeds size limit',400);

  // Compare-and-swap against the full previous JSON: two editor tabs cannot
  // silently overwrite one another. Never modify worker/enqueue lease fields.
  const updated=await client.asServiceRole.entities.WhatsAppQueueControl.updateMany({
    id:control.id,control_key:'global',[field]:control[field]??null
  },{$set:{[field]:serialized}});
  if(updated?.updated!==1)throw fail('Settings changed; refresh before saving',409);
  return {setting:next,configured:true,corrupt:false};
}
