import {useQuery} from '@tanstack/react-query';
import {base44} from '@/api/base44Client';

// Both supplier pages share one authorized read projection and one per-account
// cache. There are no browser Event/EventService/Supplier/Service list reads.
export function useSupplierAssignmentsFeed(){
 const {data:user,isLoading:userLoading}=useQuery({
  queryKey:['currentUser'],
  queryFn:()=>base44.auth.me(),
  staleTime:5*60*1000,
  cacheTime:10*60*1000
 });
 const identity=typeof user?.email==='string'?
  user.email.trim().toLowerCase():'';
 const feed=useQuery({
  queryKey:['supplierAssignmentsFeed',user?.id||identity,identity],
  enabled:!!identity,
  queryFn:async()=>{
   const response=await base44.functions.invoke('supplierAssignmentsFeed',{});
   const data=response?.data;
   if(data?.success!==true||!Array.isArray(data.assignments))
    throw Error('Unable to load supplier assignments');
   return data;
  },
  staleTime:15*1000,
  cacheTime:60*1000,
  refetchOnWindowFocus:true,
  retry:1
 });
 return {
  user,
  supplier:feed.data?.supplier||null,
  supplierEvents:feed.data?.assignments||[],
  loading:userLoading||(!!identity&&feed.isLoading),
  feedError:feed.isError,
  reload:feed.refetch
 };
}
