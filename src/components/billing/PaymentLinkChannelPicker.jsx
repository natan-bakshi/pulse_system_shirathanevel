import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, MessageCircle, Send } from "lucide-react";
import { billingText } from "@/components/billing/billingI18n";

// בורר ערוץ השליחה ופרטי הנמען עבור קישור דרישת התשלום.
export default function PaymentLinkChannelPicker({ via, onChangeVia, phone, onChangePhone, email, onChangeEmail, contacts = [], lang = "he" }) {
  const text = billingText(lang);
  const needsPhone = via === "whatsapp" || via === "both";
  const needsEmail = via === "email" || via === "both";
  const channels = [
    { value: "whatsapp", label: text.whatsapp, icon: MessageCircle },
    { value: "email", label: text.emailChannel, icon: Mail },
    { value: "both", label: text.bothChannels, icon: Send }
  ];

  const pickContact = (value) => {
    const contact = contacts[Number(value)];
    if (!contact) return;
    if (contact.phone) onChangePhone(contact.phone);
    if (contact.email) onChangeEmail(contact.email);
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3">
      <div>
        <Label>{text.channel}</Label>
        <Select value={via} onValueChange={onChangeVia}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {channels.map((channel) => (
              <SelectItem key={channel.value} value={channel.value}>
                <span className="flex items-center gap-2"><channel.icon className="h-4 w-4" />{channel.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {contacts.length > 0 && (
        <div>
          <Label>{text.pickContact}</Label>
          <Select onValueChange={pickContact}>
            <SelectTrigger><SelectValue placeholder={text.pickContactPlaceholder} /></SelectTrigger>
            <SelectContent>
              {contacts.map((contact, index) => (
                <SelectItem key={`${contact.phone}|${contact.email}`} value={String(index)}>
                  {contact.name} {contact.phone ? `· ${contact.phone}` : ""} {contact.email ? `· ${contact.email}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {needsPhone && <div><Label htmlFor="link-phone">{text.phoneForLink}</Label><Input id="link-phone" dir="ltr" value={phone} onChange={(event) => onChangePhone(event.target.value)} placeholder="0501234567" /></div>}
      {needsEmail && <div><Label htmlFor="link-email">{text.emailForLink}</Label><Input id="link-email" type="email" dir="ltr" value={email} onChange={(event) => onChangeEmail(event.target.value)} placeholder="client@example.com" /></div>}
    </div>
  );
}