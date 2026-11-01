// Read-only authorization for a client deep-link into the full event card.
// This is an additional guard, NOT a substitute for Event/EventService RLS.
import {getClientContacts} from './eventFields.js';

export function canOpenClientEventCard(user:any,event:any):boolean{
 if(!user||!event||typeof event!=='object')return false;
 if(user.role==='admin')return true;
 if(user.user_type!=='client')return false;
 const email=typeof user.email==='string'?user.email.trim().toLowerCase():'';
 if(email.length<3)return false;
 if(String(event.created_by||'').trim().toLowerCase()===email)return true;
 return getClientContacts(event).some(contact=>
  typeof contact.email==='string'&&
  contact.email.trim().toLowerCase()===email&&
  contact.client_access!==false);
}
