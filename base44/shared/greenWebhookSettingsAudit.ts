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
// Only a fixed code is ever returned to the owner. Never bubble the provider
// body, URL, token, WID, network exception or raw stack to UI/logs.
const failure=(diagnosticCode='unexpected_failure')=>
 Object.assign(new Error('Green settings inspection unavailable'),{
  code:'green_settings_unavailable',diagnosticCode
 });
const PROVIDER_HOST=/^(?:[a-z0-9-]{2,32}\.)?api\.greenapi\.com$|^(?:[a-z0-9-]{2,32}\.)?api\.green-api\.com$/;
function greenApiOrigin(value:unknown){
 if(value===undefined||value===null||value==='')return 'https://api.green-api.com';
 if(typeof value!=='string'||value.length>140)throw failure('invalid_api_host');
 let url:URL;
 try{url=new URL(value);}catch{throw failure('invalid_api_host');}
 if(url.protocol!=='https:'||!PROVIDER_HOST.test(url.hostname)||
  url.username||url.password||url.port||url.search||url.hash||
  (url.pathname!==''&&url.pathname!=='/'))
  throw failure('invalid_api_host');
 return url.origin;
}
const DIAGNOSTIC_MESSAGES:Record<string,string>={
 configuration_invalid:'פרטי החיבור של Green אינם תקינים או חסרים בשרת.',
 invalid_api_host:'כתובת שרת Green המוגדרת אינה כתובת HTTPS מאושרת. בדוק את apiUrl בחשבון.',
 provider_timeout:'שרת Green לא השיב בפרק הזמן שהוקצב. ייתכן שהוא איטי או לא זמין.',
 provider_connection_unavailable:'לא ניתן להתחבר לשרת Green מהמערכת. בדוק זמינות וכתובת apiUrl.',
 provider_auth_rejected:'Green דחה את הזיהוי (HTTP 401/403). בדוק התאמה בין מזהה המופע לטוקן.',
 provider_instance_not_found:'Green לא מצא את הנתיב או המופע (HTTP 404). בדוק את apiUrl בחשבון ואת מזהה המופע.',
 provider_rate_limited:'Green הגביל זמנית את קצב הבקשות (HTTP 429).',
 provider_server_error:'שרת Green החזיר שגיאת שרת (HTTP 5xx).',
 provider_http_error:'Green דחה את בקשת הבדיקה. נדרש בירור סטטוס HTTP מול השירות.',
 provider_response_too_large:'Green החזיר תגובה גדולה מהמצופה; התוכן לא נקרא.',
 provider_response_invalid:'Green החזיר מידע שאינו בפורמט הגדרות תקין.',
 unexpected_failure:'לא הושלמה בדיקת ההגדרות. סיבת התקלה עדיין אינה ידועה.'
};
export function summarizeGreenWebhookAuditFailure(error:any){
 const candidate=String(error?.diagnosticCode||'');
 const diagnosticCode=Object.prototype.hasOwnProperty.call(DIAGNOSTIC_MESSAGES,candidate)
  ?candidate:'unexpected_failure';
 return {diagnosticCode,
  error:DIAGNOSTIC_MESSAGES[diagnosticCode]+' (קוד אבחון: '+diagnosticCode+')',
  noMessagesSent:true,webhookSettingChangesMade:false};
}
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
 instanceId?:string;apiToken?:string;apiBaseUrl?:string;
 fetchFn?:(url:string,init:any)=>Promise<any>;
 timeoutMs?:number
}){
 const instance=config?.instanceId,token=config?.apiToken;
 if(typeof instance!=='string'||!INSTANCE.test(instance)||
  typeof token!=='string'||!TOKEN.test(token))
  throw failure('configuration_invalid');
 // Green explicitly supplies an instance-specific apiUrl in its console.
 // Optional server-only GREEN_API_URL supports that HTTPS origin without
 // changing the existing sender or accepting arbitrary outbound URLs.
 const apiOrigin=greenApiOrigin(config?.apiBaseUrl);
 const fetchFn=config.fetchFn??fetch;
 const timeout=config.timeoutMs??6000;
 if(!Number.isInteger(timeout)||timeout<500||timeout>15000)
  throw failure('configuration_invalid');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);
 try{
  // Exactly ONE official read-only GET; never SetSettings or retry.
  const url=apiOrigin+'/waInstance'+instance+
   '/getSettings/'+encodeURIComponent(token);
  let response:any;
  try{
   response=await fetchFn(url,{
    method:'GET',signal:controller.signal,redirect:'error',
    headers:{Accept:'application/json'},cache:'no-store'
   });
  }catch{
   throw failure(controller.signal.aborted?'provider_timeout':'provider_connection_unavailable');
  }
  if(response?.status!==200||response?.ok!==true){
   const status=Number(response?.status);
   const reason=status===401||status===403?'provider_auth_rejected':
    status===404?'provider_instance_not_found':
    status===429?'provider_rate_limited':
    status>=500&&status<=599?'provider_server_error':'provider_http_error';
   throw failure(reason);
  }
  let declared:number;
  try{declared=Number(response.headers?.get?.('content-length')||0);}
  catch{throw failure('provider_response_invalid');}
  if(Number.isFinite(declared)&&declared>32768)
   throw failure('provider_response_too_large');
  let text:string;
  try{text=await response.text();}
  catch{throw failure('provider_response_invalid');}
  if(typeof text!=='string')throw failure('provider_response_invalid');
  if(text.length>32768)throw failure('provider_response_too_large');
  let payload:any;
  try{payload=JSON.parse(text);}catch{throw failure('provider_response_invalid');}
  try{
   return {...summarizeGreenWebhookSettings(payload),
    providerReadCalls:1,noBackgroundPolling:true};
  }catch{throw failure('provider_response_invalid');}
 }finally{clearTimeout(timer);}
}
