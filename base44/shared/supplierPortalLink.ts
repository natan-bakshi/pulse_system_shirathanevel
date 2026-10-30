// Canonical supplier home already used by Pulse Layout.jsx.
// This is a plain authenticated-app link, not a callback or an approval token.
export const SUPPLIER_PORTAL_URL='https://pulse-system.base44.app/SupplierCalendarDashboard';
const TARGET=/^[A-Za-z0-9_-]{3,160}$/;
export function withSupplierPortalLink(text:string,supplierId:any):string{
 const original=String(text||'');
 if(!TARGET.test(String(supplierId||''))||!original.trim())return original;
 // Do not add duplicate links to templates that already include the portal.
 if(original.includes(SUPPLIER_PORTAL_URL))return original;
 const suffix='\n\n📅 לצפייה בלוח האירועים שלך ב־Pulse:\n'+SUPPLIER_PORTAL_URL;
 return original.length+suffix.length<=4096?original+suffix:original;
}
export function productionAssignmentPrivateTarget(
 supplier:any,currentChat:string,control:any,provider:string,
 toChatId:(phone:string)=>string
):{chatId:string;reason:string}{
 if(control?.interactive_assignment_production_enabled!==true||
  control?.interactive_outbound_live_enabled!==true||
  control?.enabled!==true||control?.paused===true||
  provider!=='green')
  return {chatId:currentChat,reason:'normal_supplier_preference'};
 if(typeof currentChat!=='string'||!currentChat.endsWith('@g.us'))
  return {chatId:currentChat,reason:'already_private'};
 // Green mixed/reply button APIs accept private chats only.
 // Override this ONE assignment notification, never supplier preferences.
 const privateChat=toChatId(String(supplier?.phone||''));
 if(!/^[1-9][0-9]{7,14}@c\.us$/.test(String(privateChat||'')))
  return {chatId:currentChat,reason:'personal_phone_unavailable'};
 return {chatId:privateChat,reason:'green_buttons_require_personal_chat'};
}
