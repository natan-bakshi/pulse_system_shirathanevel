import React, {useState} from "react";
import {base44} from "@/api/base44Client";
import ClosingIntroDialog from "./ClosingIntroDialog";
import {useQuery} from "@tanstack/react-query";
import {agreementAction} from "@/lib/agreementApi";
import {Button} from "@/components/ui/button";
import {FileCheck2} from "lucide-react";
export default function EventCloseButton({event}){
 const [introOpen,setIntroOpen]=useState(false);
 const {data:user}=useQuery({queryKey:["closingIntroUser"],queryFn:()=>base44.auth.me()});
 const key=user?.id?"closing_intro_hidden:"+user.id:null;
 const start=()=>window.dispatchEvent(new CustomEvent("open-event-closing",{detail:event.id}));
 const choose=(remember,proceed)=>{if(remember&&key)localStorage.setItem(key,"true");setIntroOpen(false);if(proceed)start();};
 const {data,isSuccess}=useQuery({queryKey:["eventAgreement",event.id],queryFn:()=>agreementAction("list",{eventId:event.id}),staleTime:45000});
 if(!isSuccess||event.status!=="quote"||data.agreements?.some(a=>a.signed_at))return null;
 return <><Button className="bg-amber-50 text-red-900 border border-amber-200 hover:bg-amber-100" onClick={()=>key&&localStorage.getItem(key)==="true"?start():setIntroOpen(true)}><FileCheck2 className="h-4 w-4 ml-2"/>סגור אירוע</Button><ClosingIntroDialog open={introOpen} onChoice={choose}/></>;
}