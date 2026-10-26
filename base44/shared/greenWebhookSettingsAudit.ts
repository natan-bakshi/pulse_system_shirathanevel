// Owner-triggered Green API GetSettings audit: READ ONLY, never SetSettings.
// One GET only, no retries, no Base44 DB calls or message sends. Not invoked
// by page render, queue status, readiness, schedule or any webhook.
// Green GetSettings returns webhookUrlToken/wid/URL; never include any of these,
// provider credentials, raw errors or response payload in UI/logs.
const INSTANCE=/^[0-9]{5,20}$/;
const TOKEN=/^[A-Za-z0-9_-]{10,256}$/;
const STATUS_KEYS=[
 'incomingWebhook','outgoingWebhook','outgoingMessageWebhook',
 'outgoingAPIMessageWebhook','stateWebhook','deviceWebhook',
 'pollMessageWebhook','editedMessageWebhook','deletedMessageWebhook',
 'incomingCallWebhook','incomingMessageStatusWebhook'
] as const;
type Flag='yes'|'no'|'unknown';
const flag=(value:unknown):Flag=>value==='yes'?'yes':value==='no'?'no':'unknown';
const failure=()=>Object.assign(new Error('Green settings inspection unavailable'),{code:'green_settings_unavailable'});
export function summarizeGreenWebhookSettings(settings:any){
 if(!settings||typeof settings!=='object'||Array.isArray(settings))
  throw failure();
 const raw=settings.webhookUrl;
 if(raw!==undefined&&typeof raw!=='string')throw failure();
 const webhookConfigured=typeof raw==='string'&&raw.length>0;
 const flags:Record<string,Flag>={};
 for(const key of STATUS_KEYS)flags[key]=flag(settings[key]);
 const selectedFlags=STATUS_KEYS.filter(key=>flags[key]==='yes');
 const incoming=flags.incomingWebhook;
 const webhookTokenConfigured=typeof settings.webhookUrlToken==='string'&&
  settings.webhookUrlToken.length>0;
 const delay=settings.delaySendMessagesMilliseconds;
 const sendDelayMs=Number.isInteger(delay)&&delay>=0&&delay<=600000?delay:null;
 const existingWebhookMustBePreserved=webhookConfigured;
 const endpointProtocol=webhookConfigured
  ?(/^https:\/\/[^\s]+$/i.test(raw)?'https':'non_https_or_invalid')
  :'not_configured';
 return {
  source:'green_api_get_settings_read_only',system:'shirat_hanevel',
  webhookConfigured,webhookTokenConfigured,endpointProtocol,
  notificationFlags:flags,
  activeCategories:selectedFlags.length,
  incomingNotificationsEnabled:incoming==='yes',
  webhookDeliveryMode:webhookConfigured?'push_configured':'polling_or_not_configured',
  sendDelayMs,
  existingWebhookMustBePreserved,
  incomingButtonCallbackNotProven:true,
  accountButtonCapabilityNotProven:true,
  callbackAuthNotTested:true,
  endpointHealthNotTested:true,
  webhookSettingChangesMade:false,
  noMessagesSent:true,
  noDatabaseQueries:true,
  safeToReplaceWebhookUrl:false,
  riskFlags:[
   ...(webhookConfigured?['existing_endpoint_must_be_preserved']:[]),
   ...(incoming!=='yes'?['incoming_webhook_not_confirmed_enabled']:[]),
   ...(!webhookTokenConfigured?['webhook_auth_token_not_configured']:[]),
   ...(endpointProtocol==='non_https_or_invalid'?['webhook_url_not_secure_https']:[])
  ]
 };
}
export async function inspectGreenWebhookSettingsReadOnly(config:{
 instanceId?:string;apiToken?:string;
 fetchFn?:(url:string,init:any)=>Promise<any>;
 timeoutMs?:number
}){
 const instance=config?.instanceId,token=config?.apiToken;
 if(typeof instance!=='string'||!INSTANCE.test(instance)||
  typeof token!=='string'||!TOKEN.test(token))throw failure();
 const fetchFn=config.fetchFn??fetch;
 const timeout=config.timeoutMs??6000;
 if(!Number.isInteger(timeout)||timeout<500||timeout>15000)throw failure();
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);
 try{
  // Exactly one OFFICIAL read-only Green call; no Green settings are mutated.
  const url='https://api.green-api.com/waInstance'+instance+
   '/getSettings/'+encodeURIComponent(token);
  const response=await fetchFn(url,{
   method:'GET',signal:controller.signal,redirect:'error',
   headers:{Accept:'application/json'},cache:'no-store'
  });
  if(!response?.ok||response.status!==200)throw failure();
  const declared=Number(response.headers?.get?.('content-length')||0);
  if(Number.isFinite(declared)&&declared>32768)throw failure();
  const text=await response.text();
  if(typeof text!=='string'||text.length>32768)throw failure();
  let payload;
  try{payload=JSON.parse(text);}catch{throw failure();}
  return {...summarizeGreenWebhookSettings(payload),
   providerReadCalls:1,noBackgroundPolling:true};
 }catch{throw failure();}
 finally{clearTimeout(timer);}
}
