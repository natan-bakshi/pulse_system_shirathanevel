import React from "react";
import { Phone, MessageCircle, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PhoneNumber({ phone, className = "" }) {
    if (!phone) return <span className={className}>לא צוין</span>;
    
    const phoneNumber = phone.replace(/[^0-9]/g, '');
    const whatsappLink = `https://wa.me/972${phoneNumber.substring(1)}`;
    
    const copyToClipboard = () => {
        navigator.clipboard.writeText(phone);
    };

    return (
        <div className={`flex items-center gap-1 ${className}`}>
            <span>{phone}</span>
            <Button variant="ghost" size="icon" asChild className="h-6 w-6">
                <a href={`tel:${phone}`} title="התקשר">
                    <Phone className="h-3 w-3" />
                </a>
            </Button>
            <Button variant="ghost" size="icon" asChild className="h-6 w-6">
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer" title="שלח וואטסאפ">
                    <MessageCircle className="h-3 w-3 text-green-500" />
                </a>
            </Button>
            <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-6 w-6" title="העתק מספר">
                <Copy className="h-3 w-3" />
            </Button>
        </div>
    );
}