// One deterministic NotificationTemplate link preset. The main notification
// core also uses a recipient-specific resolver. This preset keeps legacy
// scheduled/quiet-hours producers compatible by writing a matching manual
// deep_link_base + event-id params for templates with ONE recipient role.
// No cross-role event/payment link is guessed for mixed audiences.
const EVENT_ID_JSON=JSON.stringify({id:'{{event_id}}'});
function scope(audiences){
 if(!Array.isArray(audiences)||!audiences.length)return null;
 const roles=new Set(audiences.map(a=>a==='system_creator'?'admin':a));
 if([...roles].some(x=>!['admin','supplier','client'].includes(x))||
  roles.size!==1)return null;
 return [...roles][0];
}
export function notificationLinkPreset(type,audiences){
 if(type==='settings_page')return {
  deep_link_base:'MyNotificationSettings',deep_link_params_map:''
 };
 const role=scope(audiences);
 if(!role)return null;
 let deep_link_base='';
 let withEvent=false;
 switch(type){
  case 'event_page':
   deep_link_base=role==='supplier'?'SupplierEventView':'EventDetails';
   withEvent=true;
   break;
  case 'payment_page':
   if(role==='supplier')return null;
   deep_link_base='EventDetails?tab=financial';
   withEvent=true;
   break;
  case 'assignment_page':
   if(role==='client')return null;
   deep_link_base=role==='supplier'?'SupplierDashboard':'EventDetails?tab=services';
   withEvent=role==='admin';
   break;
  case 'calendar_page':
   deep_link_base=role==='supplier'?'SupplierCalendarDashboard':
    role==='admin'?'EventsBoardPage':'ClientDashboard';
   break;
  default:return null;
 }
 return {deep_link_base,deep_link_params_map:withEvent?EVENT_ID_JSON:''};
}
