// Central fail-closed resolver for NotificationTemplate.dynamic_url_type.
// A link is only navigation, never authorization; destination pages must
// independently check the signed-in user and event membership.
import {PULSE_ORIGIN} from './notificationValidation.ts';
const EVENT=/^[A-Za-z0-9_-]{3,100}$/;
type Role='admin'|'supplier'|'client';
export function notificationRecipientRole(user:any):Role|null{
 if(user?.role==='admin')return 'admin';
 if(user?.user_type==='supplier')return 'supplier';
 if(user?.user_type==='client')return 'client';
 return null;
}
export function buildNotificationSmartLink(type:unknown,context:{
 eventId?:string;role?:Role|null
}):string{
 const role=context?.role;
 if(!['admin','supplier','client'].includes(String(role)))return '';
 const eventId=context?.eventId||'';
 const hasEvent=EVENT.test(eventId);
 const eventQuery=hasEvent?'?id='+encodeURIComponent(eventId):'';
 let path='';
 switch(type){
  case 'event_page':
   if(hasEvent)path=role==='supplier'?'/SupplierEventView'+eventQuery:
    '/EventDetails'+eventQuery;
   break;
  case 'payment_page':
   if(role!=='supplier'&&hasEvent)
    path='/EventDetails'+eventQuery+'&tab=financial';
   break;
  case 'assignment_page':
   if(role==='supplier')path='/SupplierDashboard';
   else if(role==='admin'&&hasEvent)
    path='/EventDetails'+eventQuery+'&tab=services';
   break;
  case 'calendar_page':
   path=role==='admin'?'/EventsBoardPage':
    role==='supplier'?'/SupplierCalendarDashboard':'/ClientDashboard';
   break;
  case 'settings_page':
   path='/MyNotificationSettings';
   break;
  default:return '';
 }
 return path?PULSE_ORIGIN+path:'';
}
