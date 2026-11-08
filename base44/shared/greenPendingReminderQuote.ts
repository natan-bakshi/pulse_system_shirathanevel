// Owner-opted-in Green native reply quoting for text-only
// SUPPLIER_PENDING_REMINDER messages. No job is delayed or retried for a
// missing quote. The original reference must have been sent by THIS Green
// account to the EXACT same private chat and be present as delivered/read
// in Green's journal. This code never quotes interactive button messages.
import {readAssignmentIntents} from './assignmentIntent.ts';
import {chooseVerifiedGreenNativeQuote} from './greenVerifiedQuotePlanner.ts';
import {selectSupplierButtonSnapshot} from './greenSupplierButtonSnapshot.ts';
import {isCustomSupplierButtons} from './greenSupplierTemplateButtonsPolicy.ts';

const IDENT=/^[A-Za-z0-9_-]{3,100}$/;
const CHAT=/^[1-9][0-9]{7,14}@c\.us$/;
const ACCOUNT=/^[0-9]{5,20}$/;
const VERSION=/^r[1-9][0-9]{0,12}$/;
const RECEIPT=/^[A-Za-z0-9_-]{8,180}$/;
const ALLOWED_STATES=new Set(['requested','queued','accepted']);
const MAX_ORIGIN_AGE=90*86400;
const result=(quotedMessageId:string|null,reason:string,providerReads:0|1)=>
 ({quotedMessageId,reason,providerReads} as const);

// This guard uses a frozen owner setting from Outbox, never a fresh template
// lookup. A policy change cannot make a previously queued job quote anything.
export function optedInPendingQuote(job:any,provider:string,account:string):boolean{
 if(provider!=='green'||job?.source_type!=='supplier_pending_reminder'||
  job?.message_type!=='text'||job?.status!=='sending'||
  job?.requested_provider!=='green'||job?.event_service_id!==job?.source_id||
  !IDENT.test(job?.event_service_id||'')||!IDENT.test(job?.supplier_id||'')||
  !IDENT.test(job?.id||'')||!CHAT.test(job?.chat_id||'')||
  !ACCOUNT.test(account||'')||
  (job?.sender_account_id&&job.sender_account_id!==account)||
  job?.interactive_button_bindings_json||job?.interactive_v2_button_bindings_json||
  job?.interactive_qa_required)return false;
 const settings=selectSupplierButtonSnapshot(null,job);
 return isCustomSupplierButtons(settings)&&
  settings.quoteSource==='assignment_new'&&settings.links.length===0&&
  settings.replyLabel==='';
}
export async function resolvePendingReminderGreenQuote(input:{
 client:any;job:any;provider:string;senderAccountId:string;
 getGreenMessage:(chatId:string,idMessage:string)=>Promise<any>;
 now?:number
}):Promise<{
 quotedMessageId:string|null;reason:string;providerReads:0|1
}>{
 const {client,job,provider,senderAccountId}=input;
 if(!optedInPendingQuote(job,provider,senderAccountId))
  return result(null,'quote_not_requested',0);
 const db=client?.asServiceRole?.entities;
 if(!db?.EventService?.get||!db?.WhatsAppOutbox?.filter||
  typeof input.getGreenMessage!=='function')
  return result(null,'trusted_reader_unavailable',0);
 let service:any;
 try{service=await db.EventService.get(job.event_service_id);}
 catch{return result(null,'assignment_read_unavailable',0);}
 if(!service||service.id!==job.event_service_id||service.is_external===true||
  service.assignment_intent_mode!=='durable_v1')
  return result(null,'assignment_origin_unavailable',0);
 let supplierIds:any,statuses:any,intents:any[];
 try{
  supplierIds=typeof service.supplier_ids==='string'?
   JSON.parse(service.supplier_ids):service.supplier_ids;
  statuses=typeof service.supplier_statuses==='string'?
   JSON.parse(service.supplier_statuses):service.supplier_statuses;
  intents=readAssignmentIntents(service.assignment_notification_intents||'[]');
 }catch{return result(null,'assignment_journal_invalid',0);}
 if(!Array.isArray(supplierIds)||!supplierIds.includes(job.supplier_id)||
  !statuses||statuses[job.supplier_id]!=='pending')
  return result(null,'assignment_changed',0);
 const newest=[...intents].reverse().find(i=>i.supplier_id===job.supplier_id);
 if(!newest||!ALLOWED_STATES.has(newest.state)||
  !VERSION.test('r'+newest.revision)||
  newest.key!=='assignment:'+job.event_service_id+':'+job.supplier_id+
    ':r'+newest.revision+':SUPPLIER_NEW_ASSIGNMENT')
  return result(null,'not_current_assignment_intent',0);
 let origins:any;
 try{origins=await db.WhatsAppOutbox.filter({
  source_type:'assignment_new',event_service_id:job.event_service_id,
  supplier_id:job.supplier_id
 },'-created_date',2);}
 catch{return result(null,'outbox_origin_read_failed',0);}
 if(!Array.isArray(origins)||origins.length===0)
  return result(null,'no_original_assignment',0);
 const origin=origins[0];
 if(!origin||origin.status!=='accepted'||
  origin.source_type!=='assignment_new'||
  origin.event_service_id!==job.event_service_id||
  origin.supplier_id!==job.supplier_id||
  origin.idempotency_key!==newest.key||origin.requested_provider!=='green'||
  origin.provider!=='green'||origin.sender_account_id!==senderAccountId||
  origin.chat_id!==job.chat_id||!IDENT.test(origin.id||'')||
  !RECEIPT.test(origin.provider_message_id||'')||
  (origin.company_id&&origin.company_id!=='shirat_hanevel')||
  (origin.assignment_revision&&origin.assignment_revision!=='r'+newest.revision)||
  (origins.length>1&&origins[1]?.idempotency_key===newest.key))
  return result(null,'stale_or_foreign_original_assignment',0);
 const revision='r'+newest.revision;
 const reply={
  companyId:'shirat_hanevel',eventServiceId:job.event_service_id,
  supplierId:job.supplier_id,revision,chatId:job.chat_id,
  provider:'green' as const,senderAccountId
 };
 // All database/current-revision gates passed. Only now pay for ONE
 // Green GetMessage lookup; never poll, retry or query on unselected jobs.
 let journal:any;
 try{journal=await input.getGreenMessage(job.chat_id,origin.provider_message_id);}
 catch{return result(null,'provider_journal_unavailable',1);}
 if(!journal||!['delivered','read'].includes(journal.statusMessage)||
  !Number.isSafeInteger(journal.timestamp)||journal.timestamp<=0||
  Math.floor((input.now??Date.now())/1000)-journal.timestamp>MAX_ORIGIN_AGE||
  journal.timestamp>Math.floor((input.now??Date.now())/1000)+300)
  return result(null,'journal_not_delivered_or_expired',1);
 const quote=chooseVerifiedGreenNativeQuote({
  origin:{...origin,assignment_revision:revision},reply,journal,
  targetMethod:'sendMessage'
 });
 return result(quote.quotedMessageId,quote.reason,1);
}
