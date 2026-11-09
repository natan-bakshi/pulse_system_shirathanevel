import React from "react";
import { Mail, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {useLanguage} from '@/i18n/LanguageProvider';

export default function EmailAddress({ email, className = "" }) {
  const {t: uiTranslate}=useLanguage();
    if (!email) return <span className={className}>{uiTranslate("לא צוין")}</span>;
    
    const copyToClipboard = () => {
        navigator.clipboard.writeText(email);
    };

    return (
        <div className={`flex items-center gap-1 ${className}`}>
            <span>{email}</span>
            <Button variant="ghost" size="icon" asChild className="h-6 w-6">
                <a href={`mailto:${email}`} title={uiTranslate("שלח מייל")}>
                    <Mail className="h-3 w-3" />
                </a>
            </Button>
            <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-6 w-6" title={uiTranslate("העתק מייל")}>
                <Copy className="h-3 w-3" />
            </Button>
        </div>
    );
}