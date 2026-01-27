import React from "react";
import { Mail, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function EmailAddress({ email, className = "" }) {
    if (!email) return <span className={className}>לא צוין</span>;
    
    const copyToClipboard = () => {
        navigator.clipboard.writeText(email);
    };

    return (
        <div className={`flex items-center gap-1 ${className}`}>
            <span>{email}</span>
            <Button variant="ghost" size="icon" asChild className="h-6 w-6">
                <a href={`mailto:${email}`} title="שלח מייל">
                    <Mail className="h-3 w-3" />
                </a>
            </Button>
            <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-6 w-6" title="העתק מייל">
                <Copy className="h-3 w-3" />
            </Button>
        </div>
    );
}