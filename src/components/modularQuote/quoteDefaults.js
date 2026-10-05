export const defaultContent = () => ({event_type:'בר מצווה',concept:'',guest_count:100,custom_title:'',show_title:true,show_event_type:true,show_concept:true,show_quantity:true,show_prices:true,show_summary:true,show_intro:true,show_services:true,show_descriptions:true,show_payment_terms:true,show_agreement:true,services_title:'חבילות ושירותים',intro:'',payment_terms:'',agreement:'',notes:'',items:[]});
export const visibilityFields = [['show_title','כותרת'],['show_event_type','סוג אירוע בכותרת'],['show_concept','קונספט בכותרת'],['show_quantity','כמויות'],['show_prices','מחירים'],['show_summary','סיכום כספי'],['show_intro','פתיח'],['show_services','חבילות ושירותים'],['show_descriptions','תיאורים'],['show_payment_terms','תנאי תשלום'],['show_agreement','תנאי התקשרות']];
export function makeItem(source = {}, kind = 'service', services = []) {
  const children = kind === 'package' ? (source.service_ids || []).map(id => services.find(s => s.id === id)).filter(Boolean).map(s => makeItem(s)) : [];
  return {
    id: crypto.randomUUID(), kind,
    name: source.package_name || source.service_name || (kind === 'package' ? 'חבילה חדשה' : 'שירות חדש'),
    description: source.package_description || source.service_description || '',
    quantity: 1, price: source.package_price ?? source.base_price ?? 0,
    includes_vat: source.package_includes_vat ?? source.default_includes_vat ?? false,
    visible: true, show_price: true, show_quantity: true, show_description: true, children
  };
}