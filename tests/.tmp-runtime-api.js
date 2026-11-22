const empty={list:async()=>[],filter:async()=>[],create:async()=>({id:'mock'}),update:async()=>({}),delete:async()=>({})};
const entities=new Proxy({QuoteOrganizerType:{list:async()=>[{id:'mock',type_name:'משפחה',is_default:true,is_active:true,event_fields:null,contacts_config:'{}'}],filter:async()=>[]}}, {get(t,n){return t[n]||empty}});
export const base44={entities,auth:{me:async()=>({id:'test',role:'admin'}),updateMe:async()=>{}},agents:{getWhatsAppConnectURL:()=>''}};
