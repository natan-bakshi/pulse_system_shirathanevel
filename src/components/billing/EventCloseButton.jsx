import React from "react";
import {useQuery} from "@tanstack/react-query";
import {agreementAction} from "@/lib/agreementApi";
import {Button} from "@/components/ui/button";
import {FileCheck2} from "lucide-react";
export default function EventCloseButton({event}){
 const {data,isSuccess}=useQuery({queryKey:["eventAgreement",event.id],queryFn:()=>agreementAction("list",{eventId:event.id}),staleTime:45000});
 if(!isSuccess||event.status!=="quote"||data.agreements?.some(a=>a.signed_at))return null;
 return <Button className="bg-amber-50 text-red-900 border border-amber-200 hover:bg-amber-100" onClick={()=>window.dispatchEvent(new CustomEvent("open-event-closing",{detail:event.id}))}><FileCheck2 className="h-4 w-4 ml-2"/>סגור אירוע</Button>;
}
