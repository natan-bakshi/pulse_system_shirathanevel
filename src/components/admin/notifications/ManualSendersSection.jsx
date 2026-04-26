import React from "react";
import ManualPushSender from "../ManualPushSender";
import ManualWhatsAppSender from "../ManualWhatsAppSender";

// אזור שולחים ידניים - אוגד את שולחי ה-Push וה-WhatsApp
export default function ManualSendersSection() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <ManualPushSender />
      <ManualWhatsAppSender />
    </div>
  );
}