import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getClientContacts } from '../../shared/eventFields.js';

export default async function(req) {
  try {
    if(req.method!=='POST') return Response.json({error:'Method not allowed'},{status:405});
    const base44=createClientFromRequest(req);
    const user=await base44.auth.me();
    if(!user) return Response.json({error:'Unauthorized'},{status:401});
    const {eventIds=[],includeDocuments=false}=await req.json();
    if(!Array.isArray(eventIds)||eventIds.length>100||eventIds.some(id=>typeof id!=='string'||id.length>100))return Response.json({error:'Invalid event ids'},{status:400});
    const client=base44.asServiceRole;
    const payments=[],documents=[];
    for(const id of new Set(eventIds)) {
      const event=await client.entities.Event.get(id).catch(()=>null);
      if(!event)continue;
      const email=String(user.email||'').toLowerCase();
      const allowed=user.role==='admin'||email&&(
        String(event.created_by||'').toLowerCase()===email||
        getClientContacts(event).some(c=>String(c.email||'').toLowerCase()===email)
      );
      if(!allowed)continue;
      let batch=await client.entities.Payment.filter({event_id:id},'-created_date',500);
      payments.push(...batch.map(p=>({id:p.id,event_id:p.event_id,amount:p.amount,currency:p.currency,converted_amount:p.converted_amount,payment_date:p.payment_date,payment_method:p.payment_method,payment_status:p.payment_status,notes:p.notes,receipt_image_url:p.receipt_image_url,stored_card_operation_id:p.stored_card_operation_id})));
      if(includeDocuments){
        batch=await client.entities.FinancialDocument.filter({linked_event_id:id},'-created_date',500);
        documents.push(...batch.map(d=>({id:d.id,linked_event_id:d.linked_event_id,document_type:d.document_type,document_number:d.document_number,status:d.status,total:d.total,issue_date:d.issue_date,pdf_original_url:d.pdf_original_url,pdf_certified_url:d.pdf_certified_url,is_detached_from_event:d.is_detached_from_event})));
      }
    }
    return Response.json({payments,documents});
  }catch(error){return Response.json({error:'Unable to load event finances'},{status:500});}
}