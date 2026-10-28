// Common WhatsApp entry point. All business callers enqueue; only the outbox worker
// may invoke sendWhatsAppTransport. No message-type-specific delay/retry here.
import { sanitizeText, LIMITS } from './notificationValidation.ts';
import { sendWasenderTextToChat, sendWasenderDocumentToChat } from './wasenderSend.ts';
import { enqueueWhatsApp, readWhatsAppQueueControl } from './whatsappOutbox.ts';
import { resolveWhatsAppProvider } from './whatsappProviderConfig.ts';
import { parseWhatsAppPhone } from './whatsappPhone.ts';

const GREEN_API_BASE = 'https://api.green-api.com';
const REQUEST_TIMEOUT_MS = 15000;

// Historical export retained for existing callers. Both text and file sends
// now use one E.164 parser; ambiguous foreign numbers fail closed.
export function normalizeIsraeliPhone(phone) {
  return parseWhatsAppPhone(phone).digits;
}

export function toChatId(phone) {
  return parseWhatsAppPhone(phone).chatId;
}

export function sanitizeMessage(message) { return sanitizeText(message, LIMITS.message); }
export function sanitizeCaption(caption) { return sanitizeText(caption, LIMITS.caption); }
export function sanitizeFileName(name) {
  return sanitizeText(name, LIMITS.fileName).replace(/[\\/]/g, '').replace(/\.{2,}/g, '.')
    .replace(/[<>:"|?*]/g, '') || 'file';
}
function invalidInput(message) {
  return Object.assign(new Error(message), { errorCode: 400, deliveryUncertain: false });
}
function validatedChatId(chatId) {
  const cleaned = sanitizeText(chatId, 80);
  // A group is not a telephone number. A canonical person JID must not
  // contain a national trunk-zero or an unbounded number of digits.
  if (/^[0-9A-Za-z_-]+@g\.us$/.test(cleaned)) return cleaned;
  if (/^[1-9][0-9]{7,14}@c\.us$/.test(cleaned) && !/^9720/.test(cleaned)) return cleaned;
  throw invalidInput('Invalid WhatsApp target');
}
function validatedUrl(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { throw invalidInput('Invalid file url'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw invalidInput('Invalid file url');
  return parsed.href;
}
function requireBackend(client) {
  if (!client?.asServiceRole?.entities) throw new Error('WhatsApp sends must originate from a backend client');
}
// Migration guard: while the queue flag is disabled in production, keep the
// previously working direct transport available. Once enabled, NO producer
// calls a provider, and all messages enter the durable global queue.
async function routeWhatsApp(client, entry) {
  const control=await readWhatsAppQueueControl(client);
  if(control.enabled) return enqueueWhatsApp(client, entry, control);
  // Legacy direct-send fallback is NEVER permitted for a pilot assignment.
  // A queue disable between intent reconciliation and enqueue must fail closed.
  if(entry?.context?.qaButtonsRequired===true)
    throw new Error('Pilot assignment requires durable WhatsApp queue');
  if(control.paused) throw new Error('WhatsApp is paused by the administrator');
  const provider=await resolveWhatsAppProvider(client);
  const receipt=await sendWhatsAppTransport({
    chat_id:entry.chatId,message_type:entry.messageType,
    message_text:entry.messageText||'',document_url:entry.documentUrl||'',
    file_uri:entry.fileUri||'',file_name:entry.fileName||'',caption:entry.caption||''
  },provider,client);
  return {...receipt,queued:false,status:'accepted',legacyDirect:true};
}

export async function sendWhatsAppText(phone, message, client = null, context = null) {
  requireBackend(client);
  const chatId = toChatId(phone);
  if (!chatId) throw invalidInput('Invalid WhatsApp phone number');
  const text = sanitizeMessage(message);
  if (!text) throw invalidInput('Empty WhatsApp message');
  return routeWhatsApp(client, { chatId, messageType: 'text', messageText: text, context });
}

export async function sendWhatsAppToChat(chatId, message, client = null, context = null) {
  requireBackend(client);
  const text = sanitizeMessage(message);
  if (!text) throw invalidInput('Empty WhatsApp message');
  return routeWhatsApp(client, {
    chatId: validatedChatId(chatId), messageType: 'text', messageText: text, context
  });
}

export async function sendWhatsAppFileByUrl(phone, fileUrl, fileName, caption, client = null, context = null) {
  requireBackend(client);
  const chatId = toChatId(phone);
  if (!chatId) throw invalidInput('Invalid WhatsApp phone number');
  return routeWhatsApp(client, {
    chatId, messageType: 'document', documentUrl: validatedUrl(fileUrl),
    fileName: sanitizeFileName(fileName), caption: sanitizeCaption(caption), context
  });
}

// Storage URI is signed just-in-time by the queue worker, not before queueing.
export async function sendWhatsAppFileUri(phone, fileUri, fileName, caption, client = null, context = null) {
  requireBackend(client);
  const chatId = toChatId(phone);
  if (!chatId) throw invalidInput('Invalid WhatsApp phone number');
  if (!fileUri || String(fileUri).length > 1800) throw invalidInput('Invalid Base44 file URI');
  return routeWhatsApp(client, {
    chatId, messageType: 'document', fileUri: String(fileUri),
    fileName: sanitizeFileName(fileName), caption: sanitizeCaption(caption), context
  });
}

async function callGreenApi(method, body) {
  const instanceId = Deno.env.get('GREEN_API_INSTANCE_ID');
  const token = Deno.env.get('GREEN_API_TOKEN');
  if (!instanceId || !token) throw new Error('Green API credentials not configured');
  let response;
  try {
    response = await fetch(GREEN_API_BASE+'/waInstance'+instanceId+'/'+method+'/'+token, {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
      signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (e) {
    console.error('[WhatsAppQueue] Green API transport uncertainty:', e instanceof Error ? e.name : 'unknown');
    throw Object.assign(new Error('WhatsApp transport response unknown'), {deliveryUncertain:true,errorCode:502});
  }
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const header=response.headers?.get?.('Retry-After') || '';
    const seconds=/^\d+$/.test(header) ? Number(header)
      : header?Math.max(0,Math.ceil((Date.parse(header)-Date.now())/1000)):0;
    throw Object.assign(new Error('WhatsApp provider rejected message'), {
      errorCode:response.status,deliveryUncertain:response.status === 408 || response.status >= 500,
      retryAfterSeconds:response.status===429?Math.min(3600,Number.isFinite(seconds)?seconds:0):0
    });
  }
  // Green API normally confirms with {idMessage}. HTTP 200 without a real
  // receipt (or with a provider-level failure payload) is NOT proof of API
  // acceptance. The provider could still have sent the message; classify as
  // UNKNOWN, not failed/retryable, to prevent duplicate WhatsApp deliveries.
  const messageId=typeof data?.idMessage==='string'?data.idMessage.trim():'';
  if(data?.success===false || !messageId){
    console.error('[WhatsAppQueue] Green API 2xx receipt missing or negative');
    throw Object.assign(new Error('Green API returned an unverified receipt'),{
      deliveryUncertain:true,errorCode:502
    });
  }
  return { success:true,provider:'green',messageId,idMessage:messageId,deliveryStatus:'accepted' };
}

// Queue-worker-only transport. Never call from business functions/endpoints.
export async function sendWhatsAppTransport(job, provider, client, interactivePreview = null) {
  const chatId = validatedChatId(job.chat_id);
  if (provider !== 'green' && provider !== 'wasender') throw new Error('Unsupported WhatsApp provider');
  let fileUrl = '';
  if (job.message_type === 'document') {
    if (job.file_uri) {
      const signed = await client.asServiceRole.integrations.Core.CreateFileSignedUrl({
        file_uri:job.file_uri,expires_in:300
      });
      if (!signed?.signed_url) throw invalidInput('Could not prepare document link');
      fileUrl = validatedUrl(signed.signed_url);
    } else fileUrl = validatedUrl(job.document_url);
    if (provider === 'wasender') {
      return sendWasenderDocumentToChat(chatId,fileUrl,job.file_name||'file',job.caption||'');
    }
    return callGreenApi('sendFileByUrl',{
      chatId,urlFile:fileUrl,fileName:job.file_name||'file',caption:job.caption||''
    });
  }
  const text = sanitizeMessage(job.message_text);
  if (!text) throw invalidInput('Empty WhatsApp message');
  // Last-resort transport fence: a pilot-marked assignment may NEVER be sent
  // with sendMessage, even if an upstream worker path regresses in the future.
  if(job.interactive_qa_required===true&&!interactivePreview)
    throw invalidInput('Interactive-only QA assignment cannot send plain text');
  // Only the guarded worker can supply a pre-validated, frozen beta payload.
  // Ordinary messages always use the exact legacy sendMessage/sendWasender path.
  if(interactivePreview){
    const valid=provider==='green'&&job.source_type==='assignment_new'&&
      job.message_type==='text'&&job.status==='sending'&&
      typeof job.interactive_button_bindings_json==='string'&&
      job.interactive_button_bindings_json.length>0&&
      ['sendInteractiveButtons','sendInteractiveButtonsReply'].includes(interactivePreview.method)&&
      ['interactive_mixed','interactive_reply'].includes(interactivePreview.kind)&&
      interactivePreview.body?.chatId===chatId&&
      interactivePreview.body?.body&&
      Array.isArray(interactivePreview.body?.buttons)&&
      interactivePreview.body.buttons.length>=1&&interactivePreview.body.buttons.length<=3;
    if(!valid)throw invalidInput('Invalid interactive WhatsApp transport preview');
    // A signed button references the SENDING instance, not merely the current
    // default provider. Switching Green accounts must not send the frozen
    // action from a different WhatsApp number. Fail before any HTTP request.
    if(!/^[0-9]{5,20}$/.test(String(job.sender_account_id||''))||
      Deno.env.get('GREEN_API_INSTANCE_ID')!==job.sender_account_id)
      throw invalidInput('Interactive sender account no longer matches instance');
    return callGreenApi(interactivePreview.method,interactivePreview.body);
  }
  return provider === 'wasender'
    ? sendWasenderTextToChat(chatId,text)
    : callGreenApi('sendMessage',{chatId,message:text});
}
