import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getEventFields, parseObject } from '@/lib/eventFields';
export function useOrganizerConfig(name) {
  const query=useQuery({queryKey:['organizerTypes'],queryFn:()=>base44.entities.QuoteOrganizerType.list(),staleTime:5*60*1000});
  const type=(query.data || []).find(t=>t.type_name===name);
  return {...query,type,fields:getEventFields(type),contactsConfig:parseObject(type?.contacts_config)};
}
