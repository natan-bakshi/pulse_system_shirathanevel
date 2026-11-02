// Prevent protected routes mounting their page components before Layout's
// redirect effect. Not an authorization boundary for API/data: RLS and server
// functions must independently enforce access.
const ADMIN=new Set([
 'AdminDashboard','EventManagement','EventsBoardPage','ClientManagement',
 'SupplierManagement','ServiceManagement','QuoteTemplateManagement',
 'UserManagement','ManualQuoteEditor','MyTasks','BillingDashboard'
]);
const SUPPLIER=new Set(['SupplierDashboard','SupplierCalendarDashboard',
 'SupplierEventView']);
export function canMountPulsePage(user,path,ownerEmail){
 if(!user||typeof path!=='string')return false;
 const first=path.split('?')[0].replace(/^\/+/, '').split('/')[0];
 if(ADMIN.has(first))return user.role==='admin';
 if(first==='SettingsPage')
  return user.role==='admin'&&
   String(user.email||'').toLowerCase()===String(ownerEmail||'').toLowerCase();
 if(first==='ClientDashboard'||first==='EventDetails')
  return user.role==='admin'||user.user_type==='client'||
   (first==='EventDetails'&&user.user_type==='supplier');
 if(SUPPLIER.has(first))
  return user.role==='admin'||user.user_type==='supplier';
 return true;
}
