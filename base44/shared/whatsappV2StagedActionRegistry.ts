// Staged, code-owned V2 catalog. Never enable on the live v1 assignment
// callback, Green Outbox worker or generic admin JSON without a complete
// audited V2 inbound receipt and user-approved producer rollout.
import {createInteractiveActionRegistry,REGISTERED_WHATSAPP_ACTIONS}
 from './whatsappInteractiveActionRegistry.ts';

export const STAGED_V2_WHATSAPP_ACTIONS=createInteractiveActionRegistry([
 ...REGISTERED_WHATSAPP_ACTIONS.messageKinds,
 {messageKind:'supplier_reminder',sourceType:'event_reminder',
  resourceType:'outbox_message',audience:'supplier',maxButtons:3,
  actions:[
   {action:'reminder_acknowledge',delivery:'reply',handler:'notification_ack'},
   {action:'open_supplier_portal',delivery:'url',handler:'not_implemented'},
   {action:'contact_office',delivery:'url',handler:'office_link'}
  ]}
]);
